import { error } from '@sveltejs/kit';
import { db } from './supabase.ts';
import type { Rto } from '#lib/dashboard.ts';
import type { EventRow } from '#lib/history.ts';

const COLS =
	'id, courier, carrier_name, order_no, order_name, forward_awb, rto_awb, scanned_code, payment_mode, order_value, amount_collected, ' +
	'customer_name, customer_phone10, stage, courier_status, rto_delivered_at, last_movement_at, last_event_at, last_event_text, ' +
	'last_event_location, legacy_source, scanned_at, callback_attempts, callback_outcome, reship_date, refund_state, notes, ' +
	'reship_order_no, reship_awb, reship_created_at, reship_courier_status, reship_state';

export interface RtoFull extends Rto {
	amount_collected: number | string | null;
	last_event_text: string | null;
	last_event_location: string | null;
	scanned_at: string | null;
	callback_attempts: number;
	callback_outcome: string | null;
	reship_date: string | null;
	refund_state: 'na' | 'due' | 'done' | 'credit_due' | 'credit_done';
	notes: string | null;
}

export interface Item {
	id: string;
	sku: string | null;
	title: string;
	qty: number;
	is_gift: boolean;
	ready_stock_state: 'na' | 'in_stock' | 'reused';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getRtoDetail(id: string) {
	if (!UUID.test(id)) error(404, 'RTO not found');
	const [r, items, events] = await Promise.all([
		db().from('rtos').select(COLS).eq('id', id).maybeSingle(),
		db().from('rto_items').select('id, sku, title, qty, is_gift, ready_stock_state').eq('rto_id', id).order('is_gift').order('title'),
		db().from('events').select('id, source, kind, payload, received_at').eq('rto_id', id).order('id', { ascending: false }).limit(40)
	]);
	if (r.error) throw new Error(`rtos: ${r.error.message}`);
	if (!r.data) error(404, 'RTO not found');
	if (items.error) throw new Error(`rto_items: ${items.error.message}`);
	if (events.error) throw new Error(`events: ${events.error.message}`);
	const { data: maxCalls } = await db().from('settings').select('value').eq('key', 'max_call_attempts').maybeSingle();
	return {
		rto: r.data as unknown as RtoFull,
		items: (items.data ?? []) as Item[],
		events: (events.data ?? []) as EventRow[],
		maxCalls: Number(maxCalls?.value) > 0 ? Number(maxCalls?.value) : 3
	};
}
