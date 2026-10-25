import { json } from '@sveltejs/kit';
import { requireCronOrPassword } from '#lib/server/auth.ts';
import { requireUser, validSession, SESSION_COOKIE } from '#lib/server/session.ts';
import { shiprocketGet, ShiprocketAuthError } from '#lib/server/shiprocket.ts';
import { isRtoStatus, mapShiprocketOrder, srDate, deepRowTooOld, readSweepCursor, sweepRange, nextSweep, datesHonoured, type SweepCursor, type SrRow } from '#lib/shiprocket-map.ts';
import { db } from '#lib/server/supabase.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

/**
 * Shiprocket → DRC, the same way as Velocity: every RTO (and lost parcel) goes into DRC's lists through
 * sync_courier_rtos('shiprocket', ...). Read-only on Shiprocket. Runs from Supabase cron (x-cron-secret);
 * a logged-in user can open it (GET) to run it now and see what it found.
 */
const PER_PAGE = 100;
const MAX_PAGES = 20;
const LOOK_BACK_DAYS = 75; // an RTO is settled well within this many days of the order
const PARALLEL = 3;
const DEEP_PAGES_PER_RUN = 6; // pages of one 10-day window per run (a window is ~4 pages today)
const DEEP_KEY = 'shiprocket_deep_cursor';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const keys = (o: any) => (o && typeof o === 'object' ? Object.keys(o) : []);

async function getPage(page: number, dates = ''): Promise<any[]> {
	let last = '';
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const r = await shiprocketGet(`/orders?page=${page}&per_page=${PER_PAGE}${dates}`);
			if (r.status === 200) return Array.isArray(r.body?.data) ? r.body.data : [];
			last = `HTTP ${r.status}`;
			if (r.status < 500 && r.status !== 429) break;
		} catch (e) {
			if (e instanceof ShiprocketAuthError) throw e;
			last = e instanceof Error ? e.message : String(e);
		}
		await sleep(1500 * attempt);
	}
	throw new Error(`Shiprocket /orders page ${page}: ${last}`);
}

/** Newest orders first, page by page, until orders are older than LOOK_BACK_DAYS. */
async function recentOrders() {
	const cutoff = Date.now() - LOOK_BACK_DAYS * 86_400_000;
	const orders: any[] = [];
	let pages = 0;
	let done = false;
	for (let p = 1; p <= MAX_PAGES && !done; p += PARALLEL) {
		const nums = Array.from({ length: Math.min(PARALLEL, MAX_PAGES - p + 1) }, (_, i) => p + i);
		const batch = await Promise.all(nums.map((n) => getPage(n)));
		for (const data of batch) {
			if (done) break;
			pages++;
			orders.push(...data);
			const oldest = data.map((o) => Date.parse(srDate(o?.created_at) ?? '')).filter(Number.isFinite);
			if (data.length < PER_PAGE || (oldest.length && Math.min(...oldest) < cutoff)) done = true;
		}
	}
	return { orders, pages, reachedEnd: done };
}

/** One window of older orders (from/to dates), starting at the cursor's page. */
async function deepOrders(c: SweepCursor, now: number) {
	const range = sweepRange(c, now);
	const dates = `&from=${range.from}&to=${range.to}`;
	const orders: any[] = [];
	let pages = 0;
	let hitEnd = false;
	for (let p = c.page; p < c.page + DEEP_PAGES_PER_RUN && !hitEnd; p += PARALLEL) {
		const nums = Array.from({ length: Math.min(PARALLEL, c.page + DEEP_PAGES_PER_RUN - p) }, (_, i) => p + i);
		const batch = await Promise.all(nums.map((n) => getPage(n, dates)));
		for (const data of batch) {
			if (hitEnd) break;
			pages++;
			orders.push(...data);
			if (data.length < PER_PAGE) hitEnd = true;
		}
	}
	const honoured = datesHonoured(orders.map((o) => srDate(o?.created_at)), range.to);
	return { range, orders: honoured ? orders : [], fetched: orders.length, pages, hitEnd, honoured };
}

async function deepCursor(): Promise<SweepCursor> {
	const { data } = await db().from('settings').select('value').eq('key', DEEP_KEY).maybeSingle();
	return readSweepCursor(data?.value);
}

async function track(awb: string): Promise<any> {
	try {
		const r = await shiprocketGet(`/courier/track/awb/${encodeURIComponent(awb)}`);
		return r.status === 200 ? r.body : null;
	} catch (e) {
		if (e instanceof ShiprocketAuthError) throw e;
		return null;
	}
}

async function saveRun(value: Record<string, unknown>) {
	await db().from('settings').upsert({ key: 'shiprocket_last_sync', value, note: 'Written by /api/sync/shiprocket' });
}

const PAUSE_AFTER_REJECT_MS = 6 * 3_600_000;

/** Scheduled runs only: after Shiprocket rejected the login, wait 6 h (repeated wrong logins get the API user blocked). */
async function pausedAfterReject(): Promise<string | null> {
	const { data } = await db().from('settings').select('value').eq('key', 'shiprocket_last_sync').maybeSingle();
	const v = data?.value as { ok?: boolean; keyRejected?: boolean; at?: string } | undefined;
	if (!v || v.ok || !v.keyRejected || !v.at) return null;
	const until = Date.parse(v.at) + PAUSE_AFTER_REJECT_MS;
	return Date.now() < until ? new Date(until).toISOString() : null;
}

