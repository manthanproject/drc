import { db } from './supabase.ts';
import { allRtos, settings } from './rto-data.ts';
import { buildQueue, type QueueClaim } from '#lib/queue.ts';
import { EVIDENCE } from '#lib/claims.ts';
import { buildTickets } from '#lib/tickets.ts';
import type { Rto } from '#lib/dashboard.ts';

const CLAIM_COLS =
	'id, rto_id, reason, status, channel, ticket_ref, ticket_url, claimed_amount, expected_amount, approved_amount, deadline_at, raised_at, approved_at, ' +
	'description, created_at, next_follow_up_at, follow_ups, last_follow_up_at, escalated_at';

export interface PaneRto {
	id: string;
	order_no: string | null;
	forward_awb: string | null;
	carrier_name: string | null;
	order_value: number | string | null;
	payment_mode: string | null;
	rto_delivered_at: string | null;
	media_folder_id: string | null;
	customer_name: string | null;
	disputes?: Rto['disputes'];
}

/** Disputes queue: open claims + MDND candidates, with what the right-hand pane needs. Read only. */
export async function loadQueue() {
	const [rtos, c, s] = await Promise.all([
		allRtos(),
		db().from('claims').select(CLAIM_COLS).in('status', ['draft', 'raised', 'waiting', 'approved', 'escalated']),
		settings()
	]);
	if (c.error) throw new Error(`claims: ${c.error.message}`);
	const claims = (c.data ?? []) as unknown as QueueClaim[];
	const ids = [...new Set(claims.map((x) => x.rto_id))];
	let media: { id: string; rto_id: string; kind: string; drive_file_id: string }[] = [];
	if (ids.length) {
		const m = await db().from('rto_media').select('id, rto_id, kind, drive_file_id').in('rto_id', ids).is('trashed_at', null);
		if (m.error) throw new Error(`rto_media: ${m.error.message}`);
		media = m.data ?? [];
	}
	const counts: Record<string, number> = {};
	for (const id of ids) counts[id] = new Set(media.filter((x) => x.rto_id === id && EVIDENCE.some((e) => e.kind === x.kind)).map((x) => x.kind)).size;

	const now = Date.now();
	const queue = buildQueue(rtos, claims, counts, s.rules, now);
	const tickets = buildTickets(rtos, claims, s.rules, now);
	const want = new Set([...queue.toRaise, ...queue.raised].map((r) => r.rtoId));
	const pane: Record<string, PaneRto> = {};
	for (const r of rtos)
		if (want.has(r.id))
			pane[r.id] = {
				id: r.id, order_no: r.order_no, forward_awb: r.forward_awb, carrier_name: r.carrier_name, order_value: r.order_value,
				payment_mode: r.payment_mode, rto_delivered_at: r.rto_delivered_at, media_folder_id: r.media_folder_id ?? null, customer_name: r.customer_name,
					disputes: r.disputes ?? null
			};
	return { queue, tickets, stuckDays: s.rules.stuckDays, rules: s.rules, claims, media, pane, now };
}
