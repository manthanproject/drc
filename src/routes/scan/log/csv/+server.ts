import { loadScanLog } from '#lib/server/scanlog.ts';
import { parseDay, scanLogCsv } from '#lib/scanlog.ts';
import type { RequestHandler } from './$types';

/** CSV of one day's scans. Behind the DRC login (hooks guard every non-/api path). */
export const GET: RequestHandler = async ({ url }) => {
	const day = parseDay(url.searchParams.get('d'), Date.now());
	const csv = scanLogCsv(day, await loadScanLog(day));
	return new Response(csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="drc-scan-log-${day}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
