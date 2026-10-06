import { db } from '#lib/server/supabase.ts';
import { syncState } from '#lib/dashboard.ts';
import type { LayoutServerLoad } from './$types';

/** "Synced X min ago" for the PC top bar. Never blocks a page if Supabase is slow or down. */
export const load: LayoutServerLoad = async () => {
	try {
		const { data } = await db().from('settings').select('value').eq('key', 'velocity_last_sync').maybeSingle();
		return { topSync: syncState(data?.value as never, Date.now()) };
	} catch {
		return { topSync: null };
	}
};
