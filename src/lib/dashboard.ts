// DRC Phase 2: everything the Dashboard and All RTOs list compute, as pure functions.
// No SvelteKit / Supabase imports here, so `npm test` can run it directly.

export const DAY = 86_400_000;

export type Stage =
	| 'in_flight' | 'delayed' | 'lost' | 'awaiting_receipt' | 'scanned' | 'inspected' | 'to_call'
	| 'reship' | 'ready_stock' | 'store_credit' | 'hold' | 'claim' | 'closed' | 'unknown_parcel';

export interface Rto {
	id: string;
	courier: 'velocity' | 'shiprocket' | null;
	carrier_name: string | null;
	order_no: string | null;
	order_name: string | null;
	forward_awb: string | null;
	rto_awb: string | null;
	scanned_code: string | null;
	payment_mode: 'cod' | 'prepaid' | 'partial' | null;
	order_value: number | string | null;
	customer_name: string | null;
	customer_phone10: string | null;
	stage: Stage;
	courier_status: string | null;
	rto_delivered_at: string | null;
	last_movement_at: string | null;
	last_event_at: string | null;
	legacy_source: string | null;
	amount_collected?: number | string | null;
	disputes?: VelDispute[] | null; // Velocity shipment_disputes (from the 15-min sync)
	reship_order_no?: string | null;
	reship_awb?: string | null;
	reship_created_at?: string | null;
	reship_courier_status?: string | null;
	reship_state?: 'none' | 'pending' | 'confirmed' | 'rejected' | null;
	scanned_at?: string | null;
	media_folder_id?: string | null;
}

/** One Velocity dispute as the API returns it (seen 6 Oct: status 'raised' = "In Review" in the panel). */
export interface VelDispute {
	id: string;
	status: string | null;
	dispute_type: string | null;
	raised_at: string | null;
	reason?: string | null;
	images?: unknown[] | null;
}

const DISPUTE_STATUS: Record<string, [string, Tone]> = {
	raised: ['In Review', 'warn'],
	in_review: ['In Review', 'warn'],
	approved: ['Approved', 'ok'],
	accepted: ['Approved', 'ok'],
	resolved: ['Resolved', 'ok'],
	rejected: ['Rejected', 'bad'],
	declined: ['Rejected', 'bad'],
	closed: ['Closed', 'mute']
};
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Velocity status → panel wording + tone. Unknown statuses are shown as-is (title case), never hidden. */
export function disputeStatus(status: string | null | undefined): { label: string; tone: Tone } {
	const k = String(status ?? '').toLowerCase();
	const hit = DISPUTE_STATUS[k];
	return hit ? { label: hit[0], tone: hit[1] } : { label: k ? titleCase(k) : 'Unknown', tone: 'mute' };
}

const DISPUTE_TYPE: Record<string, string> = {
	mdnd: 'MDND (marked delivered, not received)',
	wrong_product: 'Wrong product received',
	wrong_product_received: 'Wrong product received',
	damaged: 'Damaged product received',
	damaged_product_received: 'Damaged product received',
	missing_items: 'Missing items in package',
	cod_fraud: 'COD fraud / payment not received'
};
export const disputeType = (t: string | null | undefined) => DISPUTE_TYPE[String(t ?? '').toLowerCase()] ?? (t ? titleCase(String(t)) : 'Dispute');

/** Newest Velocity dispute of an RTO, if any. */
export function latestDispute(r: Pick<Rto, 'disputes'> | null | undefined): VelDispute | null {
	const list = Array.isArray(r?.disputes) ? r!.disputes! : [];
	return [...list].sort((a, b) => String(b.raised_at ?? '').localeCompare(String(a.raised_at ?? '')))[0] ?? null;
}

export interface Claim {
	id: string;
	rto_id: string;
	reason: string;
	status: string;
	deadline_at: string | null;
	approved_at: string | null;
	raised_at?: string | null;
	outstanding: number | string | null; // from view claim_money
}

export interface Rules {
	mdndHours: number;
	delayedDays: number;
	windowDays: number;
}

export const DEFAULT_RULES: Rules = { mdndHours: 48, delayedDays: 3, windowDays: 7 };

export const num = (v: unknown): number => {
	const n = typeof v === 'number' ? v : Number(v ?? 0);
	return Number.isFinite(n) ? n : 0;
};
const ms = (iso: string | null | undefined): number | null => {
	if (!iso) return null;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? null : t;
};
const daysSince = (t: number, now: number) => Math.max(0, Math.floor((now - t) / DAY));
const agoDays = (n: number) => (n === 0 ? 'today' : `${n} d ago`);

