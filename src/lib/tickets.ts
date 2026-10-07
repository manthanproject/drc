// Phase 4 auto-flags → courier tickets: parcels the panel dispute can't cover (stuck in transit, marked lost,
// not received after the dispute window). One combined ticket per courier. Pure, tested.
import { DAY, num, orderLabel, lastMove, isSheetOnly, isNonDropy, isStuck, eventText, type Rto, type Rules } from './dashboard.ts';
import { dateLong, dateTimeLong, carrierShort, placeText } from './claims.ts';
export { placeText };

export type TicketKind = 'stuck' | 'lost' | 'not_received';

export interface TicketRow {
	rtoId: string;
	kind: TicketKind;
	courier: 'velocity' | 'shiprocket';
	label: string; // '#3136' or 'Praveen'
	orderName: string; // '#Dropy-3136' or 'Praveen'
	awb: string;
	carrier: string; // 'DTDC'
	amount: number;
	/** stuck: days with no movement · not_received: days since marked delivered · lost: days since the last event */
	days: number | null;
	at: string | null; // last movement (stuck/lost) or marked-delivered time (not_received)
	lastText: string | null;
	lastPlace: string | null;
	nonDropy: boolean;
}

export interface TicketGroup {
	courier: 'velocity' | 'shiprocket';
	rows: TicketRow[];
	value: number;
}

export type TicketRto = Rto & { last_event_text?: string | null; last_event_location?: string | null };

const OPEN = new Set(['draft', 'raised', 'waiting', 'approved', 'escalated']);
const KIND_ORDER: Record<TicketKind, number> = { stuck: 0, lost: 1, not_received: 2 };
const ms = (iso: string | null | undefined) => {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isNaN(t) ? null : t;
};
const daysSince = (t: number, now: number) => Math.max(0, Math.floor((now - t) / DAY));

export const COURIER_NAME: Record<string, string> = { velocity: 'Velocity', shiprocket: 'Shiprocket' };

export function ticketKind(r: TicketRto, now: number, rules: Rules): TicketKind | null {
	if (isStuck(r, now, rules)) return 'stuck';
	if (r.stage === 'lost') return 'lost';
	if (r.stage === 'awaiting_receipt' && !r.scanned_at && r.reship_state !== 'pending') {
		const t = ms(r.rto_delivered_at);
		// inside the window it is an MDND panel dispute (Disputes list), not a ticket
		if (t === null || t + rules.windowDays * DAY < now) return 'not_received';
	}
	return null;
}

export function ticketRow(r: TicketRto, kind: TicketKind, now: number): TicketRow {
	const at = kind === 'not_received' ? r.rto_delivered_at : (() => { const t = lastMove(r); return t === null ? null : new Date(t).toISOString(); })();
	const t = ms(at);
	return {
		rtoId: r.id,
		kind,
		courier: r.courier!,
		label: orderLabel(r),
		orderName: isNonDropy(r) ? String(r.order_no) : `#Dropy-${r.order_no}`,
		awb: r.forward_awb!,
		carrier: carrierShort(r.carrier_name),
		amount: num(r.order_value),
		days: t === null ? null : daysSince(t, now),
		at,
		lastText: eventText(r.last_event_text),
		lastPlace: placeText(r.last_event_location),
		nonDropy: isNonDropy(r)
	};
}

/** Parcels to put on a courier ticket, one group per courier. Skips anything with an open claim (already raised). */
export function buildTickets(rtos: TicketRto[], claims: { rto_id: string; status: string }[], rules: Rules, now: number): TicketGroup[] {
	const claimed = new Set(claims.filter((c) => OPEN.has(c.status)).map((c) => c.rto_id));
	const by = new Map<string, TicketRow[]>();
	for (const r of rtos) {
		if (!r.courier || isSheetOnly(r) || claimed.has(r.id)) continue;
		const kind = ticketKind(r, now, rules);
		if (!kind) continue;
		by.set(r.courier, [...(by.get(r.courier) ?? []), ticketRow(r, kind, now)]);
	}
	return [...by.entries()]
		.map(([courier, rows]) => ({
			courier: courier as TicketGroup['courier'],
			rows: rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.amount - a.amount),
			value: rows.reduce((s, x) => s + x.amount, 0)
		}))
		.sort((a, b) => (a.courier === 'velocity' ? -1 : b.courier === 'velocity' ? 1 : 0));
}

/** List line under the order no. */
export function ticketSub(x: TicketRow): string {
	switch (x.kind) {
		case 'stuck':
			return `No movement for ${x.days} d · ${x.carrier}${x.lastText ? ` · ${x.lastText}` : ''}`;
		case 'lost':
			return `Courier says lost${x.at ? ` ${dateLong(x.at)}` : ''} · ${x.carrier}`;
		default:
			return x.at ? `Marked delivered ${x.days} d ago, never arrived · ${x.carrier}` : `Marked delivered (no date), never arrived · ${x.carrier}`;
	}
}

