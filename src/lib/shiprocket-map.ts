/**
 * Pure mapping from Shiprocket API data to the shape public.sync_courier_rtos() expects (same as Velocity).
 * Shiprocket gives status as text ("RTO DELIVERED") and dates in IST without an offset ("2026-10-09 14:02:00",
 * "09 Oct 2026, 02:02 PM"); both are handled here. No server imports, so tests can load it directly.
 */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

/** Shiprocket date text (IST) → ISO string with +05:30. Null when empty or not a date. */
export function srDate(v: unknown): string | null {
	const s = String(v ?? '').trim();
	if (!s || /^0{4}-0{2}/.test(s)) return null;
	if (/(z|[+-]\d\d:?\d\d)$/i.test(s) && /^\d{4}-/.test(s)) {
		const t = Date.parse(s);
		return Number.isFinite(t) ? new Date(t).toISOString() : null;
	}
	let y: number, mo: number, d: number, h = 0, mi = 0, se = 0;
	let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
	if (m) {
		[y, mo, d] = [+m[1], +m[2], +m[3]];
		if (m[4]) [h, mi, se] = [+m[4], +m[5], +(m[6] ?? 0)];
	} else {
		m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -,]*(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?/i);
		if (!m || !MONTHS[m[2].toLowerCase()]) return null;
		[d, mo, y] = [+m[1], MONTHS[m[2].toLowerCase()], +m[3]];
		if (m[4]) {
			[h, mi, se] = [+m[4], +m[5], +(m[6] ?? 0)];
			const ap = (m[7] ?? '').toUpperCase();
			if (ap === 'PM' && h < 12) h += 12;
			if (ap === 'AM' && h === 12) h = 0;
		}
	}
	const iso = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(se)}+05:30`;
	const t = Date.parse(iso);
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const words = (s: unknown) => String(s ?? '').trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

/** Orders DRC tracks: every RTO stage, plus lost / damaged / destroyed (like Velocity's lost list). Customer returns are not RTOs. */
export function isRtoStatus(text: unknown): boolean {
	const w = words(text);
	return /^RTO\b/.test(w) || /^(LOST|DAMAGED|DESTROYED|UNTRACEABLE)\b/.test(w);
}

/** Shiprocket status text → DRC courier status (the codes sync_courier_rtos and the Home screen understand). */
export function srStatus(text: unknown): string {
	const w = words(text);
	if (/^RTO (DELIVERED|ACKNOWLEDGED|ACKNOWLEDGE|RECEIVED)/.test(w)) return 'rto_delivered';
	if (/^RTO (OFD|OUT FOR DELIVERY)/.test(w)) return 'rto_out_for_delivery';
	if (/^RTO INITIATED/.test(w)) return 'rto_initiated';
	if (/^RTO LOST/.test(w)) return 'rto_lost';
	if (/^(LOST|DAMAGED|DESTROYED|UNTRACEABLE)/.test(w)) return 'lost';
	return w.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}

/** '#Dropy-4410' → '4410', 'Dropy-5000-ALL' → '5000', 'Dropy-1381-1' → '1381-1' (same rule as Velocity). */
export function normalizeOrderNo(raw: unknown): string {
	const s = String(raw ?? '').trim().replace(/^#/, '');
	const m = s.match(/^dropy-?(.+?)(?:-all|-[a-z])?$/i);
	return (m ? m[1] : s).trim();
}

const num = (v: unknown) => {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(String(v).replace(/[₹,\s]/g, ''));
	return Number.isFinite(n) ? n : null;
};
const first = (...v: unknown[]) => v.find((x) => x !== null && x !== undefined && String(x).trim() !== '');
const str = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());

/** The tracking_data object from GET /courier/track/awb/{awb} (Shiprocket sometimes keys it by AWB). */
export function trackingData(body: any): any {
	if (!body || typeof body !== 'object') return null;
	if (body.tracking_data) return body.tracking_data;
	const inner = Object.values(body).find((v: any) => v && typeof v === 'object' && v.tracking_data) as any;
	return inner?.tracking_data ?? null;
}

const RTO_DONE = (label: string, activity: string) =>
	/^RTO (DELIVERED|ACKNOWLEDGED)/.test(words(label)) || /\b(rto|return(ed)?)\b[^.]*\bdeliver/i.test(activity) || /delivered to (origin|shipper|seller|consignor)/i.test(activity);

export type SrRow = ReturnType<typeof mapShiprocketOrder>;

/** One Shiprocket order (+ its tracking, if fetched) → one DRC row. */
export function mapShiprocketOrder(order: any, track: any = null) {
	const o = order ?? {};
	const ships: any[] = Array.isArray(o.shipments) ? o.shipments : o.shipments ? [o.shipments] : [];
	const sh = ships.find((s) => s?.awb || s?.awb_code) ?? ships[0] ?? {};
	const awb = String(first(sh.awb, sh.awb_code) ?? '').trim();
	let td = trackingData(track);
	let st0 = Array.isArray(td?.shipment_track) ? td.shipment_track[0] : td?.shipment_track ?? null;
	if (awb && st0?.awb_code && String(st0.awb_code).trim() !== awb) td = st0 = null; // tracking for another parcel: ignore it

	let status = srStatus(first(o.status, st0?.current_status));
	const total = num(first(o.total, o.net_total, o.sub_total)) ?? 0;
	const isCod = /cod|cash/i.test(String(o.payment_method ?? ''));

	const events = (Array.isArray(td?.shipment_track_activities) ? td.shipment_track_activities : [])
		.map((e: any) => ({ at: srDate(e?.date), text: str(e?.activity), loc: str(e?.location), label: String(e?.['sr-status-label'] ?? '') }))
		.filter((e: any) => e.at)
		.sort((a: any, b: any) => Date.parse(b.at) - Date.parse(a.at));
	const last = events[0];
	const done = [...events].reverse().find((e: any) => RTO_DONE(e.label, e.text ?? ''));
	// tracking is fresher than the order list: an RTO the courier has delivered back counts as delivered
	if (done && /^rto_/.test(status) && status !== 'rto_lost') status = 'rto_delivered';
	const rtoDeliveredAt =
		done?.at ??
		srDate(first(sh.rto_delivered_date, o.rto_delivered_date)) ??
		(status === 'rto_delivered' ? srDate(first(st0?.delivered_date, sh.delivered_date)) ?? last?.at ?? null : null);

	const products: any[] = Array.isArray(o.products) ? o.products : [];
	const fallbackPrice = products.length ? total / products.length : 0;
	// Without a whitelisted IP, Shiprocket masks customer details ("98XXXXXX10", "Ra****"): keep those empty, never half-numbers
	const masked = (v: unknown) => /[*]|x{2,}/i.test(String(v ?? ''));
	const phone = masked(o.customer_phone) ? '' : String(o.customer_phone ?? '').replace(/\D+/g, '');

	return {
		awb: awb || String(st0?.awb_code ?? '').trim(),
		rto_awb: str(first(sh.rto_awb, sh.return_awb, o.rto_awb)),
		order_no: normalizeOrderNo(first(o.channel_order_id, o.order_id)),
		order_name: str(first(o.channel_order_id, o.order_id)),
		carrier_name: str(first(sh.courier, sh.courier_name, st0?.courier_name, o.courier_name)),
		status,
		sub_status: str(o.status),
		payment_mode: isCod ? 'cod' : 'prepaid',
		order_value: total,
		amount_collected: isCod ? 0 : total,
		customer_name: masked(o.customer_name) ? null : str(o.customer_name),
		customer_phone10: phone.length >= 10 ? phone.slice(-10) : null,
		rto_reason: str(first(o.rto_reason, sh.rto_reason)),
		rto_charges: num(first(sh.rto_charges, o.rto_charges)),
		rto_delivered_at: rtoDeliveredAt,
		last_event_at: last?.at ?? srDate(first(o.updated_at)) ?? null,
		last_event_text: last?.text ?? str(o.status),
		last_event_location: last?.loc ?? null,
		shipment_id: str(first(sh.id, o.id)),
		items: products.map((p: any) => ({
			sku: str(first(p.channel_sku, p.sku)),
			name: str(p.name),
			qty: Number(p.quantity) || 1,
			price: num(first(p.selling_price, p.price, p.unit_price)) ?? fallbackPrice
		})),
		raw: { order: o, tracking: td }
	};
}

/**
 * Older-orders sweep. Shiprocket's order list returns only the last 30 days unless dates are given,
 * so an RTO on an older order (e.g. #3999, ordered 30 Aug, back 22 Oct) was never seen. Each sync also
 * reads one 10-day window of orders 30–90 days old (6 windows, one per run, then start over), passing
 * from/to dates. If Shiprocket ignores the dates, the run says so (dates_honoured: false) and uses nothing from it.
 */
export const SWEEP_SKIP_DAYS = 30;
export const SWEEP_WINDOW_DAYS = 10;
export const SWEEP_WINDOWS = 6;
export type SweepCursor = { window: number; page: number };

const istDate = (now: number, daysBack: number) => new Date(now + 5.5 * 3_600_000 - daysBack * 86_400_000).toISOString().slice(0, 10);

export function readSweepCursor(v: unknown): SweepCursor {
	const o = (v && typeof v === 'object' ? v : {}) as { window?: unknown; page?: unknown };
	const w = Number(o.window), p = Number(o.page);
	return {
		window: Number.isInteger(w) && w >= 0 && w < SWEEP_WINDOWS ? w : 0,
		page: Number.isInteger(p) && p >= 1 ? p : 1
	};
}

/** The date range (IST, YYYY-MM-DD, both ends included) a cursor reads; window 0 = orders 31–40 days old. */
export function sweepRange(c: SweepCursor, now: number): { from: string; to: string } {
	const near = SWEEP_SKIP_DAYS + c.window * SWEEP_WINDOW_DAYS + 1;
	return { from: istDate(now, near + SWEEP_WINDOW_DAYS - 1), to: istDate(now, near) };
}

/** After reading `pagesRead` pages: same window, next pages; or, at the window's end, the next window (wrapping). */
export function nextSweep(c: SweepCursor, pagesRead: number, hitEnd: boolean): SweepCursor {
	if (hitEnd) return { window: (c.window + 1) % SWEEP_WINDOWS, page: 1 };
	return { window: c.window, page: c.page + Math.max(pagesRead, 1) };
}

/** True when every returned order was created on or before the window's last day (i.e. Shiprocket used the dates). */
export function datesHonoured(createdAt: (string | null)[], to: string): boolean {
	const limit = Date.parse(`${to}T23:59:59+05:30`) + 3_600_000;
	return createdAt.every((iso) => !iso || Date.parse(iso) <= limit);
}

/** A sweep row whose last movement is older than this is settled history: never added (avoids false "not received" alerts). */
export const DEEP_MAX_AGE_DAYS = 45;
export function deepRowTooOld(row: { rto_delivered_at: string | null; last_event_at: string | null }, now: number, maxDays = DEEP_MAX_AGE_DAYS): boolean {
	const t = Date.parse(row.rto_delivered_at ?? row.last_event_at ?? '');
	return !Number.isFinite(t) || now - t > maxDays * 86_400_000;
}
