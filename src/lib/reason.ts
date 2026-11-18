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

/* ── Exact reason from the courier's full tracking (Velocity /order-tracking → shipment_track_activities) ── */

export interface Activity { date?: string | null; activity?: string | null; location?: string | null }
export interface ReasonHit { text: string; at: string | null; location: string | null }
export interface ExactReason { text: string; at: string | null; location: string | null; earlier: ReasonHit[] }

/** Progress / movement scans: never a reason. */
const NOT_REASON = /misroute|cut-?off|out ?for ?delivery|scheduled for|reattempt initiated|in ?transit|^\s*return\b|returninitiated|\brto\b|picked|pickup|booked|arrived|departed|processing|at destination|reached at|fdm|manifest|ready ?for|^\s*delivered\s*$/i;
/** Words a failed-delivery note uses. */
const IS_REASON = /refus|reject|unsuccess|not avail|unavail|door|closed|address|uncontact|not reach|not contact|no response|\bcod\b|cash|cancel|future|reschedul|deni|customer|consignee|recipient|receiver|undeliver|not deliver|\bndr\b|\boda\b|holiday|premises|wrong/i;
/** The moment the RTO started. */
const RTO_START = /return\s*-?\s*init|returninitiated|rto (approved|initiated)/i;

/** 'RECEIVER REFUSED DELIVERY(CIR)' → 'Receiver refused delivery'; trailing '.' removed. */
export function tidyActivity(s: string): string {
	let t = s.replace(/\s*\((?:[A-Z]{2,5})\)\s*$/, '').replace(/[\s.\-–]+$/, '').replace(/\s+/g, ' ').trim();
	if (t && t === t.toUpperCase() && /[A-Z]/.test(t)) t = t.charAt(0) + t.slice(1).toLowerCase();
	return t;
}

const isReasonText = (s: string) => !!s && !NOT_REASON.test(s) && IS_REASON.test(s);
const time = (d: string | null | undefined) => {
	const n = Date.parse(String(d ?? '').replace(' ', 'T'));
	return Number.isFinite(n) ? n : NaN;
};

/**
 * The courier's own failed-delivery note that led to the RTO: the last one at or before the first
 * return-start scan (all of them when no start scan is found). Up to 2 different earlier notes are kept.
 */
export function exactReason(activities: Activity[] | null | undefined): ExactReason | null {
	const list = (Array.isArray(activities) ? activities : [])
		.map((a) => ({ raw: String(a?.activity ?? '').trim(), at: a?.date ?? null, t: time(a?.date), location: String(a?.location ?? '').replace(/\s*,\s*/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '') || null }))
		.filter((a) => a.raw)
		.sort((x, y) => (Number.isNaN(x.t) ? 0 : x.t) - (Number.isNaN(y.t) ? 0 : y.t)); // oldest first
	const startAt = list.find((a) => RTO_START.test(a.raw))?.t;
	const fails = list.filter((a) => isReasonText(a.raw) && (startAt === undefined || Number.isNaN(a.t) || a.t <= startAt));
	if (!fails.length) return null;
	const last = fails[fails.length - 1];
	const text = tidyActivity(last.raw);
	const earlier: ReasonHit[] = [];
	for (let i = fails.length - 2; i >= 0 && earlier.length < 2; i--) {
		const e = tidyActivity(fails[i].raw);
		if (e.toLowerCase() !== text.toLowerCase() && !earlier.some((x) => x.text.toLowerCase() === e.toLowerCase())) earlier.push({ text: e, at: fails[i].at, location: fails[i].location });
	}
	return { text, at: last.at, location: last.location, earlier };
}
