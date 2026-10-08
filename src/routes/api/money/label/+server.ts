import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { labelLine } from '#lib/server/money.ts';
import type { RequestHandler } from './$types';

/** POST {ledger_id, label: 'received_parcel' | 'not_claim' | null, note?} */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await labelLine(await request.json().catch(() => ({}))));
};
