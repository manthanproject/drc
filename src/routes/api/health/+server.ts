import { json } from '@sveltejs/kit';
import * as env from '$app/env/private';
const { DROPPY_LOG_ID, RETURN_ORDERS_ID, VERCEL_REGION } = env;

const REQUIRED = [
	'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GOOGLE_SA_KEY_JSON', 'DROPPY_LOG_ID', 'RETURN_ORDERS_ID',
	'DRC_UPLOADER_URL', 'DRC_UPLOADER_TOKEN', 'APP_PASSWORD', 'VELOCITY_API_URL', 'VELOCITY_API_KEY', 'CRON_SECRET'
] as const;
import { db } from '#lib/server/supabase.ts';
import { sheetsReadonly } from '#lib/server/google.ts';
import type { RequestHandler } from './$types';

const msg = (e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`;

async function sheetTitle(id: string | undefined) {
	if (!id) return 'error: sheet id missing';
	const r = await sheetsReadonly().spreadsheets.get({ spreadsheetId: id, fields: 'properties.title' });
	return `ok (${r.data.properties?.title})`;
}

export const GET: RequestHandler = async () => {
	const out: Record<string, string | null> = { region: VERCEL_REGION ?? null };
	const missing = REQUIRED.filter((k) => !(env as Record<string, string | undefined>)[k]);
	out.settings = missing.length ? `error: missing ${missing.join(', ')}` : 'ok';

	try {
		const { count, error } = await db().from('settings').select('key', { count: 'exact', head: true });
		out.supabase = error ? msg(error.message) : `ok (${count} settings)`;
	} catch (e) {
		out.supabase = msg(e);
	}
	try {
		out.droppyLog = await sheetTitle(DROPPY_LOG_ID);
	} catch (e) {
		out.droppyLog = msg(e);
	}
	try {
		out.returnOrders = await sheetTitle(RETURN_ORDERS_ID);
	} catch (e) {
		out.returnOrders = msg(e);
	}

	try {
		const { data } = await db().from('settings').select('value').eq('key', 'velocity_last_sync').maybeSingle();
		const v = data?.value as { ok?: boolean; at?: string; error?: string; unique?: number; fetched?: { unique?: number } } | undefined;
		out.velocitySync = !v ? 'not run yet' : v.ok ? `ok (${v.fetched?.unique ?? 0} RTOs at ${v.at})` : `error: ${v.error} (at ${v.at})`;
	} catch (e) {
		out.velocitySync = msg(e);
	}

	const ok = !Object.values(out).some((v) => v?.startsWith('error'));
	return json({ ok, ...out }, { status: ok ? 200 : 500, headers: { 'cache-control': 'no-store' } });
};