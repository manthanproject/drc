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
	DRC_TEXT_REQUIRED: [400, 'Remarks are empty']
};

export function fail(message: string): never {
	const code = Object.keys(MESSAGES).find((k) => message.includes(k));
	const [status, text] = code ? MESSAGES[code] : [500, 'Database error'];
	if (!code) console.error('rto action failed:', message);
	error(status, text);
}

export interface ActionArgs {
	money?: 'refund' | 'credit';
	reship_date?: string;
	note?: string;
	scanned?: boolean;
}

export function cleanArgs(raw: unknown): ActionArgs {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const out: ActionArgs = {};
	if (b.money === 'refund' || b.money === 'credit') out.money = b.money;
	if (typeof b.reship_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.reship_date)) out.reship_date = b.reship_date;
	if (typeof b.note === 'string' && b.note.trim()) out.note = b.note.trim().slice(0, 500);
	if (b.scanned === true) out.scanned = true;
	return out;
}

export async function runAction(rtoId: string, action: string, args: ActionArgs) {
	if (!UUID.test(rtoId)) error(400, 'Bad RTO id');
	if (!(ACTIONS as readonly string[]).includes(action)) error(400, 'Unknown action');
	const { data, error: e } = await db().rpc('rto_action', { p_rto: rtoId, p_action: action, p_args: args });
	if (e) fail(e.message);
	return data as { event_id: number; from: string; to: string };
}

export async function undoAction(eventId: number) {
	if (!Number.isSafeInteger(eventId) || eventId <= 0) error(400, 'Bad event id');
	const { data, error: e } = await db().rpc('undo_rto_action', { p_event: eventId });
	if (e) fail(e.message);
	return data as { rto_id: string; stage: string };
}
