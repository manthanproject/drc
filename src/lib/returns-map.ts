/**
 * Customer returns (reverse pickups created in Velocity → Returns): Velocity's POST /returns row → the shape
 * public.sync_customer_returns() expects. Pure, tested. Field shapes confirmed on real data (probe, 11 Oct 2026):
 * attributes.status new | ready_for_pickup | not_picked | in_transit | delivered | cancelled; shipment.tracking_number,
 * shipment.status return_*, shipment.shipment_milestones [{milestone, milestone_at}], order.display_id "Dropy-5301-ALL",
 * "#Dropy-3012", "Dropy-5301"; display_id "Dropy-5301-ALL-R1" / "#Dropy-3012-R2" / same as the order.
 */
import { normalizeOrderNo } from './shiprocket-map.ts';

const num = (v: unknown) => {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
const str = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const iso = (v: unknown) => {
	const t = Date.parse(String(v ?? ''));
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Milestones that are plans (dates in the future), not things that happened. */
const PLANNED = new Set(['expected_pickup_date', 'original_expected_delivery_date']);
const EVENT_TEXT: Record<string, string> = {
	return_pickup_scheduled: 'Pickup scheduled',
	return_not_picked: 'Pickup failed',
	return_in_transit: 'In transit',
	return_need_attention: 'Needs attention',
	return_delivered: 'Delivered to warehouse',
	return_cancelled: 'Return cancelled'
};

export interface ReturnRow {
	awb: string;
	order_no: string;
	order_name: string | null;
	return_id: string | null;
	status: string;
	courier_status: string;
	carrier_name: string | null;
	order_value: number | null;
	customer_name: string | null;
	customer_phone10: string | null;
	return_reason: string | null;
	requested_at: string | null;
	delivered_at: string | null;
	last_event_at: string | null;
	last_event_text: string | null;
	shipment_id: string | null;
	items: { sku: string | null; name: string | null; qty: number; price: number }[];
	raw: { refund_status: string | null; status: string; return_id: string | null; reason: string | null; pickup_fails: number; is_exchange: boolean };
}

export function mapReturn(row: any): ReturnRow {
	const a = row?.attributes ?? {};
	const sh = a.shipment ?? {};
	const status = String(a.status ?? '').toLowerCase();
	const ms = (Array.isArray(sh.shipment_milestones) ? sh.shipment_milestones : [])
		.map((m: any) => ({ k: String(m?.milestone ?? ''), at: iso(m?.milestone_at) }))
		.filter((m: { k: string; at: string | null }) => m.at && !PLANNED.has(m.k))
		.sort((x: { at: string }, y: { at: string }) => Date.parse(y.at) - Date.parse(x.at));
	const last = ms[0];
	const delivered = ms.find((m: { k: string }) => m.k === 'return_delivered');
	const fails = ms.filter((m: { k: string }) => m.k === 'return_not_picked').length;
	const phone = String(a.shipping_address?.phone ?? '').replace(/\D+/g, '');
	const reason = str(a.return_reason);
	let lastText = last ? EVENT_TEXT[last.k] ?? last.k.replace(/^return_/, '').replace(/_/g, ' ') : null;
	if (lastText && last?.k === 'return_not_picked' && fails > 1) lastText = `Pickup failed (${fails} tries)`;
	return {
		awb: String(sh.tracking_number ?? '').trim(),
		order_no: normalizeOrderNo(a.order?.display_id ?? a.order?.external_id),
		order_name: str(a.order?.display_id),
		return_id: str(a.display_id),
		status,
		courier_status: str(sh.status) ?? (status ? `return_${status}` : 'return_unknown'),
		carrier_name: str(sh.carrier?.name),
		order_value: num(a.total_price),
		customer_name: a.pii_masked ? null : str(a.shipping_address?.name),
		customer_phone10: !a.pii_masked && phone.length >= 10 ? phone.slice(-10) : null,
		return_reason: reason,
		requested_at: iso(a.request_date ?? a.created_at),
		delivered_at: delivered?.at ?? null,
		last_event_at: last?.at ?? null,
		last_event_text: lastText,
		shipment_id: str(sh.id ?? a.unique_id),
		items: (Array.isArray(a.return_items) ? a.return_items : []).map((i: any) => ({
			sku: str(i?.sku),
			name: str(i?.name),
			qty: Number(i?.quantity) || 1,
			price: num(i?.price) ?? 0
		})),
		raw: { refund_status: str(a.refund_status), status, return_id: str(a.display_id), reason, pickup_fails: fails, is_exchange: Boolean(a.is_exchange) }
	};
}

/** Velocity's refund for this return was paid or approved. Dropy always refunds by PayU / bank, so this needs a look. */
export const velocityRefunded = (refundStatus: unknown) => {
	const s = String(refundStatus ?? '').toLowerCase();
	return s !== '' && s !== 'pending' && s !== 'rejected' && s !== 'cancelled' && s !== 'not_applicable';
};
