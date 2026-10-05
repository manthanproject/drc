import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { getRtoDetail } from '#lib/server/rto-detail.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, params, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await getRtoDetail(params.id), { headers: { 'cache-control': 'no-store' } });
};
