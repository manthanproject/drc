import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { refundAction } from '#lib/server/refunds.ts';
import type { RequestHandler } from './$types';

/** POST {action: 'create'|'update'|'delete'|'undo', id?, log_id?, order_no?, reason?, via?, refund_to?, amount?, status?, done_ref?, done_at?, extra?} */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await refundAction(await request.json().catch(() => ({}))));
};
