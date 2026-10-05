import { db } from '#lib/server/supabase.ts';
import { istDayStart } from '#lib/scan.ts';
import { BUCKETS, bucketOfStage } from '#lib/dashboard.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, setHeaders }) => {
	depends('drc:today');
	setHeaders({ 'cache-control': 'no-store' });
	const { data, error } = await db()
		.from('rtos')
		.select('id, order_no, carrier_name, stage, scanned_code')
		.gte('scanned_at', istDayStart(Date.now()))
		.order('scanned_at', { ascending: false })
		.limit(100);
	if (error) throw new Error(`rtos: ${error.message}`);
	return {
		today: (data ?? []).map((r) => {
			const b = BUCKETS[bucketOfStage(r.stage)];
			return { id: r.id, order: r.order_no ? `#${r.order_no}` : `Unknown ${r.scanned_code ?? ''}`, carrier: r.carrier_name, stage: b?.label ?? r.stage, tone: b?.tone ?? 'mute' };
		})
	};
};
