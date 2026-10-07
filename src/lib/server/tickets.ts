import { error } from '@sveltejs/kit';
import { db } from './supabase.ts';
import { fail, UUID } from './actions.ts';
import { cleanTicketRef } from '#lib/tickets.ts';

/** Mark one courier ticket raised for the ticked parcels. {rto_ids[], ticket_ref, raised_on?, description?} → {event_id, n, ticket_ref} */
export async function raiseTicket(raw: unknown) {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const ids = Array.isArray(b.rto_ids) ? [...new Set(b.rto_ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)))] : [];
	if (!ids.length) error(400, 'Tick at least one parcel');
	if (ids.length > 100) error(400, 'Up to 100 parcels per ticket');
	const ref = cleanTicketRef(b.ticket_ref);
	if (!ref) error(400, 'Type the ticket number');
	const args: Record<string, unknown> = { rto_ids: ids, ticket_ref: ref };
	if (typeof b.raised_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.raised_on)) args.raised_on = b.raised_on;
	if (typeof b.description === 'string' && b.description.trim()) args.description = b.description.trim().slice(0, 12000);
	const { data, error: e } = await db().rpc('raise_ticket', { p_args: args });
	if (e) fail(e.message);
	return data as { event_id: number; n: number; ticket_ref: string; courier: string };
}
