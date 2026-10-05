import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { undoAction } from '#lib/server/actions.ts';
import type { RequestHandler } from './$types';

/** POST {event_id} → restores the RTO as it was before that change (latest change only, within 10 min). */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const body = await request.json().catch(() => ({}));
	return json(await undoAction(Number(body?.event_id)));
};
