import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { createMdndDraft } from '#lib/server/claims.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 30 };

/** POST → MDND draft claim for a parcel marked delivered back that never arrived. {event_id, claim_id, bulk, packing} */
export const POST: RequestHandler = async ({ request, params, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await createMdndDraft(params.id));
};
