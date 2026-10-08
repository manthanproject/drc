// Disputes queue (Phase 3d, PC screen 6): everything to raise with the courier, most urgent first. Pure, tested.
import { DAY, num, orderLabel, dateShort, mdndWaitHours, latestDispute, disputeStatus, type Rto, type Rules } from './dashboard.ts';
import { followState, FOLLOW_ORDER, type FollowClaim, type FollowKind } from './followups.ts';
import { claimReasonLabel } from './claims.ts';

export interface QueueClaim extends FollowClaim {
	id: string;
	rto_id: string;
	reason: string;
	status: string;
	channel?: string | null;
	ticket_ref: string | null;
	ticket_url?: string | null;
	claimed_amount: number | string;
	deadline_at: string | null;
	raised_at: string | null;
	description: string | null;
	created_at: string;
}

type Tone = 'ok' | 'warn' | 'bad' | 'mute' | 'acc';
export interface QueueRow {
	key: string;
	kind: 'draft' | 'mdnd' | 'raised';
	rtoId: string;
	claimId: string | null;
	label: string;
	amount: number;
	sub: string;
	pill: { label: string; tone: Tone };
	deadline: number | null;
	raisedAt: number | null;
	/** raised claims: where the follow-up stands (Phase 5) */
	follow?: FollowKind;
}

export interface Queue {
	toRaise: QueueRow[];
	raised: QueueRow[];
	/** Not received, but the dispute window has closed or there is no courier date: check them on Home. */
	olderNotReceived: number;
	totals: { n: number; value: number };
	/** raised claims that need you now: rejected, follow-up due, courier approved */
	toFollow: number;
}

const OPEN = new Set(['draft', 'raised', 'waiting', 'escalated', 'approved']);
const ms = (iso: string | null | undefined) => {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isNaN(t) ? null : t;
};

export function windowNote(deadline: number | null, now: number): string {
	if (deadline === null) return 'no window date';
	if (deadline < now) return 'window closed';
	const d = Math.floor((deadline - now) / DAY);
	return d === 0 ? 'window closes today' : `${d} d left`;
}

export function buildQueue(
	rtos: (Rto & { scanned_at?: string | null })[],
	claims: QueueClaim[],
	mediaCount: Record<string, number>,
	rules: Rules,
	now: number
): Queue {
	const byId = new Map(rtos.map((r) => [r.id, r]));
	const openClaimRto = new Set(claims.filter((c) => OPEN.has(c.status)).map((c) => c.rto_id));
	const toRaise: QueueRow[] = [];
	const raised: QueueRow[] = [];
	let older = 0;

	for (const c of claims) {
		const r = byId.get(c.rto_id);
		if (!r) continue;
		const deadline = ms(c.deadline_at);
		const amount = num(c.claimed_amount) || num(r.order_value);
		if (c.status === 'draft') {
			const m = mediaCount[r.id] ?? 0;
			const needsMedia = c.reason !== 'mdnd' && m < 4;
			toRaise.push({
				key: `c-${c.id}`, kind: 'draft', rtoId: r.id, claimId: c.id, label: orderLabel(r), amount, deadline, raisedAt: null,
				sub: `${claimReasonLabel(c.reason)} · ${windowNote(deadline, now)}`,
				pill: needsMedia ? { label: `Media ${m} of 4`, tone: 'warn' } : { label: 'Ready', tone: 'ok' }
			});
		} else if (OPEN.has(c.status)) {
			const ticket = c.channel === 'support_ticket';
			// Phase 5: the pill says what to do next (Velocity's dispute status for panel disputes is inside followState)
			const st = followState(c, r, rules, now)!;
			const why = ticket ? (c.reason === 'mdnd' ? 'Not received, ticket' : 'Lost, ticket') : claimReasonLabel(c.reason);
			const d = ticket ? null : latestDispute(r);
			const vel = d ? ` · Velocity: ${disputeStatus(d.status).label}` : '';
			raised.push({
				key: `c-${c.id}`, kind: 'raised', rtoId: r.id, claimId: c.id, label: orderLabel(r), amount, deadline, raisedAt: ms(c.raised_at),
				sub: `${why} · ${c.raised_at ? `raised ${dateShort(c.raised_at)}` : 'raised'}${c.ticket_ref ? ` · ${c.ticket_ref}` : ''}${vel}`,
				pill: { label: st.label, tone: st.tone as Tone },
				follow: st.kind
			});
		}
	}

	for (const r of rtos) {
		if (r.stage !== 'awaiting_receipt' || r.scanned_at || openClaimRto.has(r.id) || r.reship_state === 'pending') continue;
		const t = ms(r.rto_delivered_at);
		const deadline = t === null ? null : t + rules.windowDays * DAY;
		if (t !== null && now - t < mdndWaitHours(r, rules) * 3_600_000) continue; // not 48 h yet (72 h DTDC)
		if (deadline === null || deadline < now) {
			older++;
			continue;
		}
		toRaise.push({
			key: `m-${r.id}`, kind: 'mdnd', rtoId: r.id, claimId: null, label: orderLabel(r), amount: num(r.order_value), deadline, raisedAt: null,
			sub: `Not received (MDND) · ${windowNote(deadline, now)}`,
			pill: { label: 'Draft it', tone: 'acc' }
		});
	}

	toRaise.sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || b.amount - a.amount);
	raised.sort((a, b) => FOLLOW_ORDER[a.follow!] - FOLLOW_ORDER[b.follow!] || (b.raisedAt ?? 0) - (a.raisedAt ?? 0));
	const toFollow = raised.filter((r) => r.follow === 'rejected' || r.follow === 'due' || r.follow === 'courier_approved').length;
	return { toRaise, raised, olderNotReceived: older, totals: { n: toRaise.length, value: toRaise.reduce((s, x) => s + x.amount, 0) }, toFollow };
}
