import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { createForwardClaim } from '#lib/server/forward-claims.ts';
import type { RequestHandler } from './$types';

/** POST {courier, order_no, awb, reason, channel, status, ticket_ref?, raised_on?, claimed_amount, …} → {rto_id, claim_id, event_id} */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await createForwardClaim(await request.json().catch(() => ({}))));
};
