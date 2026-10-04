/** Pure mapping from a Velocity /shipments row to the shape public.sync_courier_rtos() expects. */

const RTO_DELIVERED_CODES = new Set(['rtodlv', 'rto_dl_rto', 'rto_delivered']);

/** '#Dropy-4410' → '4410', 'Dropy-5000-ALL' → '5000', 'Dropy-1381-1' → '1381-1'. */
export function normalizeOrderNo(raw: unknown): string {
	const s = String(raw ?? '').trim().replace(/^#/, '');
	const m = s.match(/^dropy-?(.+?)(?:-all|-[a-z])?$/i);
	return (m ? m[1] : s).trim();
}

const num = (v: unknown) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

export function mapVelocityRow(row: any) {
	const a = row?.attributes ?? {};
	const total = num(a.total_price) ?? 0;
	const cod = num(a.cod_amount) ?? 0;
	const isCod = Boolean(a.is_cod);
	const paymentMode = !isCod ? 'prepaid' : cod > 0 && cod < total - 0.5 ? 'partial' : 'cod';

	const events = (Array.isArray(a.tracking_details) ? a.tracking_details : [])
		.filter((e: any) => e?.event_date_time)
		.sort((x: any, y: any) => Date.parse(y.event_date_time) - Date.parse(x.event_date_time));
	const last = events[0];
	const rtoDone = events.find(
		(e: any) => RTO_DELIVERED_CODES.has(String(e.status ?? '').toLowerCase()) || /return\s*-?\s*deliver/i.test(e.description ?? '')
	);

	const phone = String(a.shipping_address?.phone ?? '').replace(/\D+/g, '');

	return {
		awb: String(a.tracking_number ?? '').trim(),
		rto_awb: a.rto_awb ? String(a.rto_awb).trim() : null,
		order_no: normalizeOrderNo(a.order?.display_id ?? a.order?.external_id),
		order_name: a.order?.display_id ?? null,
		carrier_name: a.carrier?.name ?? null,
		status: String(a.status ?? '').toLowerCase(),
		sub_status: a.sub_status ?? null,
		payment_mode: paymentMode,
		order_value: total,
		amount_collected: isCod ? Math.max(total - cod, 0) : total,
		customer_name: a.shipping_address?.name ?? null,
		customer_phone10: phone ? phone.slice(-10) : null,
		rto_reason: a.rto_reason ?? null,
		rto_charges: num(a.fare_breakup?.rto_charges),
		rto_delivered_at: rtoDone?.event_date_time ?? (String(a.status) === 'rto_delivered' ? last?.event_date_time ?? null : null),
		last_event_at: last?.event_date_time ?? null,
		last_event_text: last?.description ?? null,
		last_event_location: last?.last_location ?? null,
		shipment_id: a.unique_id ?? row?.id ?? null,
		items: (Array.isArray(a.items) ? a.items : []).map((i: any) => ({
			sku: i.sku ?? null,
			name: i.name ?? null,
			qty: Number(i.quantity) || 1,
			price: num(i.final_price) ?? num(i.price) ?? 0
		})),
		raw: a
	};
}
