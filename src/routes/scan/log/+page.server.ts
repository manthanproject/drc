import { loadScanLog } from '#lib/server/scanlog.ts';
import { dayLabel, istDate, parseDay, shiftDay, summarise } from '#lib/scanlog.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const now = Date.now();
	const day = parseDay(url.searchParams.get('d'), now);
	const today = istDate(now);
	const rows = await loadScanLog(day);
	return { day, label: dayLabel(day), today, prev: shiftDay(day, -1), next: day < today ? shiftDay(day, 1) : null, rows, sum: summarise(rows) };
};
