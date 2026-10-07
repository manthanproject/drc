// Human wording for the events log (RTO detail → History). Pure, tested.
import { BUCKETS, bucketOfStage, dateShort, disputeStatus, disputeType } from './dashboard.ts';
import { reasonOf } from './claims.ts';

export interface EventRow {
	id: number;
	source: string;
	kind: string | null;
	payload: any;
	received_at: string;
}

const ACTION: Record<string, string> = {
	received_call: 'Received OK, to call customer',
	ready_stock: 'Ready Stock',
	reship: 'Re-ship',
	hold: 'Hold',
	close: 'Closed',
	call_no_answer: 'Call: no answer',
	reship_confirm: 'Confirmed received (was re-shipped)',
	reship_reject: 'Re-ship was from new stock',
	migrate_store_credit: 'Store credit moved to Ready Stock'
};

const stageName = (s: unknown) => (typeof s === 'string' ? BUCKETS[bucketOfStage(s)]?.label ?? s : '');
const WHO: Record<string, string> = { user: 'Staff', system: 'DRC', velocity: 'Velocity', shiprocket: 'Shiprocket' };
const courierWord = (s: unknown) => String(s ?? '').replace(/_/g, ' ');

export function describe(e: EventRow): { text: string; who: string; muted: boolean } {
	const p = e.payload ?? {};
	const who = WHO[e.source] ?? e.source;
	switch (e.kind) {
		case 'stage_change': {
			let text = ACTION[p.action] ?? `Moved to ${stageName(p.to)}`;
			if (p.action === 'claim') {
				const n = Number(p.claim?.n_items ?? 0), k = Number(p.claim?.n_restock ?? 0);
				text = `RTO claim: ${reasonOf(p.claim?.reason)?.label ?? 'claim'}${n ? ` (${n} item${n > 1 ? 's' : ''})` : ''}, saved as Draft${k ? ` · ${k} item${k > 1 ? 's' : ''} to Ready Stock` : ''}`;
			}
			if (p.action === 'stock_reuse') text = `Re-used 1 × ${p.args?.item ?? 'item'}${p.args?.order_no ? ` in #${p.args.order_no}` : ''} (${p.args?.unit ?? '?'} of ${p.args?.qty ?? '?'})`;
			if (p.action === 'money_done') text = p.args?.money === 'credit_done' ? 'Store credit given' : 'Refund done';
			if (p.action === 'claim_raised') text = `Claim marked raised${p.args?.ticket_ref ? ` (ref ${p.args.ticket_ref})` : ''}`;
			if (p.action === 'ready_stock' && p.args?.money) text += p.args.money === 'credit' ? ' · store credit' : ' · refund';
			if (p.action === 'reship' && p.args?.reship_date) text += ` on ${dateShort(p.args.reship_date + 'T12:00:00Z')}`;
			if (p.args?.scanned) text = 'Scanned · ' + text;
			if (p.args?.note) text += ` — ${p.args.note}`;
			return { text: p.undone ? `${text} (undone)` : text, who, muted: !!p.undone };
		}
		case 'undo':
			return { text: `Undo, back to ${stageName(p.restored_stage)}`, who, muted: false };
		case 'manual_stage':
			return { text: `Moved to ${stageName(p.to)}${p.why ? ` (${p.why})` : ''}`, who: 'Staff (SQL)', muted: false };
		case 'status_change':
			return { text: `Courier: ${courierWord(p.from)} → ${courierWord(p.to)}`, who, muted: false };
		case 'first_seen':
			return { text: `First seen as ${courierWord(p.status)}`, who, muted: false };
		case 'sheet_backfill':
			return { text: 'Imported from the old Return Orders sheet', who: 'DRC', muted: false };
		case 'reship_found':
			return { text: `Re-ship #${p.reship_order_no} found (${courierWord(p.reship_courier_status)})`, who, muted: false };
		case 'reship_withdrawn':
			return { text: `Re-ship #${p.reship_order_no} no longer counts (cancelled or changed)`, who, muted: false };
		case 'dispute_update': {
			const to = disputeStatus(p.to).label;
			const kind = String(p.type ?? '').toUpperCase() === 'MDND' ? 'MDND' : disputeType(p.type);
			return { text: p.from ? `Velocity dispute (${kind}): ${disputeStatus(p.from).label} → ${to}` : `Velocity dispute (${kind}) seen: ${to}`, who: 'Velocity', muted: false };
		}
		case 'stock_backfill':
			return { text: `Old Ready Stock: ${p.items ?? ''} item(s) listed as In stock`, who: 'DRC', muted: true };
		case 'test_reset':
			return { text: `Test scans cleared, back to ${stageName(p.restored_stage)}`, who: 'Staff (SQL)', muted: true };
		case 'unknown_parcel':
			return { text: `Saved as unknown parcel (scanned ${p.code ?? '—'})`, who, muted: false };
		default:
			return { text: e.kind ?? 'Event', who, muted: false };
	}
}
