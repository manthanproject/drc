import { loadStock } from '#lib/server/stock.ts';
import { db } from '#lib/server/supabase.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const [s, sync] = await Promise.all([loadStock(), db().from('settings').select('value').eq('key', 'ready_stock_sheet_sync').maybeSingle()]);
	return { ...s, sheetSync: (sync.data?.value ?? null) as { ok?: boolean; at?: string; rows?: number } | null };
};
