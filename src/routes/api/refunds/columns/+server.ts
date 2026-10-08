import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { saveColumns } from '#lib/server/refunds.ts';
import type { RequestHandler } from './$types';

/** POST {custom: [{key, label, type, options?}], hidden: [key]} → the saved setting */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await saveColumns(await request.json().catch(() => ({}))));
};