// ---------- identity helpers ----------

/** Last courier movement we know of. Null = no tracking date (never "delayed"). */
export const lastMove = (r: Rto): number | null => ms(r.last_movement_at) ?? ms(r.last_event_at);

/** Sheet-only rows (old manual tracker) have no AWB and no courier: nothing to open. */
export const isSheetOnly = (r: Rto): boolean => r.legacy_source === 'sheet' || !r.forward_awb;

/** Orders on the Velocity account that are not Dropy orders ("Praveen", "Krishna 1005"). */
export const isNonDropy = (r: Rto): boolean => !!r.order_no && !/^\d+(-\d+)*$/.test(r.order_no);

export const orderLabel = (r: Rto): string =>
	!r.order_no ? 'Unknown parcel' : isNonDropy(r) ? r.order_no : `#${r.order_no}`;

/** Public tracking page for the row tap, until the Phase 3 detail screen exists. */
export function trackingUrl(r: Rto): string | null {
	if (isSheetOnly(r)) return null;
	if (r.courier === 'velocity') return `https://www.velocityshipping.in/track/${encodeURIComponent(r.forward_awb!)}`;
	return null; // Shiprocket not ingested yet
}

// ---------- buckets ----------

export type BucketKey =
	| 'coming' | 'delayed' | 'awaiting' | 'inspect' | 'call' | 'claims'
	| 'reship' | 'ready_stock' | 'hold' | 'store_credit' | 'inspected' | 'lost' | 'unknown_parcel' | 'closed';

export type Tone = 'acc' | 'ok' | 'warn' | 'bad' | 'mute';

export const BUCKETS: Record<BucketKey, { label: string; tone: Tone }> = {
	coming: { label: 'Coming back', tone: 'mute' },
	delayed: { label: 'Delayed', tone: 'warn' },
	awaiting: { label: 'Arrived, not scanned', tone: 'acc' },
	inspect: { label: 'To inspect', tone: 'acc' },
	call: { label: 'To call', tone: 'warn' },
	claims: { label: 'Claim', tone: 'bad' },
	reship: { label: 'Re-ship', tone: 'ok' },
	ready_stock: { label: 'Ready Stock', tone: 'ok' },
	hold: { label: 'Hold', tone: 'warn' },
	store_credit: { label: 'Store credit', tone: 'ok' },
	inspected: { label: 'Inspected', tone: 'acc' },
	lost: { label: 'Lost', tone: 'bad' },
	unknown_parcel: { label: 'Unknown parcel', tone: 'bad' },
	closed: { label: 'Closed', tone: 'mute' }
};

/** Shown as the compact "Parked / done" row, in this order, only when count > 0. */
export const PARKED: BucketKey[] = ['reship', 'ready_stock', 'hold', 'store_credit', 'inspected', 'lost', 'unknown_parcel', 'closed'];

/** Delayed needs a real event date; no date = "no tracking date", stays in Coming back. */
export function isDelayed(r: Rto, now: number, rules: Rules): boolean {
	if (r.stage === 'delayed') return true;
	if (r.stage !== 'in_flight') return false;
	const t = lastMove(r);
	return t !== null && now - t >= rules.delayedDays * DAY;
}

/** Every RTO lands in exactly one bucket. */
export function bucketOf(r: Rto, now: number, rules: Rules): BucketKey {
	switch (r.stage) {
		case 'in_flight':
		case 'delayed':
			return isDelayed(r, now, rules) ? 'delayed' : 'coming';
		case 'awaiting_receipt':
			return 'awaiting';
		case 'scanned':
			return 'inspect';
		case 'to_call':
			return 'call';
		case 'claim':
			return 'claims';
		default:
			return r.stage as BucketKey;
	}
}

/** Bucket for a bare stage name (no dates needed): in_flight → coming, etc. */
export function bucketOfStage(stage: string): BucketKey {
	switch (stage) {
		case 'in_flight': return 'coming';
		case 'delayed': return 'delayed';
		case 'awaiting_receipt': return 'awaiting';
		case 'scanned': return 'inspect';
		case 'to_call': return 'call';
		case 'claim': return 'claims';
		default: return stage as BucketKey;
	}
}

const OPEN_CLAIM = new Set(['draft', 'raised', 'waiting', 'approved', 'escalated']);

// ---------- needs action ----------

