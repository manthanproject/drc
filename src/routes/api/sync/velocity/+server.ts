import { json } from '@sveltejs/kit';
import { requireCronOrPassword } from '#lib/server/auth.ts';
import { velocityPost, VelocityKeyError } from '#lib/server/velocity-api.ts';
import { mapVelocityRow } from '#lib/server/velocity-map.ts';
import { db } from '#lib/server/supabase.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const PER_PAGE = 50; // 100 took up to 18 s and once returned 502; 50 answers in ~6 s
const MAX_PAGES = 40;
const PARALLEL = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One page, retried up to 3 times on Velocity 5xx / network errors (their gateway sometimes times out). */
async function getPage(filter: Record<string, unknown>, page: number) {
	let lastErr = '';
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const r = await velocityPost('/shipments', { ...filter, page, per_page: PER_PAGE, sort_order: 'desc' });
			if (r.status === 200) return r.body;
			lastErr = `HTTP ${r.status}`;
			if (r.status < 500) break;
		} catch (e) {
			if (e instanceof VelocityKeyError) throw e;
			lastErr = e instanceof Error ? e.message : String(e);
		}
		await sleep(1500 * attempt);
	}
	throw new Error(`Velocity /shipments page ${page}: ${lastErr}`);
}

/** All pages for one filter: page 1 first (to learn the total), the rest 3 at a time. */
async function fetchAll(filter: Record<string, unknown>) {
	const first = await getPage(filter, 1);
	const rows: any[] = Array.isArray(first?.data) ? [...first.data] : [];
	const total = Number(first?.meta?.total ?? rows.length);
	const pages = Math.min(Math.ceil(total / PER_PAGE), MAX_PAGES);
	const rest = Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => i + 2);
	for (let i = 0; i < rest.length; i += PARALLEL) {
		const bodies = await Promise.all(rest.slice(i, i + PARALLEL).map((p) => getPage(filter, p)));
		for (const b of bodies) if (Array.isArray(b?.data)) rows.push(...b.data);
	}
	return { rows, total };
}

async function saveRun(value: Record<string, unknown>) {
	await db().from('settings').upsert({ key: 'velocity_last_sync', value, note: 'Written by /api/sync/velocity' });
}

export const POST: RequestHandler = async ({ request }) => {
	requireCronOrPassword(request);
	const started = Date.now();
	try {
		const [bucketRes, lostRes] = await Promise.all([
			fetchAll({ status: 'rto_initiated' }),
			fetchAll({ granular_status: ['lost', 'rto_lost'] })
		]);
		const bucket = bucketRes.rows;
		const lost = lostRes.rows;

		const byAwb = new Map<string, ReturnType<typeof mapVelocityRow>>();
		for (const row of [...bucket, ...lost]) {
			const m = mapVelocityRow(row);
			if (m.awb && m.order_no) byAwb.set(m.awb, m);
		}
		const mapped = [...byAwb.values()];

		const totals = { inserted: 0, updated: 0, status_changes: 0 };
		for (let i = 0; i < mapped.length; i += 100) {
			const { data, error } = await db().rpc('sync_courier_rtos', {
				p_courier: 'velocity',
				p_rows: mapped.slice(i, i + 100)
			});
			if (error) throw new Error(`sync_courier_rtos: ${error.message}`);
			totals.inserted += data?.inserted ?? 0;
			totals.updated += data?.updated ?? 0;
			totals.status_changes += data?.status_changes ?? 0;
		}

		const result = {
			ok: true,
			at: new Date().toISOString(),
			ms: Date.now() - started,
			fetched: { rto_bucket: bucket.length, rto_bucket_total: bucketRes.total, lost: lost.length, unique: mapped.length },
			...totals
		};
		await saveRun(result);
		return json(result);
	} catch (e) {
		const result = {
			ok: false,
			at: new Date().toISOString(),
			keyRejected: e instanceof VelocityKeyError,
			error: e instanceof Error ? e.message : String(e)
		};
		await saveRun(result).catch(() => {});
		return json(result, { status: result.keyRejected ? 401 : 502 });
	}
};
