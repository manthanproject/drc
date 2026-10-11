import { db } from '#lib/server/supabase.ts';
import type { PageServerLoad } from './$types';

export interface ReturnItem {
	id: string;
	order_no: string;
	return_id: string | null;
	return_reason: string | null;
	order_value: number | string | null;
	carrier_name: string | null;
	forward_awb: string | null;
	stage: string;
	courier_status: string | null;
	rto_delivered_at: string | null;
	last_event_at: string | null;
	last_event_text: string | null;
	scanned_at: string | null;
	rto_initiated_at: string | null;
	vref: string | null;
	fails: number | null;
	items: { title: string; qty: number }[];
	refund: { status: string; amount: number | string | null } | null;
}

/** Customer returns (reverse pickups we create in Velocity), with their item names and refund row. Read only. */
export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const [rows, last] = await Promise.all([
		db().from('rtos')
			.select('id, order_no, return_id, return_reason, order_value, carrier_name, forward_awb, stage, courier_status, rto_delivered_at, last_event_at, last_event_text, scanned_at, rto_initiated_at, vref:courier_raw->>refund_status, fails:courier_raw->pickup_fails, items:rto_items(title, qty), refunds(status, amount, deleted_at)')
			.eq('kind', 'customer_return').order('rto_initiated_at', { ascending: false }).limit(500),
		db().from('settings').select('value').eq('key', 'returns_last_sync').maybeSingle()
	]);
	if (rows.error) throw new Error(`returns: ${rows.error.message}`);
	const list = ((rows.data ?? []) as any[]).map((r) => {
		const live = (Array.isArray(r.refunds) ? r.refunds : []).filter((f: any) => !f.deleted_at);
		return { ...r, items: Array.isArray(r.items) ? r.items : [], refund: live[0] ? { status: live[0].status, amount: live[0].amount } : null, refunds: undefined } as ReturnItem;
	});
	return { list, lastSync: (last.data?.value ?? null) as { ok?: boolean; at?: string; error?: string } | null, now: Date.now() };
};
