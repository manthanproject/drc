import { json } from '@sveltejs/kit';
import { requireCronOrPassword } from '#lib/server/auth.ts';
import { validSession, SESSION_COOKIE } from '#lib/server/session.ts';
import { runSheetSync, getAuto } from '#lib/server/sheet-sync.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

/** Supabase cron every 15 min (x-cron-secret): applies Sheet ↔ DRC when Auto sync is on, otherwise only checks. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!(await validSession(cookies.get(SESSION_COOKIE)))) requireCronOrPassword(request);
	const r = await runSheetSync(await getAuto());
	return json(r, { status: r.ok ? 200 : 502 });
};
