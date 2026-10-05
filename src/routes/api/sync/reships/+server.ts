import { json } from '@sveltejs/kit';
import { requireCronOrPassword } from '#lib/server/auth.ts';
import { velocityPost, VelocityKeyError } from '#lib/server/velocity-api.ts';
import { db } from '#lib/server/supabase.ts';
import { pickReship, searchTermFor, type ReshipMatch } from '#lib/reship.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

// Hard time budget, so a run ALWAYS finishes and saves its progress (function limit is 60 s).
// Measured 5 Oct: Velocity free-text search takes 2–7+ s (status filters ~1.5 s); 4 at once all hit 7 s,
// so search 2 at a time with up to 15 s each. Runs every 10 min; each run checks what fits.
const BUDGET_MS = 40_000;
const SEARCH_TIMEOUT_MS = 15_000;
const MIN_WAVE_MS = 16_000; // start another wave only if a full search timeout still fits
const PARALLEL = 2;
const BATCH = 16;

async function search(term: string, timeoutMs: number) {
	const r = await velocityPost('/shipments', { search: term, page: 1, per_page: 10 }, { timeoutMs });
	if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
	return Array.isArray(r.body?.data) ? r.body.data : [];
}

async function save(value: Record<string, unknown>) {
	await db().from('settings').upsert({ key: 'reship_last_check', value, note: 'Written by /api/sync/reships' });
}

/** Look for re-ships of "Arrived, not scanned" RTOs. Only SUGGESTS; staff confirm in Needs action. */
export const POST: RequestHandler = async ({ request }) => {
	requireCronOrPassword(request);
	const started = Date.now();
	const left = () => BUDGET_MS - (Date.now() - started);
	try {
		const { data: rtos, error } = await db()
			.from('rtos')
			.select('id, order_no, rto_delivered_at')
			.eq('stage', 'awaiting_receipt')
			.eq('courier', 'velocity')
			.in('reship_state', ['none', 'pending'])
			.not('rto_delivered_at', 'is', null)
			.order('reship_checked_at', { ascending: true, nullsFirst: true })
			.limit(BATCH * 2);
		if (error) throw new Error(`rtos: ${error.message}`);
		const todo = (rtos ?? []).filter((r) => /^\d+(-\d+)*$/.test(r.order_no ?? '')).slice(0, BATCH); // Dropy orders only

		const ids = todo.map((r) => r.id);
		const { data: items, error: e2 } = ids.length
			? await db().from('rto_items').select('rto_id, sku').in('rto_id', ids)
			: { data: [], error: null };
		if (e2) throw new Error(`rto_items: ${e2.message}`);
		const skus = new Map<string, string[]>();
		for (const i of items ?? []) if (i.sku) skus.set(i.rto_id, [...(skus.get(i.rto_id) ?? []), i.sku]);

		const results: ({ id: string } & Partial<ReshipMatch>)[] = [];
		let failed = 0;
		let attempted = 0;
		const searchMs: number[] = [];
		for (let i = 0; i < todo.length; i += PARALLEL) {
			if (left() < MIN_WAVE_MS) break; // the rest waits for the next run (least-recently-checked first)
			const chunk = todo.slice(i, i + PARALLEL);
			attempted += chunk.length;
			const timeoutMs = Math.min(SEARCH_TIMEOUT_MS, Math.max(left() - 800, 1000));
			const wave = await Promise.all(
				chunk.map(async (r) => {
					try {
						const t0 = Date.now();
						const rows = await search(searchTermFor(r.order_no), timeoutMs);
						searchMs.push(Date.now() - t0);
						const m = pickReship({ order_no: r.order_no, rto_delivered_at: r.rto_delivered_at, skus: skus.get(r.id) ?? [] }, rows);
						return { id: r.id, ...(m ?? {}) };
					} catch (e) {
						if (e instanceof VelocityKeyError) throw e;
						failed++;
						return { id: r.id }; // counts as checked, so one slow order can't block the queue; re-checked next cycle
					}
				})
			);
			results.push(...wave);
		}

		const { data: rec, error: e3 } = await db().rpc('record_reship_checks', { p_rows: results });
		if (e3) throw new Error(`record_reship_checks: ${e3.message}`);
		const result = {
			ok: true, at: new Date().toISOString(), ms: Date.now() - started,
			queued: todo.length, attempted, failed,
			searchMs: searchMs.length ? { min: Math.min(...searchMs), max: Math.max(...searchMs) } : null,
			...(rec as object)
		};
		await save(result);
		return json(result);
	} catch (e) {
		const result = { ok: false, at: new Date().toISOString(), ms: Date.now() - started, keyRejected: e instanceof VelocityKeyError, error: e instanceof Error ? e.message : String(e) };
		await save(result).catch(() => {});
		return json(result, { status: result.keyRejected ? 401 : 502 });
	}
};
