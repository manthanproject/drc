import { error } from '@sveltejs/kit';
import { db } from './supabase.ts';
import type { Rto } from '#lib/dashboard.ts';
import type { EventRow } from '#lib/history.ts';
import { isDummyItem } from '#lib/claims.ts';

const COLS =
	'id, courier, carrier_name, order_no, order_name, forward_awb, rto_awb, scanned_code, payment_mode, order_value, amount_collected, ' +
	'customer_name, customer_phone10, stage, courier_status, rto_delivered_at, last_movement_at, last_event_at, last_event_text, ' +
	'last_event_location, legacy_source, scanned_at, callback_attempts, callback_outcome, reship_date, refund_state, notes, ' +
	'reship_order_no, reship_awb, reship_created_at, reship_courier_status, reship_state, media_folder_id, media_state, ' +
	'ship:courier_raw->shipping_address, disputes:courier_raw->shipment_disputes';

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
	ship?: { full_address?: string | null; city?: string | null; state?: string | null; zip?: string | null } | null;
	media_folder_id: string | null;
	media_state: string;
}

export interface Item {
	id: string;
	sku: string | null;
	title: string;
	qty: number;
	is_gift: boolean;
	ready_stock_state: 'na' | 'in_stock' | 'reused';
	condition: string;
}

export interface ClaimRow {
	id: string;
	reason: string;
	status: string;
	channel: string;
	ticket_url?: string | null;
	ticket_ref: string | null;
	claimed_amount: number | string;
	deadline_at: string | null;
	raised_at: string | null;
	description: string | null;
	created_at: string;
	rto_id: string;
	expected_amount?: number | string | null;
	approved_amount?: number | string | null;
	approved_at?: string | null;
	next_follow_up_at?: string | null;
	follow_ups?: number | null;
	last_follow_up_at?: string | null;
	escalated_at?: string | null;
	close_result?: string | null;
	closed_at?: string | null;
}

export interface MediaRow {
	id: string;
	kind: string;
	drive_file_id: string;
	mime_type: string | null;
	size_bytes: number | null;
	uploaded_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getRtoDetail(id: string) {
	if (!UUID.test(id)) error(404, 'RTO not found');
	const [r, items, events, claims, media] = await Promise.all([
		db().from('rtos').select(COLS).eq('id', id).maybeSingle(),
		db().from('rto_items').select('id, sku, title, qty, is_gift, ready_stock_state, condition').eq('rto_id', id).order('is_gift').order('title'),
		db().from('events').select('id, source, kind, payload, received_at').eq('rto_id', id).order('id', { ascending: false }).limit(40),
		db().from('claims').select('id, rto_id, reason, status, channel, ticket_ref, ticket_url, claimed_amount, expected_amount, approved_amount, approved_at, next_follow_up_at, follow_ups, last_follow_up_at, escalated_at, close_result, closed_at, deadline_at, raised_at, description, created_at').eq('rto_id', id).order('created_at', { ascending: false }),
		db().from('rto_media').select('id, kind, drive_file_id, mime_type, size_bytes, uploaded_at').eq('rto_id', id).is('trashed_at', null).order('uploaded_at')
	]);
	if (r.error) throw new Error(`rtos: ${r.error.message}`);
	if (!r.data) error(404, 'RTO not found');
	if (items.error) throw new Error(`rto_items: ${items.error.message}`);
	if (events.error) throw new Error(`events: ${events.error.message}`);
	if (claims.error) throw new Error(`claims: ${claims.error.message}`);
	if (media.error) throw new Error(`rto_media: ${media.error.message}`);
	const { data: set } = await db().from('settings').select('key, value').in('key', ['max_call_attempts', 'follow_up_hours']);
	const maxCalls = set?.find((s) => s.key === 'max_call_attempts');
	const followHours = Number(set?.find((s) => s.key === 'follow_up_hours')?.value) > 0 ? Number(set?.find((s) => s.key === 'follow_up_hours')?.value) : 48;
	return {
		rto: r.data as unknown as RtoFull,
		items: ((items.data ?? []) as Item[]).filter((i) => !isDummyItem(i)), // hide Velocity's "Pay on Delivery" line
		claims: (claims.data ?? []) as ClaimRow[],
		media: (media.data ?? []) as MediaRow[],
		events: (events.data ?? []) as EventRow[],
		maxCalls: Number(maxCalls?.value) > 0 ? Number(maxCalls?.value) : 3,
		followHours
	};
}
