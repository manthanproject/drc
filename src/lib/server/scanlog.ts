import { db } from './supabase.ts';
import { buildScanLog, dayRange, type LogEvent } from '#lib/scanlog.ts';
import type { Rto } from '#lib/dashboard.ts';

const COLS = 'id, courier, carrier_name, order_no, order_name, forward_awb, rto_awb, scanned_code, payment_mode, order_value, customer_name, customer_phone10, stage, courier_status, rto_delivered_at, last_movement_at, last_event_at, legacy_source';

/** Read-only: that IST day's scans from the events history, joined to the RTOs as they are now. */
export async function loadScanLog(day: string) {
	const { from, to } = dayRange(day);
	const { data: events, error } = await db()
		.from('events')
		.select('id, rto_id, kind, payload, received_at')
		.in('kind', ['stage_change', 'unknown_parcel'])
		.gte('received_at', from)
		.lt('received_at', to)
		.order('received_at', { ascending: true })
		.limit(3000);
	if (error) throw new Error(`events: ${error.message}`);
	const ids = [...new Set((events ?? []).map((e) => e.rto_id).filter(Boolean))] as string[];
	const rtos = new Map<string, Rto>();
	for (let i = 0; i < ids.length; i += 200) {
		const { data, error: e2 } = await db().from('rtos').select(COLS).in('id', ids.slice(i, i + 200));
		if (e2) throw new Error(`rtos: ${e2.message}`);
		for (const r of (data ?? []) as unknown as Rto[]) rtos.set(r.id, r);
	}
	return buildScanLog((events ?? []) as LogEvent[], rtos);
}
