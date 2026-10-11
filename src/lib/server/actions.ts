import { error } from '@sveltejs/kit';
import { db } from './supabase.ts';

/** Every staff change goes through public.rto_action() (audit row + undo data in one transaction). */
export const ACTIONS = ['received_call', 'ready_stock', 'reship', 'hold', 'close', 'call_no_answer', 'reship_confirm', 'reship_reject'] as const;
export type Action = (typeof ACTIONS)[number];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plain-English messages for the DRC_* errors raised in SQL. */
const MESSAGES: Record<string, [number, string]> = {
	DRC_NOT_FOUND: [404, 'RTO not found'],
	DRC_MONEY_CHOICE_REQUIRED: [400, 'Prepaid order: choose Refund or Store credit'],
	DRC_RESHIP_DATE_REQUIRED: [400, 'Pick a re-ship date'],
	DRC_NOT_IN_TO_CALL: [409, 'This RTO is not waiting for a call'],
	DRC_NO_PENDING_RESHIP: [409, 'No re-ship suggestion to confirm'],
	DRC_UNKNOWN_ACTION: [400, 'Unknown action'],
	DRC_ALREADY_UNDONE: [409, 'Already undone'],
	DRC_UNDO_EXPIRED: [409, 'Too late to undo (10 minutes)'],
	DRC_NOT_LATEST: [409, 'A newer change exists; undo that first'],
	DRC_NO_COURIER: [400, 'Old-sheet RTO with no courier/AWB: a claim is not possible here'],
	DRC_BAD_REASON: [400, 'Pick a reason'],
	DRC_CLAIM_EXISTS: [409, 'This RTO already has an open claim'],
	DRC_ITEMS_REQUIRED: [400, 'Tick the item(s) with the problem'],
	DRC_BAD_ITEMS: [400, 'Those items do not belong to this RTO'],
	DRC_MEDIA_REQUIRED: [400, 'Unboxing video, front, back and label photos are all needed'],
	DRC_BAD_MEDIA: [400, 'Unknown media type'],
	DRC_CLAIM_NOT_DRAFT: [409, 'The claim is already raised, so it cannot be undone here'],
	DRC_TEXT_REQUIRED: [400, 'Remarks are empty'],
	DRC_NOT_IN_STOCK: [409, 'Nothing of this item is left in stock. Refresh the page'],
	DRC_NOTHING_DUE: [409, 'Nothing is owed on this order any more. Refresh the page'],
	DRC_TICKET_REF_REQUIRED: [400, 'Type the ticket number'],
	DRC_NO_PARCELS: [400, 'Tick at least one parcel'],
	DRC_MIXED_COURIER: [400, 'One ticket per courier: tick parcels of one courier only'],
	DRC_HAS_DAMAGE_CLAIM: [409, 'A damage or wrong-item claim is open on this parcel. Withdraw it first'],
	DRC_HAS_CLAIM: [409, 'One of these parcels already has an open claim or ticket. Refresh the page'],
	DRC_BAD_DATE: [400, 'Raised date must be today or earlier'],
	DRC_TICKET_CHANGED: [409, 'The ticket was already updated, so it cannot be undone here'],
	DRC_CLAIM_NOT_OPEN: [409, 'This claim is not open any more. Refresh the page'],
	DRC_HAS_CREDIT: [409, 'Money is already linked to this claim, so it cannot be withdrawn'],
	DRC_BAD_AMOUNT: [400, 'Type a valid amount'],
	DRC_CN_REQUIRED: [400, 'Type the credit note number'],
	DRC_NOT_CLAIM_MONEY: [400, 'That passbook line is not claim money'],
	DRC_LEDGER_USED: [409, 'That money is already linked to a claim. Refresh the page'],
	DRC_BAD_LABEL: [400, 'Unknown label'],
	DRC_BAD_SOURCE: [400, 'Unknown passbook source'],
	DRC_NO_ROWS: [400, 'No passbook lines to import'],
	DRC_REASON_REQUIRED: [400, 'Type why it has not arrived'],
	DRC_ALREADY_NOT_ARRIVED: [409, 'This parcel is already marked as not arrived. Refresh the page'],
	DRC_STOCK_USED: [409, 'An item of this parcel was already re-used from Ready Stock, so it cannot be marked not arrived'],
	DRC_NOT_AWAITING: [409, 'This parcel is no longer waiting to arrive (scanned or changed). Refresh the page'],
	DRC_CLAIM_RAISED_SCAN: [409, 'A claim from this scan is already raised with the courier, so the scan cannot be cleared'],
	DRC_BAD_RECEIVED_DATE: [400, 'Arrived date must be on or before the scan day, and at most 30 days before it'],
	DRC_NOT_SCANNED: [409, 'This parcel is not scanned, nothing to clear. Refresh the page'],
	DRC_SCAN_NOT_TODAY: [409, "Only today's scans can be cleared. For an older scan use Change status or Mark not arrived"],
	DRC_REFUND_PAID: [409, 'The refund for this parcel is already marked Done in Refunds, so the scan cannot be cleared'],
	DRC_SCAN_NOT_CLEARED: [409, 'Could not clear this scan. Refresh the page and try again']
};

