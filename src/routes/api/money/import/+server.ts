import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { importRows } from '#lib/server/money.ts';
import type { RequestHandler } from './$types';

/** POST {rows: LedgerRow[]} (≤ 2,000; the Money page parses the passbook file and sends it in parts). Lines already in DRC are skipped. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await importRows(await request.json().catch(() => ({}))));
};
