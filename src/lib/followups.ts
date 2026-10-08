// Phase 5 follow-ups: where each raised claim stands, when to chase it, and the text to paste. Pure, tested.
import { num, dateShort, latestDispute, disputeStatus, type Rto, type Rules } from './dashboard.ts';
import { velocityDisputeType, dateLong, dateTimeLong, carrierShort } from './claims.ts';

export interface FollowClaim {
	id: string;
	rto_id: string;
	reason: string;
	status: string;
	channel?: string | null;
	ticket_ref?: string | null;
	ticket_url?: string | null;
	claimed_amount?: number | string | null;
	expected_amount?: number | string | null;
	approved_amount?: number | string | null;
	raised_at?: string | null;
	approved_at?: string | null;
	next_follow_up_at?: string | null;
	follow_ups?: number | null;
	last_follow_up_at?: string | null;
	escalated_at?: string | null;
}

export type FollowKind = 'rejected' | 'due' | 'waiting' | 'courier_approved' | 'credit_due';
type Tone = 'ok' | 'warn' | 'bad' | 'mute' | 'acc';

export interface FollowState {
	kind: FollowKind;
	label: string;
	tone: Tone;
	/** when the next follow-up is due (ms), null if not date-driven */
	due: number | null;
}

const ms = (iso: string | null | undefined) => {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isNaN(t) ? null : t;
};
const REJECTED = new Set(['rejected', 'declined']);
const APPROVED = new Set(['approved', 'accepted', 'resolved']);
export const FOLLOW_OPEN = new Set(['raised', 'waiting', 'escalated', 'approved']);

export const isTicket = (c: Pick<FollowClaim, 'channel'>) => c.channel === 'support_ticket';

/** Next follow-up time: the stored one, else raised + follow-up hours. Null when there is no date at all. */
export function followDue(c: FollowClaim, rules: Rules): number | null {
	const next = ms(c.next_follow_up_at);
	if (next !== null) return next;
	const raised = ms(c.raised_at);
	return raised === null ? null : raised + rules.followHours * 3_600_000;
}

/** Where an open (non-draft) claim stands. Null for drafts and closed claims. */
export function followState(c: FollowClaim, r: Pick<Rto, 'disputes'> | null, rules: Rules, now: number): FollowState | null {
	if (!FOLLOW_OPEN.has(c.status)) return null;
	const due = followDue(c, rules);
	if (c.status === 'approved') return { kind: 'credit_due', label: 'Approved · credit note due', tone: 'ok', due };
	// panel disputes: Velocity's own status (from the 15-min sync) decides rejected / approved
	const d = isTicket(c) ? null : latestDispute(r);
	const st = String(d?.status ?? '').toLowerCase();
	if (REJECTED.has(st) && c.status !== 'escalated') return { kind: 'rejected', label: 'Rejected · escalate', tone: 'bad', due: null };
	if (APPROVED.has(st)) return { kind: 'courier_approved', label: 'Velocity approved · mark it', tone: 'ok', due };
	if (due !== null && due <= now) return { kind: 'due', label: 'Follow up now', tone: 'warn', due };
	return { kind: 'waiting', label: due === null ? 'Waiting' : `Follow up ${dateShort(new Date(due).toISOString())}`, tone: 'mute', due };
}

/** Sort weight for the Raised list: act-now first. */
export const FOLLOW_ORDER: Record<FollowKind, number> = { rejected: 0, due: 1, courier_approved: 2, credit_due: 3, waiting: 4 };

export { mdndWaitHours } from './dashboard.ts';

// ---------- texts (never name the company; sign-off Team Dropy) ----------

export interface TextRto {
	order_no: string | null;
	forward_awb: string | null;
	carrier_name: string | null;
	order_value: number | string | null;
	rto_delivered_at?: string | null;
	disputes?: Rto['disputes'];
}

const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rs = (n: number) => `₹${inrFmt.format(Math.round(n))}`;
const orderName = (r: TextRto) => (/^\d+(-\d+)*$/.test(String(r.order_no ?? '')) ? `#Dropy-${r.order_no}` : String(r.order_no ?? ''));
const SIGN = ['', 'Thanks & Regards,', 'Team Dropy', 'support@dropy.in'];
const value = (c: FollowClaim, r: TextRto) => num(c.approved_amount) || num(c.expected_amount) || num(c.claimed_amount) || num(r.order_value);

function issueLine(c: FollowClaim, r: TextRto): string {
	switch (c.reason) {
		case 'mdnd':
			return `Marked "Return - Delivered"${r.rto_delivered_at ? ` on ${dateTimeLong(r.rto_delivered_at)}` : ''}, but it never reached our warehouse.`;
		case 'wrong_product':
			return 'Received back with a different product inside, not the item we shipped.';
		case 'damaged':
			return 'Received back with the product damaged.';
		case 'missing_items':
			return 'Received back with items missing from the package.';
		case 'lost':
			return 'Not returned to our warehouse; no tracking movement.';
		default:
			return 'RTO claim.';
	}
}