export function fail(message: string): never {
	const code = Object.keys(MESSAGES).find((k) => message.includes(k));
	const [status, text] = code ? MESSAGES[code] : [500, 'Database error'];
	if (!code) console.error('rto action failed:', message);
	error(status, text);
}

export interface ActionArgs {
	money?: 'refund' | 'credit' | 'replacement' | 'none'; // replacement / none: customer returns only (the database refuses them for RTOs)
	reship_date?: string;
	note?: string;
	scanned?: boolean;
}

export function cleanArgs(raw: unknown): ActionArgs {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const out: ActionArgs = {};
	if (b.money === 'refund' || b.money === 'credit' || b.money === 'replacement' || b.money === 'none') out.money = b.money;
	if (typeof b.reship_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.reship_date)) out.reship_date = b.reship_date;
	if (typeof b.note === 'string' && b.note.trim()) out.note = b.note.trim().slice(0, 500);
	if (b.scanned === true) out.scanned = true;
	return out;
}

/** After a scan: save the "Arrived on" day picked on the Scan screen. Never fails the scan itself. */
export async function applyArrived(rtoId: string, day: string | null) {
	if (!day) return;
	const { error: e } = await db().rpc('set_received_on', { p_rto: rtoId, p_day: day, p_today_scan_only: true });
	if (e) console.error('arrived date not saved', rtoId, e.message);
}

/** Staff fix of the arrived date of a scanned parcel; null = arrived the day it was scanned. */
export async function setReceivedOn(rtoId: string, day: string | null) {
	if (!UUID.test(rtoId)) error(400, 'Bad RTO id');
	const { data, error: e } = await db().rpc('set_received_on', { p_rto: rtoId, p_day: day, p_today_scan_only: false });
	if (e) fail(e.message);
	return data as { changed: boolean; received_on: string };
}

export async function runAction(rtoId: string, action: string, args: ActionArgs, arrived: string | null = null) {
	if (!UUID.test(rtoId)) error(400, 'Bad RTO id');
	if (action === 'not_arrived') {
		// wrongly marked received (wrong scan / old-sheet import) → back to courier tracking; reason required
		const { data, error: e } = await db().rpc('mark_not_arrived', { p_rto: rtoId, p_note: args.note ?? '' });
		if (e) fail(e.message.includes('DRC_HAS_CLAIM') ? 'DRC_HAS_DAMAGE_CLAIM' : e.message);
		return data as { event_id: number; from: string; to: string };
	}
	if (action === 'clear_scan') {
		// scanned today by mistake / wrong status → everything since the scan undone, parcel back as before (scan it again)
		const { data, error: e } = await db().rpc('clear_today_scan', { p_rto: rtoId });
		if (e) fail(e.message.includes('DRC_CLAIM_NOT_DRAFT') ? 'DRC_CLAIM_RAISED_SCAN' : e.message);
		return data as { event_id: number; cleared: number; to: string };
	}
	if (!(ACTIONS as readonly string[]).includes(action)) error(400, 'Unknown action');
	const { data, error: e } = await db().rpc('rto_action', { p_rto: rtoId, p_action: action, p_args: args });
	if (e) fail(e.message);
	if (args.scanned) await applyArrived(rtoId, arrived);
	return data as { event_id: number; from: string; to: string };
}

export async function undoAction(eventId: number) {
	if (!Number.isSafeInteger(eventId) || eventId <= 0) error(400, 'Bad event id');
	const { data, error: e } = await db().rpc('undo_rto_action', { p_event: eventId });
	if (e) fail(e.message);
	return data as { rto_id: string; stage: string };
}