export type ActionKind = 'mdnd' | 'no_date' | 'lost' | 'unknown' | 'claim_window' | 'credit_due' | 'reship_found';

export interface ActionItem {
	key: string;
	kind: ActionKind;
	rto: Rto | null;
	title: string;
	detail: string;
	amount: number;
	ageDays: number | null; // null = no tracking date
	deadline: number | null; // end of the dispute window (ms)
	daysLeft: number | null; // whole days left, only while the window is open
	windowClosed: boolean;
	ageNote?: string; // replaces the age line (claims: "Raised 4 Oct")
	tone: Tone;
	href: string | null;
	nonDropy: boolean;
}

const carrierOf = (r: Rto) => r.carrier_name || (r.courier === 'velocity' ? 'Velocity' : 'Courier');

function windowFields(deadline: number | null, now: number) {
	if (deadline === null) return { deadline, daysLeft: null, windowClosed: false };
	const left = deadline - now;
	return left > 0
		? { deadline, daysLeft: Math.floor(left / DAY), windowClosed: false }
		: { deadline, daysLeft: null, windowClosed: true };
}

const toneFor = (i: Pick<ActionItem, 'daysLeft' | 'windowClosed' | 'kind'>): Tone => {
	if (i.kind === 'reship_found') return 'ok';
	if (i.daysLeft !== null) return i.daysLeft <= 2 ? 'bad' : 'warn';
	if (i.kind === 'lost' || i.kind === 'unknown') return 'bad';
	if (i.windowClosed || i.kind === 'no_date') return 'mute';
	return 'warn';
};

export function needsAction(rtos: Rto[], claims: Claim[], rules: Rules, now: number): ActionItem[] {
	const out: ActionItem[] = [];
	const byId = new Map(rtos.map((r) => [r.id, r]));
	const push = (i: Omit<ActionItem, 'tone' | 'href' | 'nonDropy'>) =>
		out.push({ ...i, tone: toneFor(i), href: i.rto ? trackingUrl(i.rto) : null, nonDropy: i.rto ? isNonDropy(i.rto) : false });

	for (const r of rtos) {
		if (r.stage === 'awaiting_receipt') {
			const t = ms(r.rto_delivered_at);
			if (r.reship_state === 'pending' && r.reship_order_no) {
				// Probably received and re-shipped: one tap to confirm instead of an MDND claim
				push({ key: `rs-${r.id}`, kind: 'reship_found', rto: r, title: `${orderLabel(r)} re-shipped as #${r.reship_order_no}`,
					detail: `Re-ship created ${dateShort(r.reship_created_at)}, after it came back. Received it?`,
					amount: num(r.order_value), ageDays: t === null ? null : daysSince(t, now),
					...windowFields(t === null ? null : t + rules.windowDays * DAY, now) });
			} else if (t === null) {
				push({ key: `nd-${r.id}`, kind: 'no_date', rto: r, title: `${orderLabel(r)} not received`,
					detail: `${carrierOf(r)} says RTO delivered, never scanned in`, amount: num(r.order_value),
					ageDays: null, ...windowFields(null, now) });
			} else if (now - t >= rules.mdndHours * 3_600_000) {
				push({ key: `mdnd-${r.id}`, kind: 'mdnd', rto: r, title: `${orderLabel(r)} not received`,
					detail: `${carrierOf(r)} says delivered ${dateShort(r.rto_delivered_at)}, never scanned in`,
					amount: num(r.order_value), ageDays: daysSince(t, now), ...windowFields(t + rules.windowDays * DAY, now) });
			}
		} else if (r.stage === 'lost') {
			const t = lastMove(r);
			push({ key: `lost-${r.id}`, kind: 'lost', rto: r, title: `${orderLabel(r)} marked lost`,
				detail: `${carrierOf(r)} says lost${t ? ` ${dateShort(new Date(t).toISOString())}` : ''}, raise a claim`,
				amount: num(r.order_value), ageDays: t === null ? null : daysSince(t, now), ...windowFields(null, now) });
		} else if (r.stage === 'unknown_parcel') {
			push({ key: `unk-${r.id}`, kind: 'unknown', rto: r, title: 'Unknown parcel',
				detail: r.scanned_code ? `Scanned ${r.scanned_code}, match it to an order` : 'Match it to an order',
				amount: num(r.order_value), ageDays: null, ...windowFields(null, now) });
		}
	}

	for (const c of claims) {
		const r = byId.get(c.rto_id) ?? null;
		const label = r ? orderLabel(r) : 'Claim';
		const owed = num(c.outstanding);
		if (c.status === 'approved' && owed > 0) {
			const t = ms(c.approved_at);
			push({ key: `cn-${c.id}`, kind: 'credit_due', rto: r, title: `${label} credit note`,
				detail: 'Approved, money not received', amount: owed, ageNote: t === null ? undefined : `Approved ${dateShort(c.approved_at)}`,
				ageDays: t === null ? null : daysSince(t, now), ...windowFields(null, now) });
		} else if (['draft', 'raised', 'waiting', 'escalated'].includes(c.status) && c.deadline_at) {
			push({ key: `cw-${c.id}`, kind: 'claim_window', rto: r, title: `${label} claim window`,
				detail: `${(() => { const d = latestDispute(r); return d ? `Velocity: ${disputeStatus(d.status).label} · ` : ''; })()}Follow up by ${dateShort(c.deadline_at)}`, amount: owed, ageDays: null,
				ageNote: c.raised_at ? `Raised ${dateShort(c.raised_at)}` : 'Not raised yet',
				...windowFields(ms(c.deadline_at), now) });
		}
	}
	return sortAction(out);
}