async function run(withFields: boolean) {
	const started = Date.now();
	try {
		const { orders, pages, reachedEnd } = await recentOrders();
		// older-orders sweep: one 10-day window of orders 31–90 days old (Shiprocket's list stops at 30 days)
		const cursor = await deepCursor();
		const deep = await deepOrders(cursor, Date.now());
		const deepNext = nextSweep(cursor, deep.pages, deep.hitEnd || !deep.honoured);
		const statuses: Record<string, number> = {};
		for (const o of orders) statuses[String(o?.status ?? '?')] = (statuses[String(o?.status ?? '?')] ?? 0) + 1;
		const recentRto = orders.filter((o) => isRtoStatus(o?.status));
		const recentIds = new Set(recentRto.map((o) => String(o?.id ?? '')));
		const deepRto = deep.orders.filter((o) => isRtoStatus(o?.status) && !recentIds.has(String(o?.id ?? '')));
		const rtoOrders = [...recentRto, ...deepRto];

		// tracking gives the exact "RTO delivered" time the not-received timer starts from
		const tracks: any[] = new Array(rtoOrders.length).fill(null);
		let trackFailed = 0;
		for (let i = 0; i < rtoOrders.length; i += 4) {
			await Promise.all(
				rtoOrders.slice(i, i + 4).map(async (o, j) => {
					const awb = mapShiprocketOrder(o).awb;
					tracks[i + j] = awb ? await track(awb) : null;
					if (awb && !tracks[i + j]) trackFailed++;
				})
			);
		}

		const skipped = { no_awb: 0, no_order: 0, old_history: 0 };
		const byAwb = new Map<string, SrRow>();
		const now = Date.now();
		rtoOrders.forEach((o, i) => {
			const m = mapShiprocketOrder(o, tracks[i]);
			const fromSweep = i >= recentRto.length;
			if (!m.awb) skipped.no_awb++;
			else if (!m.order_no) skipped.no_order++;
			else if (fromSweep && deepRowTooOld(m, now)) skipped.old_history++;
			else if (!byAwb.has(m.awb) || !fromSweep) byAwb.set(m.awb, m);
		});
		const mapped = [...byAwb.values()];

		const totals = { inserted: 0, updated: 0, status_changes: 0 };
		for (let i = 0; i < mapped.length; i += 100) {
			const { data, error } = await db().rpc('sync_courier_rtos', { p_courier: 'shiprocket', p_rows: mapped.slice(i, i + 100) });
			if (error) throw new Error(`sync_courier_rtos: ${error.message}`);
			totals.inserted += data?.inserted ?? 0;
			totals.updated += data?.updated ?? 0;
			totals.status_changes += data?.status_changes ?? 0;
		}

		await db().from('settings').upsert({ key: DEEP_KEY, value: { ...deepNext, at: new Date().toISOString() }, note: 'Older-orders sweep cursor (10-day window + page), written by /api/sync/shiprocket' });

		const result = {
			ok: true,
			at: new Date().toISOString(),
			ms: Date.now() - started,
			fetched: { orders: orders.length, pages, reached_look_back: reachedEnd, rto: rtoOrders.length, unique: mapped.length, track_failed: trackFailed },
			sweep: { window: cursor.window, from: deep.range.from, to: deep.range.to, from_page: cursor.page, pages: deep.pages, orders: deep.fetched, dates_honoured: deep.honoured, rto: deepRto.length, next: deepNext },
			skipped,
			statuses,
			...totals,
			// what DRC saw, without customer details: order, status, courier, dates
			rtos: mapped.slice(0, 40).map((m) => ({
				order: m.order_no, status: m.status, courier: m.carrier_name, awb: m.awb,
				rto_delivered_at: m.rto_delivered_at, last_event_at: m.last_event_at, last_event: m.last_event_text, items: m.items.length
			}))
		};
		await saveRun(result);
		if (!withFields) return json(result);
		const o = rtoOrders[0] ?? orders[0];
		const sh = Array.isArray(o?.shipments) ? o.shipments[0] : o?.shipments;
		const td = tracks.find(Boolean);
		return json({
			...result,
			fields: {
				order: keys(o), shipment: keys(sh), product: keys(o?.products?.[0]),
				tracking: keys(td?.tracking_data ?? td), activity: keys((td?.tracking_data ?? td)?.shipment_track_activities?.[0])
			}
		});
	} catch (e) {
		const auth = e instanceof ShiprocketAuthError;
		const result = { ok: false, at: new Date().toISOString(), keyRejected: auth, error: e instanceof Error ? e.message : String(e) };
		await saveRun(result).catch(() => {});
		return json(result, { status: auth ? 401 : 502 });
	}
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!(await validSession(cookies.get(SESSION_COOKIE)))) requireCronOrPassword(request);
	if (request.headers.get('x-cron-secret') !== null) {
		const until = await pausedAfterReject();
		if (until) return json({ ok: false, paused: true, until, reason: 'Shiprocket rejected the last login; not retrying until then' });
	}
	return run(false);
};

/** Logged in: run it now (no pause: a person asked) and also list the field names Shiprocket sent (no customer details). */
export const GET: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return run(true);
};