const facts = (c: FollowClaim, r: TextRto) => [
	`Order: ${orderName(r)}`,
	`AWB: ${r.forward_awb ?? '—'} (${carrierShort(r.carrier_name)})`,
	`Order value: ${rs(value(c, r))}`,
	`Issue: ${issueLine(c, r)}`
];

const ask = (c: FollowClaim) =>
	c.reason === 'mdnd' || c.reason === 'lost'
		? 'share the POD (receiver signature, delivery photo, receiver name and ID), or settle the claim for the order value'
		: 'approve the claim and issue the credit note for the order value';

export interface PasteText {
	/** where it goes, e.g. "Reply on ticket #106373" */
	where: string;
	subject: string | null;
	body: string;
}

/** The follow-up to paste for a claim in this state. One clear request each time. */
export function followText(c: FollowClaim, r: TextRto, state: FollowKind, packing: string | null = null): PasteText {
	const type = velocityDisputeType(c.reason) ?? 'RTO';
	const raised = c.raised_at ? dateLong(c.raised_at) : null;

	if (state === 'rejected') {
		return {
			where: 'New Velocity support ticket',
			subject: `ESCALATION: ${type} dispute rejected | AWB ${r.forward_awb ?? '—'} | ${orderName(r)}`,
			body: [
				'Hi Team,',
				'',
				`Our ${type} dispute for the RTO below${raised ? ` (raised on ${raised})` : ''} was rejected. Please re-check it.`,
				'',
				...facts(c, r),
				...(packing ? [`Pre-dispatch packing video with label: ${packing}`] : []),
				'',
				`Please ${ask(c)} within 48 hours.`,
				...SIGN
			].join('\n')
		};
	}

	if (state === 'credit_due' || state === 'courier_approved') {
		const approved = c.approved_at ? ` on ${dateLong(c.approved_at)}` : '';
		const body = [
			'Hi Team,',
			'',
			`Our claim for the RTO below was approved${approved}, but we have not received the credit yet.`,
			'',
			`Order: ${orderName(r)}`,
			`AWB: ${r.forward_awb ?? '—'} (${carrierShort(r.carrier_name)})`,
			`Approved amount: ${rs(value(c, r))}`,
			'',
			'Please share the credit note number and date for this AWB.',
			...SIGN
		].join('\n');
		return c.ticket_ref && isTicket(c)
			? { where: `Reply on ticket ${c.ticket_ref}`, subject: null, body }
			: { where: 'New Velocity support ticket', subject: `Credit note pending: AWB ${r.forward_awb ?? '—'} | ${orderName(r)}`, body };
	}

	// due / waiting
	if (isTicket(c) && c.ticket_ref) {
		return {
			where: `Reply on ticket ${c.ticket_ref}`,
			subject: null,
			body: [
				'Hi Team,',
				'',
				`Following up on this ticket${raised ? `, raised on ${raised}` : ''}. We have not had an update yet.`,
				'',
				'Please update us on every AWB in this ticket within 24 hours.',
				...SIGN
			].join('\n')
		};
	}
	const shown = latestDispute(r);
	return {
		where: 'New Velocity support ticket',
		subject: `FOLLOW-UP: ${type} dispute | AWB ${r.forward_awb ?? '—'} | ${orderName(r)}`,
		body: [
			'Hi Team,',
			'',
			`Following up on our ${type} dispute for the RTO below${raised ? `, raised on ${raised}` : ''}.`,
			'',
			...facts(c, r),
			'',
			`It still shows "${shown ? disputeStatus(shown.status).label : 'In Review'}" with no update. Please ${ask(c)} within 24 hours.`,
			...SIGN
		].join('\n')
	};
}

/** Parcel turned up after the dispute: the line to paste so Velocity closes it. */
export function withdrawText(c: FollowClaim, r: TextRto): PasteText {
	return {
		where: isTicket(c) && c.ticket_ref ? `Reply on ticket ${c.ticket_ref}` : 'Velocity → order → Dispute (or a support ticket)',
		subject: null,
		body: `Update: RTO for ${orderName(r)} (AWB ${r.forward_awb ?? '—'}) has now been received at our warehouse. Please close this ${isTicket(c) ? 'request for this AWB' : 'dispute'}.\n\nThanks & Regards,\nTeam Dropy`
	};
}

/** Target the credit is measured against: approved, else expected (Velocity cap), else claimed. */
export const creditTarget = (c: FollowClaim) => num(c.approved_amount) || num(c.expected_amount) || num(c.claimed_amount);

/** "₹1,728 of ₹2,500 → closes as short-paid" helper for the credit form. */
export function creditOutcome(c: FollowClaim, amount: number): 'full' | 'short' | null {
	if (!(amount > 0)) return null;
	return amount >= creditTarget(c) ? 'full' : 'short';
}

export const followCount = (c: FollowClaim) => Number(c.follow_ups ?? 0);
