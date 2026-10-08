import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { importSheet } from '#lib/server/refunds.ts';
import type { RequestHandler } from './$types';

/** POST {dry: true} → what would be imported; {dry: false} → imports once. The sheet is only read. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const b = await request.json().catch(() => ({}));
	return json(await importSheet(b?.dry !== false));
};
