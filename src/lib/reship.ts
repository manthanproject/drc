// Re-ship detector (Phase 3a): pure matching, tested against real Velocity probe data (3544, 1642, 4042).
// An RTO counts as "received and re-shipped" only when ALL hold:
//   1. it is awaiting_receipt (courier said delivered back)        ← caller filters
//   2. Velocity has a shipment numbered <RTO order>-<N> (one level deeper: 3544 → 3544-1, 1642-1 → 1642-1-1)
//   3. that shipment was created AFTER the RTO came back (order_date is copied on re-ships, so never used)
//   4. it shares at least one SKU with the RTO
// The match is only a SUGGESTION: staff confirm with one tap.

export interface ReshipRto {
	order_no: string;
	rto_delivered_at: string;
	skus: string[];
}

export interface ReshipMatch {
	reship_order_no: string;
	reship_awb: string | null;
	reship_created_at: string;
	reship_courier_status: string | null;
}

/** '#Dropy-3544-1' → '3544-1' (same rule as the sync's normalizeOrderNo). */
export function orderNoOf(display: unknown): string {
	const s = String(display ?? '').trim().replace(/^#/, '');
	const m = s.match(/^dropy-?(.+?)(?:-all|-[a-z])?$/i);
	return (m ? m[1] : s).trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What to type in Velocity's search box: the base number, which also finds every re-ship. */
export const searchTermFor = (orderNo: string) => orderNo.split('-')[0];

export function pickReship(rto: ReshipRto, shipments: any[]): ReshipMatch | null {
	const back = Date.parse(rto.rto_delivered_at);
	if (!Number.isFinite(back)) return null;
	const skus = new Set(rto.skus.filter(Boolean).map((s) => s.toLowerCase()));
	if (skus.size === 0) return null; // cannot prove it's the same product → never suggest
	const child = new RegExp(`^${esc(rto.order_no)}-\\d+$`, 'i');

	const hits: ReshipMatch[] = [];
	for (const row of shipments ?? []) {
		const a = row?.attributes ?? {};
		const no = orderNoOf(a.order?.display_id);
		if (!child.test(no)) continue;
		const created = Date.parse(a.created_at);
		if (!Number.isFinite(created) || created <= back) continue;
		const shared = (Array.isArray(a.items) ? a.items : []).some(
			(i: any) => typeof i?.sku === 'string' && skus.has(i.sku.toLowerCase())
		);
		if (!shared) continue;
		hits.push({
			reship_order_no: no,
			reship_awb: a.tracking_number ? String(a.tracking_number) : null,
			reship_created_at: new Date(created).toISOString(),
			reship_courier_status: a.status ? String(a.status) : null
		});
	}
	hits.sort((x, y) => Date.parse(x.reship_created_at) - Date.parse(y.reship_created_at));
	return hits[0] ?? null;
}
