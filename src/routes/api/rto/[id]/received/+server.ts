import { json, error } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { setReceivedOn } from '#lib/server/actions.ts';
import type { RequestHandler } from './$types';

/** POST {day: 'YYYY-MM-DD' | null} → {changed, received_on}. The day a scanned parcel actually arrived (null = scan day). */
export const POST: RequestHandler = async ({ request, params, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const body = await request.json().catch(() => ({}));
	const day = body?.day ?? null;
	if (day !== null && (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))) error(400, 'Pick a date');
	return json(await setReceivedOn(params.id, day));
};
