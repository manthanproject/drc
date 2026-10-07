import { json, error } from '@sveltejs/kit';
import { requireCronOrPassword } from '#lib/server/auth.ts';
import { validSession, SESSION_COOKIE } from '#lib/server/session.ts';
import { syncReadyStockSheet } from '#lib/server/ready-stock-sheet.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

/** Rewrites the "DRC Ready Stock" sheet tab. Supabase cron every 15 min (x-cron-secret), or "Sync now" in the app. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!(await validSession(cookies.get(SESSION_COOKIE)))) requireCronOrPassword(request);
	try {
		return json(await syncReadyStockSheet());
	} catch (e) {
		console.error('ready stock sheet sync failed', e);
		error(502, 'Could not write the sheet tab. DRC data is fine; try Sync now again.');
	}
};
