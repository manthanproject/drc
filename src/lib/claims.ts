// RTO claims at scan (Phase 3c). Pure parts, tested: reasons, Velocity dispute types, the ready-to-paste remarks.
// The SQL function create_rto_claim() holds the same reason → condition / claims.reason mapping.

export type ReasonKey = 'wrong' | 'damaged' | 'missing' | 'leak' | 'empty' | 'near_expiry';

export interface ClaimReason {
	key: ReasonKey;
	label: string;
	/** claims.reason stored in the database */
	claimReason: 'wrong_product' | 'damaged' | 'missing_items';
	/** what you see, in the remarks */
	finding: string;
}

export const REASONS: ClaimReason[] = [
	{ key: 'wrong', label: 'Wrong product', claimReason: 'wrong_product', finding: 'we found a different product inside, not the item we shipped' },
	{ key: 'damaged', label: 'Damaged', claimReason: 'damaged', finding: 'the product was found damaged' },
	{ key: 'missing', label: 'Missing items', claimReason: 'missing_items', finding: 'items we shipped were missing from the package' },
	{ key: 'leak', label: 'Leak', claimReason: 'damaged', finding: 'the product had leaked / broken inside the package' },
	{ key: 'empty', label: 'Empty', claimReason: 'missing_items', finding: 'the package was empty, the product we shipped was not inside' },
	{ key: 'near_expiry', label: 'Near expiry', claimReason: 'wrong_product', finding: 'we found a different, near-expiry unit inside, not the fresh stock we shipped' }
];
export const reasonOf = (k: unknown): ClaimReason | undefined => REASONS.find((r) => r.key === k);

/** Velocity panel → Order Details → Dispute: the option to choose, per claims.reason. */
const VELOCITY_TYPE: Record<string, string> = {
	mdnd: 'MDND',
	wrong_product: 'Wrong Product Received',
	damaged: 'Damaged Product Received',
	missing_items: 'Missing items in package',
	cod_fraud: 'COD Fraud / Payment not received'
};
export const velocityDisputeType = (claimReason: string | null | undefined): string | null => VELOCITY_TYPE[String(claimReason ?? '')] ?? null;

const REASON_LABEL: Record<string, string> = {
	mdnd: 'MDND',
	wrong_product: 'Wrong product',
	damaged: 'Damaged',
	missing_items: 'Missing items',
	lost: 'Lost',
	cod_fraud: 'COD fraud',
	other: 'Other'
};
export const claimReasonLabel = (r: string | null | undefined) => REASON_LABEL[String(r ?? '')] ?? 'Claim';

const STATUS: Record<string, [string, 'ok' | 'warn' | 'bad' | 'mute' | 'acc']> = {
	draft: ['Draft, not raised', 'bad'],
	raised: ['Raised', 'warn'],
	waiting: ['Waiting', 'warn'],
	approved: ['Approved', 'ok'],
	rejected: ['Rejected', 'bad'],
	escalated: ['Escalated', 'warn'],
	closed: ['Closed', 'mute']
};
export const claimStatus = (s: string | null | undefined) => {
	const hit = STATUS[String(s ?? '')];
	return hit ? { label: hit[0], tone: hit[1] } : { label: String(s ?? 'Unknown'), tone: 'mute' as const };
};

// ---------- evidence ----------
export type MediaKind = 'unboxing_video' | 'front' | 'back' | 'label';
export const EVIDENCE: { kind: MediaKind; label: string; video: boolean }[] = [
	{ kind: 'unboxing_video', label: 'Unboxing video, all sides', video: true },
	{ kind: 'front', label: 'Front photo', video: false },
	{ kind: 'back', label: 'Back photo', video: false },
	{ kind: 'label', label: 'Label photo', video: false }
];
export const isMediaKind = (k: unknown): k is MediaKind => EVIDENCE.some((e) => e.kind === k);

export const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

