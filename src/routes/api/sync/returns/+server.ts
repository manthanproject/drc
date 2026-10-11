import { json } from '@sveltejs/kit';
import { requireCronOrPassword } from '#lib/server/auth.ts';
import { requireUser, validSession, SESSION_COOKIE } from '#lib/server/session.ts';
import { velocityPost, VelocityKeyError } from '#lib/server/velocity-api.ts';
import { mapReturn, type ReturnRow } from '#lib/returns-map.ts';
import { db } from '#lib/server/supabase.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

/**
 * Velocity customer returns (reverse pickups we create) → DRC, as kind 'customer_return'. Read-only on Velocity
 * (POST /returns). Supabase cron every 30 min (x-cron-secret); a logged-in user can open it (GET) to run it now.
 * Returns with no AWB yet (status "new") wait until the pickup is booked; cancelled ones with an AWB are closed.
 */
const PER_PAGE = 100;
const MAX_PAGES = 10;

async function getPage(page: number): Promise<{ rows: any[]; total: number | null }> {
	let last = '';
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const r = await velocityPost('/returns', { page, per_page: PER_PAGE, sort_by: 'created_at', sort_order: 'desc' }, { timeoutMs: 20_000 });
			if (r.status === 200) return { rows: Array.isArray(r.body?.data) ? r.body.data : [], total: Number(r.body?.meta?.total ?? NaN) || null };
			last = `HTTP ${r.status}`;
			if (r.status < 500) break;
		} catch (e) {
			if (e instanceof VelocityKeyError) throw e;
			last = e instanceof Error ? e.message : String(e);
		}
		await new Promise((res) => setTimeout(res, 1500 * attempt));
	}
	throw new Error(`Velocity /returns page ${page}: ${last}`);
}

async function saveRun(value: Record<string, unknown>) {
	await db().from('settings').upsert({ key: 'returns_last_sync', value, note: 'Written by /api/sync/returns' });
}

async function run() {
	const started = Date.now();
	try {
		const all: any[] = [];
		const first = await getPage(1);
		all.push(...first.rows);
		const pages = Math.min(Math.ceil((first.total ?? first.rows.length) / PER_PAGE), MAX_PAGES);
		for (let p = 2; p <= pages; p++) all.push(...(await getPage(p)).rows);

		const byAwb = new Map<string, ReturnRow>();
		let noAwb = 0;
		for (const row of all) {
			const m = mapReturn(row);
			if (!m.awb || !m.order_no) noAwb++;
			else byAwb.set(m.awb, m);
		}
		const rows = [...byAwb.values()];
		const totals = { inserted: 0, updated: 0, status_changes: 0, skipped: 0 };
		for (let i = 0; i < rows.length; i += 100) {
			const { data, error } = await db().rpc('sync_customer_returns', { p_rows: rows.slice(i, i + 100) });
			if (error) throw new Error(`sync_customer_returns: ${error.message}`);
			for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += Number(data?.[k] ?? 0);
		}
		const result = { ok: true, at: new Date().toISOString(), ms: Date.now() - started, fetched: { returns: all.length, with_awb: rows.length, no_awb_yet: noAwb }, ...totals };
		await saveRun(result);
		return json(result);
	} catch (e) {
		const result = { ok: false, at: new Date().toISOString(), keyRejected: e instanceof VelocityKeyError, error: e instanceof Error ? e.message : String(e) };
		await saveRun(result).catch(() => {});
		return json(result, { status: result.keyRejected ? 401 : 502 });
	}
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!(await validSession(cookies.get(SESSION_COOKIE)))) requireCronOrPassword(request);
	return run();
};

/** Logged in: run it now. */
export const GET: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return run();
};
