import { loadSnapshot } from '#lib/server/rto-data.ts';
import { scannedToday } from '#lib/server/today.ts';
import { db } from '#lib/server/supabase.ts';
import { buildDashboard, syncState } from '#lib/dashboard.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const [s, today, ref] = await Promise.all([
		loadSnapshot(),
		scannedToday(),
		db().from('refunds').select('order_no, status, created_at').is('deleted_at', null).in('status', ['to_refund', 'waiting', 'needs_check', 'on_hold'])
			.order('created_at', { ascending: true }).limit(1000)
	]);
	const d = buildDashboard(s.rtos, s.claims, s.rules, s.now);
	const open = (ref.data ?? []) as { order_no: string; status: string }[];
	const refunds = {
		open: open.length,
		toRefund: open.filter((r) => r.status === 'to_refund').length,
		waiting: open.filter((r) => r.status === 'waiting').length,
		first: open.filter((r) => r.status === 'to_refund').slice(0, 2).map((r) => r.order_no)
	};
	return { d, rules: s.rules, sync: syncState(s.lastSync, s.now), today, refunds };
};
