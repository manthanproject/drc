/** Why a parcel came back: the courier's RTO reason (or its last NDR reason), in plain words. */

const LABELS: Record<string, string> = {
	customer_refused_to_accept: 'Customer refused to accept',
	customer_not_available: 'Customer not available',
	consignee_uncontactable: 'Customer not reachable',
	consignee_unavailable: 'Customer not available',
	address_incomplete: 'Address incomplete',
	incorrect_address: 'Wrong address',
	future_delivery_requested: 'Customer asked for a later delivery',
	delivery_attempted: 'Delivery attempted, not delivered',
	courier_delay: 'Courier delay',
	max_attempts_reached_for_self_collect: 'Max attempts reached (self-collect)',
	customer_cancelled_order_otp_verified: 'Customer cancelled the order (OTP verified)',
	cancelled_by_seller_via_panel: 'Cancelled by us in the courier panel',
	cod_not_ready: 'Customer did not have the COD amount',
	other: 'Other (courier gave no detail)'
};

/** 'customer_refused_to_accept' → 'Customer refused to accept'; plain text ('Consignee unavailable') is kept as is. */
export function reasonLabel(raw: unknown): string | null {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	const key = s.toLowerCase();
	if (LABELS[key]) return LABELS[key];
	if (/^[a-z0-9]+(_[a-z0-9]+)+$/i.test(s)) {
		const words = key.replace(/_/g, ' ');
		return words.charAt(0).toUpperCase() + words.slice(1);
	}
	return s;
}

/** The reason to show for an RTO: rto_reason first, then the courier's last NDR reason. Customer returns use return_reason instead. */
export function rtoReason(r: { kind?: string | null; rto_reason?: string | null; ndr_reason?: string | null } | null | undefined): string | null {
	if (!r || r.kind === 'customer_return') return null;
	return reasonLabel(r.rto_reason) ?? reasonLabel(r.ndr_reason);
}
