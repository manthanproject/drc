import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { stockAction } from '#lib/server/stock.ts';
import type { RequestHandler } from './$types';

/** POST {action:'reuse', item_id, order_no?} | {action:'money_done', rto_id} → {event_id, …} */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await stockAction(await request.json().catch(() => ({}))));
};
