import { json } from '@sveltejs/kit';
import { requireCronOrPassword } from '#lib/server/auth.ts';
import { velocityPost, VelocityKeyError } from '#lib/server/velocity-api.ts';
import { mapVelocityRow } from '#lib/server/velocity-map.ts';
import { db } from '#lib/server/supabase.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const PER_PAGE = 100;
const MAX_PAGES = 20;

/** Pulls every page for one filter. Velocity ignores `status: rto_delivered`, so DRC uses the RTO bucket + granular lost. */
async function fetchAll(filter: Record<string, unknown>) {
	const rows: any[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const r = await velocityPost('/shipments', { ...filter, page, per_page: PER_PAGE, sort_order: 'desc' });
		if (r.status !== 200) throw new Error(`Velocity /shipments HTTP ${r.status}`);
		const data: any[] = Array.isArray(r.body?.data) ? r.body.data : [];
		rows.push(...data);
		const total = Number(r.body?.meta?.total ?? 0);
		if (data.length < PER_PAGE || rows.length >= total) break;
	}
	return rows;
}

async function saveRun(value: Record<string, unknown>) {
	await db().from('settings').upsert({ key: 'velocity_last_sync', value, note: 'Written by /api/sync/velocity' });
}

export const POST: RequestHandler = async ({ request }) => {
	requireCronOrPassword(request);
	const started = Date.now();
	try {
		const bucket = await fetchAll({ status: 'rto_initiated' });
		const lost = await fetchAll({ granular_status: ['lost', 'rto_lost'] });

		const byAwb = new Map<string, ReturnType<typeof mapVelocityRow>>();
		for (const row of [...bucket, ...lost]) {
			const m = mapVelocityRow(row);
			if (m.awb && m.order_no) byAwb.set(m.awb, m);
		}
		const mapped = [...byAwb.values()];

		const totals = { inserted: 0, updated: 0, status_changes: 0 };
		for (let i = 0; i < mapped.length; i += PER_PAGE) {
			const { data, error } = await db().rpc('sync_courier_rtos', {
				p_courier: 'velocity',
				p_rows: mapped.slice(i, i + PER_PAGE)
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
			fetched: { rto_bucket: bucket.length, lost: lost.length, unique: mapped.length },
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
