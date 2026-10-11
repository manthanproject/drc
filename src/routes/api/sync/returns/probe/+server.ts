import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { velocityPost, VelocityKeyError } from '#lib/server/velocity-api.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 30 };

/**
 * TEMPORARY probe (removed by the customer-returns patch): the SHAPE of Velocity's customer returns
 * (POST /returns, read-only, documented in Velocity's Order Details API (Returns)). Two pages of 50, newest first.
 * No customer name, phone, email or address is returned: statuses, dates, order / return numbers, AWBs, items count.
 */
const keys = (o: any) => (o && typeof o === 'object' ? Object.keys(o) : []);
const count = (m: Record<string, number>, k: unknown) => (m[String(k ?? '—')] = (m[String(k ?? '—')] ?? 0) + 1);

export const GET: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const rows: any[] = [];
	let total: unknown = null;
	try {
		for (let page = 1; page <= 2; page++) {
			const r = await velocityPost('/returns', { page, per_page: 50, sort_by: 'created_at', sort_order: 'desc' }, { timeoutMs: 20_000 });
			if (r.status !== 200) return json({ ok: false, step: `returns page ${page}`, http: r.status, body: typeof r.body === 'string' ? r.body.slice(0, 300) : r.body?.message ?? null });
			const data: any[] = Array.isArray(r.body?.data) ? r.body.data : [];
			total ??= r.body?.meta?.total ?? null;
			rows.push(...data);
			if (data.length < 50) break;
		}
	} catch (e) {
		return json({ ok: false, step: 'velocity', keyRejected: e instanceof VelocityKeyError, message: e instanceof Error ? e.message : String(e) });
	}
	const st: Record<string, number> = {}, gst: Record<string, number> = {}, refund: Record<string, number> = {}, qc: Record<string, number> = {}, shipSt: Record<string, number> = {}, milestones: Record<string, number> = {};
	for (const row of rows) {
		const a = row?.attributes ?? {};
		count(st, a.status);
		count(gst, a.granular_status);
		count(refund, a.refund_status);
		count(qc, a.qc_status);
		count(shipSt, a.shipment?.status);
		for (const m of Array.isArray(a.shipment?.shipment_milestones) ? a.shipment.shipment_milestones : []) count(milestones, m?.milestone);
	}
	const a0 = rows[0]?.attributes ?? {};
	return json({
		ok: true,
		read: rows.length,
		total,
		statuses: st,
		granular_statuses: gst,
		refund_statuses: refund,
		qc_statuses: qc,
		shipment_statuses: shipSt,
		milestones,
		fields: { attributes: keys(a0), shipment: keys(a0.shipment), order: keys(a0.order), item: keys(a0.return_items?.[0]), carrier: keys(a0.shipment?.carrier) },
		sample: rows.slice(0, 12).map((row) => {
			const a = row?.attributes ?? {};
			return {
				return_id: a.display_id ?? null,
				order: a.order?.display_id ?? null,
				order_external_id: a.order?.external_id ?? null,
				status: a.status ?? null,
				granular_status: a.granular_status ?? null,
				refund_status: a.refund_status ?? null,
				qc_status: a.qc_status ?? null,
				reason: a.return_reason ?? null,
				total_price: a.total_price ?? null,
				is_exchange: a.is_exchange ?? null,
				items: Array.isArray(a.return_items) ? a.return_items.length : null,
				return_awb: a.shipment?.tracking_number ?? null,
				carrier: a.shipment?.carrier?.name ?? null,
				shipment_status: a.shipment?.status ?? null,
				milestones: (Array.isArray(a.shipment?.shipment_milestones) ? a.shipment.shipment_milestones : []).map((m: any) => `${m?.milestone} @ ${m?.milestone_at}`),
				created_at: a.created_at ?? null,
				request_date: a.request_date ?? null
			};
		})
	});
};