/** Velocity's partial-COD dummy line ("Pay on Delivery", no SKU, price = COD amount) is not a product. */
export function isDummyItem(it: { sku?: string | null; title?: string | null }): boolean {
	return !String(it.sku ?? '').trim() && /^pay on delivery\b/i.test(String(it.title ?? '').trim());
}

/** File names in a claim folder start with this ('1642-1_', 'Krishna_1005_'). */
export const orderFilePrefix = (orderNo: string) => `${String(orderNo).replace(/[^\w-]+/g, '_')}_`;

/** Upload file name in the claim folder: 3379_front_20261006-1142.jpg (IST). */
export function mediaFileName(orderNo: string, kind: string, ext: string, now: number): string {
	const d = new Date(now + 5.5 * 3_600_000).toISOString(); // IST wall clock
	const stamp = `${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 16).replace(':', '')}`;
	const safeOrder = orderFilePrefix(orderNo).slice(0, -1);
	const safeExt = String(ext).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
	return `${safeOrder}_${kind}_${stamp}.${safeExt}`;
}

/** Extension from a file name or mime type ('video/webm;codecs=vp9' → 'webm'). */
export function extOf(name: string | null | undefined, mime: string | null | undefined): string {
	const fromName = String(name ?? '').match(/\.([a-z0-9]{2,5})$/i)?.[1];
	if (fromName) return fromName.toLowerCase();
	const sub = String(mime ?? '').split('/')[1]?.split(';')[0] ?? '';
	return ({ jpeg: 'jpg', quicktime: 'mov', 'x-matroska': 'mkv' } as Record<string, string>)[sub] ?? (sub || 'bin');
}

