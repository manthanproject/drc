import { db } from './supabase.ts';
import { istDayStart } from '#lib/scan.ts';
import { BUCKETS, bucketOfStage } from '#lib/dashboard.ts';

/** RTOs scanned since midnight IST, newest first (Scan page + PC Home). */
export async function scannedToday() {
	const { data, error } = await db()
		.from('rtos')
		.select('id, order_no, carrier_name, stage, scanned_code')
		.gte('scanned_at', istDayStart(Date.now()))
		.order('scanned_at', { ascending: false })
		.limit(100);
	if (error) throw new Error(`rtos: ${error.message}`);
	return (data ?? []).map((r) => {
		const b = BUCKETS[bucketOfStage(r.stage)];
		return { id: r.id as string, order: r.order_no ? `#${r.order_no}` : `Unknown ${r.scanned_code ?? ''}`, carrier: r.carrier_name as string | null, stage: b?.label ?? r.stage, tone: b?.tone ?? 'mute' };
	});
}
