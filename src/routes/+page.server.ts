import { loadSnapshot } from '#lib/server/rto-data.ts';
import { scannedToday } from '#lib/server/today.ts';
import { db } from '#lib/server/supabase.ts';
import { buildDashboard, syncState, shiprocketWarning, num } from '#lib/dashboard.ts';
import { moneyReminder } from '#lib/money.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const [s, today, ref, unmatched] = await Promise.all([
		loadSnapshot(),
		scannedToday(),
		db().from('refunds').select('order_no, status, created_at').is('deleted_at', null).in('status', ['to_refund', 'waiting', 'needs_check', 'on_hold'])
			.order('created_at', { ascending: true }).limit(1000),
		// claim money in the passbook that no credit note / claim is linked to yet
		db().from('ledger').select('amount').eq('category', 'claim_credit').is('credit_id', null).is('label', null).limit(200)
	]);
	const d = buildDashboard(s.rtos, s.claims, s.rules, s.now);
	const open = (ref.data ?? []) as { order_no: string; status: string }[];
	const refunds = {
		open: open.length,
		toRefund: open.filter((r) => r.status === 'to_refund').length,
		waiting: open.filter((r) => r.status === 'waiting').length,
		first: open.filter((r) => r.status === 'to_refund').slice(0, 2).map((r) => r.order_no)
	};
	const sr = s.srSync;
	const srWarn = sr && sr.ok === false && sr.error ? shiprocketWarning(sr.error) : null;
	const toMatch = (unmatched.data ?? []) as { amount: number | string }[];
	const money = moneyReminder({
		lastImportAt: s.ledgerImportAt,
		approvedUnpaid: s.claims.filter((c) => c.status === 'approved' && num(c.outstanding) > 0).length,
		toMatch: toMatch.length,
		toMatchAmount: toMatch.reduce((t, l) => t + num(l.amount), 0)
	}, s.now);
	return { d, rules: s.rules, sync: syncState(s.lastSync, s.now), today, refunds, srWarn, money };
};