// ---------- remarks ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '4 Oct 2026' in IST. */
export function dateLong(iso: string | null | undefined): string {
	const t = iso ? Date.parse(iso) : NaN;
	if (Number.isNaN(t)) return '';
	const d = new Date(t + 5.5 * 3_600_000);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export interface RemarksInput {
	order_no: string | null;
	forward_awb: string | null;
	order_value: number | string | null;
	rto_delivered_at: string | null;
	received_at: string; // scan time (fallback date)
	reason: ReasonKey;
	items: { title: string; qty: number }[];
	links: { packing?: string | null; unboxing?: string | null; folder?: string | null };
}

/** The remarks to paste into Velocity → Dispute (editable before copying). Never names the company, only "our warehouse". */
export function claimRemarks(x: RemarksInput): string {
	const reason = reasonOf(x.reason)!;
	const order = /^\d+(-\d+)*$/.test(String(x.order_no ?? '')) ? `#Dropy-${x.order_no}` : String(x.order_no ?? '');
	const when = x.rto_delivered_at
		? `was delivered back to our warehouse on ${dateLong(x.rto_delivered_at)}`
		: `was received back at our warehouse on ${dateLong(x.received_at)}`;
	const list = x.items.map((i) => `${i.title.replace(/\s+/g, ' ').trim()} (qty ${i.qty})`).join('; ');
	const value = Number(x.order_value);
	const lines = [
		`RTO for order ${order} (AWB ${x.forward_awb ?? '—'}) ${when}. On opening it, ${reason.finding}.`,
		list ? `${x.items.length > 1 ? 'Affected items' : 'Affected item'}: ${list}.` : '',
		x.links.packing ? `Pre-dispatch packing video with label: ${x.links.packing}` : '',
		x.links.unboxing ? `Unboxing video showing all sides and the label: ${x.links.unboxing}` : '',
		x.links.folder ? `All photos (front, back, label) and videos: ${x.links.folder}` : '',
		`Claim value ₹${inrFmt.format(Number.isFinite(value) ? Math.round(value) : 0)} (full order value). Please approve and issue a credit note.`
	];
	return lines.filter(Boolean).join('\n');
}

export const velocityOrderUrl = (orderNo: string | null | undefined) =>
	`https://dashboard.velocity.in/shipping/orders?order_status=all&search=${encodeURIComponent(orderNo ?? '')}`;

// ---------- MDND (marked delivered back, never received) ----------

/** '5 Oct 2026 at 9:32 pm' in IST. */
export function dateTimeLong(iso: string | null | undefined): string {
	const t = iso ? Date.parse(iso) : NaN;
	if (Number.isNaN(t)) return '';
	const d = new Date(t + 5.5 * 3_600_000);
	const h = d.getUTCHours(), m = d.getUTCMinutes();
	return `${dateLong(iso)} at ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** 'DELHI  HUB ,DELHI' → 'DELHI HUB, DELHI'; empty, ', ' or code-only → null (DTDC often sends ', '). */
export function placeText(v: string | null | undefined): string | null {
	const s = String(v ?? '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
	return /[a-z]/i.test(s) ? s : null;
}

/** 'DTDC Standard 250G' → 'DTDC'. */
export const carrierShort = (name: string | null | undefined) => String(name ?? '').trim().split(/\s+/)[0] || 'the courier';

export interface BulkRto {
	id: string;
	carrier_name: string | null;
	rto_delivered_at: string | null;
	scanned_at?: string | null;
}

/**
 * Bulk-update evidence: the courier marked 3+ of our RTOs "delivered" in the SAME minute and NONE of them reached us.
 * Returns null when it would not help (fewer than 3, or any of them was actually received and scanned).
 */
export function bulkSameMinute(target: BulkRto, all: BulkRto[]): { count: number; at: string } | null {
	const t = target.rto_delivered_at ? Date.parse(target.rto_delivered_at) : NaN;
	if (Number.isNaN(t)) return null;
	const minute = Math.floor(t / 60_000);
	const carrier = carrierShort(target.carrier_name).toLowerCase();
	const group = all.filter((r) => {
		const x = r.rto_delivered_at ? Date.parse(r.rto_delivered_at) : NaN;
		return !Number.isNaN(x) && Math.floor(x / 60_000) === minute && carrierShort(r.carrier_name).toLowerCase() === carrier;
	});
	if (!group.some((r) => r.id === target.id)) group.push(target);
	if (group.length < 3 || group.some((r) => r.scanned_at)) return null;
	return { count: group.length, at: target.rto_delivered_at! };
}

export interface MdndInput {
	order_no: string | null;
	forward_awb: string | null;
	carrier_name: string | null;
	order_value: number | string | null;
	rto_delivered_at: string | null;
	last_event_text?: string | null;
	last_event_location?: string | null;
	packing?: string | null;
	bulk?: { count: number; at: string } | null;
}

/** MDND remarks for Velocity → Dispute → MDND. Never names the company. */
export function mdndRemarks(x: MdndInput): string {
	const order = /^\d+(-\d+)*$/.test(String(x.order_no ?? '')) ? `#Dropy-${x.order_no}` : String(x.order_no ?? '');
	const carrier = carrierShort(x.carrier_name);
	const place = placeText(x.last_event_location);
	const where = place && /deliver/i.test(x.last_event_text ?? '') ? ` at ${place}` : '';
	const when = x.rto_delivered_at ? ` on ${dateTimeLong(x.rto_delivered_at)}` : '';
	const value = Number(x.order_value);
	const amount = `₹${inrFmt.format(Number.isFinite(value) ? Math.round(value) : 0)}`;
	return [
		`RTO for order ${order} (AWB ${x.forward_awb ?? '—'}, ${carrier}) is marked "Return - Delivered"${when}${where}, but it has not been received at our warehouse.`,
		x.bulk
			? `${carrier} marked ${x.bulk.count} of our RTOs as delivered in the same minute (${dateTimeLong(x.bulk.at)}), and none of them has reached our warehouse. This points to a bulk status update, not real deliveries.`
			: '',
		x.packing ? `Pre-dispatch packing video with label: ${x.packing}` : '',
		`Please share the POD (receiver signature / delivery photo / receiver name and ID) within 48 hours, or treat the shipment as lost and settle the claim for the full order value of ${amount}.`
	]
		.filter(Boolean)
		.join('\n');
}
