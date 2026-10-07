import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { raiseTicket } from '#lib/server/tickets.ts';
import type { RequestHandler } from './$types';

/** POST {rto_ids[], ticket_ref, raised_on?, description?} → one courier ticket recorded on every ticked parcel (undo = whole ticket). */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await raiseTicket(await request.json().catch(() => ({}))));
};