/** Open dispute windows first (fewest days left first, then ₹), then everything else by ₹. */
export function sortAction(items: ActionItem[]): ActionItem[] {
	const open = items.filter((i) => i.daysLeft !== null);
	const rest = items.filter((i) => i.daysLeft === null);
	open.sort((a, b) => a.deadline! - b.deadline! || b.amount - a.amount);
	rest.sort((a, b) => b.amount - a.amount);
	return [...open, ...rest];
}

export const windowText = (i: ActionItem): string | null =>
	i.daysLeft !== null ? (i.daysLeft === 0 ? 'Last day' : `${i.daysLeft} d left`) : i.windowClosed ? 'Window closed' : null;

export const ageText = (i: ActionItem): string => i.ageNote ?? (i.ageDays === null ? 'no tracking date' : agoDays(i.ageDays));

// ---------- dashboard ----------

export interface Dashboard {
	total: number;
	coming: { n: number; started: number; moving: number; ofd: number; noDate: number };
	delayed: { n: number };
	awaiting: { n: number; value: number };
	inspect: { n: number };
	call: { n: number };
	claims: { n: number; atStake: number };
	creditDue: { n: number; value: number };
	parked: { key: BucketKey; label: string; n: number }[];
	action: ActionItem[];
}

export function buildDashboard(rtos: Rto[], claims: Claim[], rules: Rules, now: number): Dashboard {
	const d: Dashboard = {
		total: rtos.length,
		coming: { n: 0, started: 0, moving: 0, ofd: 0, noDate: 0 },
		delayed: { n: 0 },
		awaiting: { n: 0, value: 0 },
		inspect: { n: 0 },
		call: { n: 0 },
		claims: { n: 0, atStake: 0 },
		creditDue: { n: 0, value: 0 },
		parked: [],
		action: needsAction(rtos, claims, rules, now)
	};
	const openClaimsByRto = new Map<string, Claim[]>();
	for (const c of claims) if (OPEN_CLAIM.has(c.status)) openClaimsByRto.set(c.rto_id, [...(openClaimsByRto.get(c.rto_id) ?? []), c]);

	const parked = new Map<BucketKey, number>();
	for (const r of rtos) {
		const b = bucketOf(r, now, rules);
		switch (b) {
			case 'coming':
				d.coming.n++;
				if (r.courier_status === 'rto_initiated') d.coming.started++;
				else if (r.courier_status === 'rto_out_for_delivery') d.coming.ofd++;
				else d.coming.moving++;
				if (lastMove(r) === null) d.coming.noDate++;
				break;
			case 'delayed': d.delayed.n++; break;
			case 'awaiting': d.awaiting.n++; d.awaiting.value += num(r.order_value); break;
			case 'inspect': d.inspect.n++; break;
			case 'call': d.call.n++; break;
			case 'claims': {
				d.claims.n++;
				const cs = openClaimsByRto.get(r.id);
				// Until the claims table is seeded, ₹ at stake = full order value (decision 15).
				d.claims.atStake += cs ? cs.reduce((s, c) => s + num(c.outstanding), 0) : num(r.order_value);
				break;
			}
			default: parked.set(b, (parked.get(b) ?? 0) + 1);
		}
	}
	for (const c of claims) if (c.status === 'approved' && num(c.outstanding) > 0) { d.creditDue.n++; d.creditDue.value += num(c.outstanding); }
	d.parked = PARKED.filter((k) => parked.get(k)).map((k) => ({ key: k, label: BUCKETS[k].label, n: parked.get(k)! }));
	return d;
}

