import { json } from '@sveltejs/kit';
import { requireCronOrPassword } from '#lib/server/auth.ts';
import { velocityPost, VelocityKeyError } from '#lib/server/velocity-api.ts';
import { db } from '#lib/server/supabase.ts';
import { pickReship, searchTermFor, type ReshipMatch } from '#lib/reship.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const BATCH = 20; // RTOs per hourly run, least recently checked first
const PARALLEL = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function search(term: string) {
	for (let attempt = 1; attempt <= 2; attempt++) {
		const r = await velocityPost('/shipments', { search: term, page: 1, per_page: 10 });
		if (r.status === 200) return Array.isArray(r.body?.data) ? r.body.data : [];
		if (r.status < 500) throw new Error(`HTTP ${r.status}`);
		await sleep(1500);
	}
	throw new Error('Velocity search kept failing');
}

async function save(value: Record<string, unknown>) {
	await db().from('settings').upsert({ key: 'reship_last_check', value, note: 'Written by /api/sync/reships' });
}

/** Hourly: look for re-ships of "Arrived, not scanned" RTOs. Only SUGGESTS; staff confirm in Needs action. */
export const POST: RequestHandler = async ({ request }) => {
	requireCronOrPassword(request);
	const started = Date.now();
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
		for (let i = 0; i < todo.length; i += PARALLEL) {
			const chunk = todo.slice(i, i + PARALLEL);
			const found = await Promise.all(
				chunk.map(async (r) => {
					try {
						const rows = await search(searchTermFor(r.order_no));
						return { id: r.id, ...(pickReship({ order_no: r.order_no, rto_delivered_at: r.rto_delivered_at, skus: skus.get(r.id) ?? [] }, rows) ?? {}) };
					} catch (e) {
						if (e instanceof VelocityKeyError) throw e;
						failed++;
						return null; // not marked as checked, so it is retried first next hour
					}
				})
			);
			for (const f of found) if (f) results.push(f);
		}

		const { data: rec, error: e3 } = await db().rpc('record_reship_checks', { p_rows: results });
		if (e3) throw new Error(`record_reship_checks: ${e3.message}`);
		const result = { ok: true, at: new Date().toISOString(), ms: Date.now() - started, failed, ...(rec as object) };
		await save(result);
		return json(result);
	} catch (e) {
		const result = { ok: false, at: new Date().toISOString(), keyRejected: e instanceof VelocityKeyError, error: e instanceof Error ? e.message : String(e) };
		await save(result).catch(() => {});
		return json(result, { status: result.keyRejected ? 401 : 502 });
	}
};
