import { json } from '@sveltejs/kit';
import { RETURN_ORDERS_ID } from '$app/env/private';
import { requirePassword } from '#lib/server/auth.ts';
import { sheetsReadonly } from '#lib/server/google.ts';
import { mapSheet } from '#lib/server/sheet-map.ts';
import { db } from '#lib/server/supabase.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

/**
 * One-time import of "Dropy Return Orders → Return Orders". Reads the sheet only (never writes it).
 * Body {} = dry run (changes nothing, shows what would happen). Body {"apply":true} = real run, allowed once.
 */
export const POST: RequestHandler = async ({ request }) => {
	requirePassword(request);
	const b = await request.json().catch(() => ({}));
	const apply = b.apply === true;
	try {
		const r = await sheetsReadonly().spreadsheets.values.get({
			spreadsheetId: RETURN_ORDERS_ID,
			range: "'Return Orders'!A1:G",
			valueRenderOption: 'UNFORMATTED_VALUE',
			dateTimeRenderOption: 'SERIAL_NUMBER'
		});
		const { entries, report } = mapSheet((r.data.values ?? []) as unknown[][]);
		const { data, error } = await db().rpc('apply_sheet_backfill', { p_rows: entries, p_dry_run: !apply });
		if (error) return json({ ok: false, error: error.message, report }, { status: 400 });
		return json({ ok: true, applied: apply, sheet: report, database: data });
	} catch (e) {
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
};