// ---------- All RTOs list ----------

export type ListFilter = 'all' | 'action' | 'credit' | BucketKey;

export const FILTERS: { key: ListFilter; label: string }[] = [
	{ key: 'all', label: 'All' },
	{ key: 'action', label: 'Needs action' },
	{ key: 'awaiting', label: 'Not scanned' },
	{ key: 'coming', label: 'Coming back' },
	{ key: 'delayed', label: 'Delayed' },
	{ key: 'inspect', label: 'To inspect' },
	{ key: 'call', label: 'To call' },
	{ key: 'claims', label: 'Claims' },
	{ key: 'credit', label: 'Credit due' },
	...PARKED.map((k) => ({ key: k as ListFilter, label: BUCKETS[k].label }))
];

export function parseFilter(v: string | null): ListFilter {
	return FILTERS.some((f) => f.key === v) ? (v as ListFilter) : 'all';
}

/** Order no. (with or without #, Dropy-, -ALL), AWB, phone (last 10), or name. */
export function matchesSearch(r: Rto, q: string): boolean {
	const s = q.trim().toLowerCase();
	if (!s) return true;
	const order = s.replace(/^#/, '').replace(/^dropy-/, '').replace(/-(all|a)$/, '');
	const digits = s.replace(/\D/g, '');
	if (r.order_no && r.order_no.toLowerCase().includes(order)) return true;
	if (r.forward_awb && r.forward_awb.toLowerCase().includes(s)) return true;
	if (r.rto_awb && r.rto_awb.toLowerCase().includes(s)) return true;
	if (digits.length >= 6 && r.customer_phone10 && r.customer_phone10.includes(digits.slice(-10))) return true;
	if (r.customer_name && r.customer_name.toLowerCase().includes(s)) return true;
	return false;
}

export interface ListRow {
	rto: Rto;
	bucket: BucketKey;
	value: number;
	when: number | null; // delivered back, else last courier move (for "oldest first")
	ageText: string;
	href: string | null;
	sheetOnly: boolean;
	nonDropy: boolean;
}

export function rowFor(r: Rto, now: number, rules: Rules): ListRow {
	const b = bucketOf(r, now, rules);
	let age: string;
	if (isSheetOnly(r)) age = 'From old sheet, no AWB';
	else if (b === 'awaiting' || r.rto_delivered_at) {
		const t = ms(r.rto_delivered_at);
		age = t === null ? 'RTO delivered, no tracking date' : `RTO delivered ${dateShort(r.rto_delivered_at)} · ${agoDays(daysSince(t, now))}`;
	} else {
		const t = lastMove(r);
		age = t === null ? 'no tracking date' : `Last move ${dateShort(new Date(t).toISOString())} · ${agoDays(daysSince(t, now))}`;
	}
	return { rto: r, bucket: b, value: num(r.order_value), when: ms(r.rto_delivered_at) ?? lastMove(r), ageText: age, href: trackingUrl(r), sheetOnly: isSheetOnly(r), nonDropy: isNonDropy(r) };
}

export function listRows(rtos: Rto[], filter: ListFilter, q: string, rules: Rules, now: number, claims: Claim[] = []): ListRow[] {
	let pick: Rto[];
	if (filter === 'all') pick = rtos;
	else if (filter === 'credit') {
		const ids = new Set(claims.filter((c) => c.status === 'approved' && num(c.outstanding) > 0).map((c) => c.rto_id));
		pick = rtos.filter((r) => ids.has(r.id));
	} else if (filter === 'action') pick = [];
	else pick = rtos.filter((r) => bucketOf(r, now, rules) === filter);
	return pick.filter((r) => matchesSearch(r, q)).map((r) => rowFor(r, now, rules)).sort((a, b) => b.value - a.value);
}

// ---------- formatting (IST) ----------

const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const inr = (n: number): string => `₹${inrFmt.format(Math.round(n))}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST = 5.5 * 3_600_000;
/** '22 Sep' in IST (fixed offset; Intl gives 'Sept' in en-IN/en-GB). */
export const dateShort = (iso: string | null | undefined): string => {
	const t = ms(iso);
	if (t === null) return '';
	const d = new Date(t + IST);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

export function agoText(iso: string | null | undefined, now: number): string {
	const t = ms(iso);
	if (t === null) return 'never';
	const m = Math.max(0, Math.round((now - t) / 60_000));
	if (m < 1) return 'just now';
	if (m < 60) return `${m} min ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h} h ago`;
	return `${Math.floor(h / 24)} d ago`;
}

export interface SyncState {
	text: string;
	ok: boolean;
}

/** Green when the last Velocity run succeeded within 30 min; red otherwise. */
export function syncState(v: { ok?: boolean; at?: string; error?: string } | null | undefined, now: number): SyncState {
	if (!v?.at) return { text: 'Not synced yet', ok: false };
	if (!v.ok) return { text: `Sync failed ${agoText(v.at, now)}`, ok: false };
	const fresh = now - (ms(v.at) ?? 0) <= 30 * 60_000;
	return { text: agoText(v.at, now), ok: fresh };
}

/** Payment line for cards: partial orders show the split (paid online + COD), from Velocity's cod_amount. */
export function paymentBreakdown(r: { payment_mode: string | null; order_value: number | string | null; amount_collected?: number | string | null }): {
	label: string;
	detail: string | null;
} {
	const total = num(r.order_value);
	const known = r.amount_collected !== null && r.amount_collected !== undefined && r.amount_collected !== '';
	const paid = num(r.amount_collected);
	const cod = Math.max(total - paid, 0);
	switch (r.payment_mode) {
		case 'prepaid':
			return { label: `Prepaid · ${inr(total)}`, detail: 'Paid online in full' };
		case 'partial':
			return { label: `Partial · ${inr(total)}`, detail: known ? `${inr(paid)} paid online + ${inr(cod)} COD` : 'Split not known' };
		case 'cod':
			return { label: `COD · ${inr(total)}`, detail: 'Nothing paid upfront' };
		default:
			return { label: inr(total), detail: null };
	}
}

// ---------- PC Needs-action table ----------

export type ActionGroup = 'followup' | 'notreceived' | 'reship' | 'lost';
export const ACTION_GROUPS: { key: ActionGroup; label: string }[] = [
	{ key: 'followup', label: 'Claim follow-ups' },
	{ key: 'notreceived', label: 'Not received' },
	{ key: 'reship', label: 'Re-ships' },
	{ key: 'lost', label: 'Lost / unknown' }
];

export function actionGroup(i: Pick<ActionItem, 'kind'>): ActionGroup {
	switch (i.kind) {
		case 'claim_window':
		case 'credit_due':
			return 'followup';
		case 'reship_found':
			return 'reship';
		case 'lost':
		case 'unknown':
			return 'lost';
		default:
			return 'notreceived';
	}
}

/** Short "What" column text (the order number has its own column on PC). */
export function actionWhat(i: ActionItem): string {
	switch (i.kind) {
		case 'claim_window': return 'Claim follow-up';
		case 'credit_due': return 'Credit note due';
		case 'reship_found': return `Re-shipped as #${i.rto?.reship_order_no ?? ''}?`;
		case 'lost': return 'Marked lost';
		case 'unknown': return 'Unknown parcel';
		default: return 'Not received';
	}
}

export type ListSort = 'value' | 'old';
export const parseSort = (v: string | null): ListSort => (v === 'old' ? 'old' : 'value');

/** Highest value first (default), or oldest first; rows with no date go last. */
export function sortRows(rows: ListRow[], sort: ListSort): ListRow[] {
	if (sort === 'value') return [...rows].sort((a, b) => b.value - a.value);
	return [...rows].sort((a, b) => (a.when ?? Infinity) - (b.when ?? Infinity) || b.value - a.value);
}

/** Count per All RTOs view (PC sidebar). */
export function filterCounts(rtos: Rto[], claims: Claim[], rules: Rules, now: number): Record<ListFilter, number> {
	const out = Object.fromEntries(FILTERS.map((f) => [f.key, 0])) as Record<ListFilter, number>;
	out.all = rtos.length;
	out.action = needsAction(rtos, claims, rules, now).length;
	const credit = new Set(claims.filter((c) => c.status === 'approved' && num(c.outstanding) > 0).map((c) => c.rto_id));
	out.credit = rtos.filter((r) => credit.has(r.id)).length;
	for (const r of rtos) {
		const b = bucketOf(r, now, rules);
		if (b in out) out[b as ListFilter]++;
	}
	return out;
}