export const ticketPill = (x: TicketRow): { label: string; tone: 'bad' | 'warn' } =>
	x.kind === 'stuck' ? { label: 'Likely lost', tone: 'bad' } : x.kind === 'lost' ? { label: 'Lost', tone: 'bad' } : { label: 'Not received', tone: 'warn' };

const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rs = (n: number) => `₹${inrFmt.format(Math.round(n))}`;

const SECTION: Record<TicketKind, { title: (stuckDays: number) => string; ask: string; subject: string }> = {
	stuck: {
		title: (d) => `RTO stuck in transit: no tracking update for ${d}+ days`,
		ask: 'trace each shipment and deliver it back to our warehouse, or confirm it as lost and settle it for the order value shown.',
		subject: 'stuck in transit'
	},
	lost: {
		title: () => 'Marked lost by the courier',
		ask: 'settle each claim for the order value shown and share the credit note number for each AWB.',
		subject: 'marked lost'
	},
	not_received: {
		title: () => 'Marked "RTO Delivered", but never received at our warehouse',
		ask: 'share the POD for each AWB (receiver signature, delivery photo, receiver name and ID). If there is no POD, treat it as lost and settle it for the order value shown.',
		subject: 'marked delivered, not received'
	}
};

function line(x: TicketRow, i: number): string {
	const head = `${i}. ${x.orderName} | AWB ${x.awb} (${x.carrier})`;
	let what: string;
	if (x.kind === 'stuck') {
		const ev = [x.lastText ? `"${x.lastText}"` : '', x.lastPlace ? `at ${x.lastPlace}` : ''].filter(Boolean).join(' ');
		what = `last update ${dateLong(x.at)}${ev ? `: ${ev}` : ''} (${x.days} days ago)`;
	} else if (x.kind === 'lost') {
		what = x.at ? `marked lost ${dateLong(x.at)}` : 'marked lost';
	} else {
		what = x.at ? `marked delivered ${dateTimeLong(x.at)} (${x.days} days ago)` : 'marked delivered (no date in tracking)';
	}
	return `${head} | ${what} | ${rs(x.amount)}`;
}

/** Ready-to-paste Freshdesk ticket. Never names the company, only "our warehouse" / Team Dropy. */
export function ticketText(rows: TicketRow[], stuckDays: number): { subject: string; body: string } {
	const kinds = (['stuck', 'lost', 'not_received'] as TicketKind[]).filter((k) => rows.some((r) => r.kind === k));
	const total = rows.reduce((s, x) => s + x.amount, 0);
	const n = rows.length;
	const subject =
		n === 1
			? `RTO ${SECTION[rows[0].kind].subject}: AWB ${rows[0].awb} | ${rows[0].orderName}`
			: `RTO ${kinds.map((k) => SECTION[k].subject).join(' / ')}: ${n} shipments | Dropy`;

	const letters = 'ABC';
	const out: string[] = ['Hi Team,', '', `Please help with the RTO shipment${n > 1 ? 's' : ''} below. ${n > 1 ? 'They have' : 'It has'} not come back to our warehouse.`];
	kinds.forEach((k, j) => {
		out.push('', `${kinds.length > 1 ? `${letters[j]}. ` : ''}${SECTION[k].title(stuckDays)}`);
		rows.filter((r) => r.kind === k).forEach((r, i) => out.push(line(r, i + 1)));
	});
	out.push('', 'What we need within 48 hours:');
	kinds.forEach((k, j) => out.push(`- ${kinds.length > 1 ? `${letters[j]}: ` : ''}${SECTION[k].ask[0].toUpperCase()}${SECTION[k].ask.slice(1)}`));
	out.push(
		'',
		`Total order value: ${rs(total)} across ${n} shipment${n > 1 ? 's' : ''}. Pre-dispatch packing videos are available for every shipment if needed.`,
		'',
		'Thanks & Regards,',
		'Team Dropy',
		'support@dropy.in'
	);
	return { subject, body: out.join('\n') };
}

/** '#106373', '106373' → '#106373'; anything else kept as typed (trimmed). Empty → ''. */
export function cleanTicketRef(v: unknown): string {
	const s = String(v ?? '').trim().replace(/^#\s*/, '');
	if (!s) return '';
	return /^\d+$/.test(s) ? `#${s}` : s.slice(0, 40);
}

export const FRESHDESK_NEW = 'https://shipfast.freshdesk.com/support/tickets/new';
