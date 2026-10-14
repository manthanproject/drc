import { sheetPlan, getAuto } from '#lib/server/sheet-sync.ts';
import { db } from '#lib/server/supabase.ts';
import { planCounts } from '#lib/sheet-sync.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const [auto, last] = await Promise.all([getAuto(), db().from('settings').select('value').eq('key', 'sheet_sync_last').maybeSingle()]);
	try {
		const { plan } = await sheetPlan();
		return { ok: true as const, auto, last: last.data?.value ?? null, plan: { ...plan, baseline: [] }, counts: planCounts(plan), now: Date.now() };
	} catch (e) {
		return { ok: false as const, auto, last: last.data?.value ?? null, error: e instanceof Error ? e.message : String(e), now: Date.now() };
	}
};
