import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { claimAction } from '#lib/server/claims.ts';
import type { RequestHandler } from './$types';

/** POST {action: 'raise' | 'save_text', ticket_ref?, description?} */
export const POST: RequestHandler = async ({ request, params, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await claimAction(params.id, await request.json().catch(() => ({}))));
};
