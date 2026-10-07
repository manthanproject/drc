import { RETURN_ORDERS_ID } from '$app/env/private';
import { sheetsWriter } from './google.ts';
import { db } from './supabase.ts';
import { allRtos } from './rto-data.ts';
import { stockItems } from './stock.ts';
import { sheetRows, SHEET_TAB, type StockRto } from '#lib/stock.ts';

/**
 * Rewrites the "DRC Ready Stock" tab of Dropy Return Orders from DRC (creates the tab the first time).
 * Touches ONLY that tab: every range below is prefixed with its exact title. Old tabs are never read or written.
 */
export async function syncReadyStockSheet(now = Date.now()) {
	if (!RETURN_ORDERS_ID) throw new Error('RETURN_ORDERS_ID missing');
	const api = sheetsWriter().spreadsheets;
	const [items, rtos] = await Promise.all([stockItems(), allRtos()]);
	const rows = sheetRows(items, rtos as StockRto[], now);

	const meta = await api.get({ spreadsheetId: RETURN_ORDERS_ID, fields: 'sheets.properties(sheetId,title)' });
	const tab = meta.data.sheets?.find((s) => s.properties?.title === SHEET_TAB)?.properties;
	let created = false;
	if (!tab) {
		await api.batchUpdate({
			spreadsheetId: RETURN_ORDERS_ID,
			requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TAB, gridProperties: { frozenRowCount: 1 } } } }] }
		});
		created = true;
	}
	const range = `'${SHEET_TAB}'`;
	await api.values.clear({ spreadsheetId: RETURN_ORDERS_ID, range: `${range}!A:Z` });
	await api.values.update({ spreadsheetId: RETURN_ORDERS_ID, range: `${range}!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });

	const result = { ok: true, at: new Date(now).toISOString(), rows: rows.length - 1, created };
	await db().from('settings').upsert({ key: 'ready_stock_sheet_sync', value: result, note: 'Written by /api/sync/ready-stock' });
	return result;
}
