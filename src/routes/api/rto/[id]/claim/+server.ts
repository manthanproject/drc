import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { createClaim } from '#lib/server/claims.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 30 };

/** POST {reason, items[], restock[], media[{kind,id,mime,size}], note?, scanned?} → {event_id, claim_id, from, to}. */
export const POST: RequestHandler = async ({ request, params, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await createClaim(params.id, await request.json().catch(() => ({}))));
};
