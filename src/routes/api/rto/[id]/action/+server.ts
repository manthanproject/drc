import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { cleanArgs, runAction } from '#lib/server/actions.ts';
import type { RequestHandler } from './$types';

/** POST {action, money?, reship_date?, note?, scanned?} → {event_id, from, to}. Keep event_id for Undo. */
export const POST: RequestHandler = async ({ request, params, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const body = await request.json().catch(() => ({}));
	const result = await runAction(params.id, String(body?.action ?? ''), cleanArgs(body));
	return json(result);
};
