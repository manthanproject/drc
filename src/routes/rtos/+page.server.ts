import { loadSnapshot } from '#lib/server/rto-data.ts';
import { filterCounts, listRows, matchesSearch, needsAction, parseFilter, parseSort, sortRows, FILTERS } from '#lib/dashboard.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const filter = parseFilter(url.searchParams.get('f'));
	const sort = parseSort(url.searchParams.get('s'));
	const q = (url.searchParams.get('q') ?? '').slice(0, 80);
	const s = await loadSnapshot();
	const action =
		filter === 'action'
			? needsAction(s.rtos, s.claims, s.rules, s.now).filter((i) => !q || (i.rto && matchesSearch(i.rto, q)))
			: [];
	const rows = sortRows(listRows(s.rtos, filter, q, s.rules, s.now, s.claims), sort);
	const label = FILTERS.find((f) => f.key === filter)!.label;
	return { filter, sort, q, label, action, rows, counts: filterCounts(s.rtos, s.claims, s.rules, s.now) };
};
