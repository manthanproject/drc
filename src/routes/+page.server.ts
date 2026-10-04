import { loadSnapshot } from '#lib/server/rto-data.ts';
import { buildDashboard, syncState } from '#lib/dashboard.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const s = await loadSnapshot();
	const d = buildDashboard(s.rtos, s.claims, s.rules, s.now);
	return {
		d: { ...d, action: d.action.slice(0, 5) },
		actionTotal: d.action.length,
		rules: s.rules,
		sync: syncState(s.lastSync, s.now)
	};
};
