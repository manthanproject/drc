import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { applyCreditNote } from '#lib/server/money.ts';
import type { RequestHandler } from './$types';

/** POST {cn, rows: [{awb, order_no, order_value, status, amount}]}: one credit note from Velocity's details file. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await applyCreditNote(await request.json().catch(() => ({}))));
};
