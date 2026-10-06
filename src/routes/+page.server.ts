import { loadSnapshot } from '#lib/server/rto-data.ts';
import { scannedToday } from '#lib/server/today.ts';
import { buildDashboard, syncState } from '#lib/dashboard.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const [s, today] = await Promise.all([loadSnapshot(), scannedToday()]);
	const d = buildDashboard(s.rtos, s.claims, s.rules, s.now);
	return { d, rules: s.rules, sync: syncState(s.lastSync, s.now), today };
};
