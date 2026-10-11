// Customer returns screen: which list each return is in. Pure, tested.
import { velocityRefunded } from './returns-map.ts';

export interface RetRow {
	id: string;
	stage: string;
	courier_status: string | null;
	rto_delivered_at: string | null;
	scanned_at: string | null;
	vref: string | null;
	refund: { status: string; amount: number | string | null } | null;
}
export type RetTab = 'arrived' | 'coming' | 'hold' | 'done';
export const RET_TABS: { key: RetTab; label: string }[] = [
	{ key: 'arrived', label: 'Arrived, scan it' },
	{ key: 'coming', label: 'Coming back' },
	{ key: 'hold', label: 'On hold' },
	{ key: 'done', label: 'Done' }
];
const LATE_MS = 2 * 86_400_000;

export function retTab(r: RetRow): RetTab {
	if (r.stage === 'awaiting_receipt') return 'arrived';
	if (r.stage === 'in_flight' || r.stage === 'delayed') return 'coming';
	if (r.stage === 'hold') return 'hold';
	return 'done';
}

/** Delivered to the warehouse 2+ days ago and still not scanned. */
export const arrivedLate = (r: RetRow, now: number) =>
	r.stage === 'awaiting_receipt' && !r.scanned_at && !!r.rto_delivered_at && now - Date.parse(r.rto_delivered_at) >= LATE_MS;
export const pickupFailing = (r: RetRow) => r.stage === 'in_flight' && r.courier_status === 'return_not_picked';
export const refundOpen = (r: RetRow) => !!r.refund && r.refund.status !== 'done' && r.refund.status !== 'no_refund';

export function groupReturns<T extends RetRow>(list: T[], now: number) {
	const tabs: Record<RetTab, T[]> = { arrived: [], coming: [], hold: [], done: [] };
	for (const r of list) tabs[retTab(r)].push(r);
	return {
		tabs,
		late: list.filter((r) => arrivedLate(r, now)).length,
		failing: list.filter(pickupFailing).length,
		refundToDo: list.filter(refundOpen).length,
		velocityPaid: list.filter((r) => velocityRefunded(r.vref))
	};
}

/** Velocity's return status → plain words for the list. */
export function retStatusText(courierStatus: string | null): string {
	const map: Record<string, string> = {
		return_pickup_scheduled: 'Pickup scheduled',
		return_not_picked: 'Pickup failed',
		return_in_transit: 'In transit',
		return_need_attention: 'Needs attention',
		return_delivered: 'Delivered to warehouse',
		return_cancelled: 'Cancelled'
	};
	return map[String(courierStatus ?? '')] ?? String(courierStatus ?? '—').replace(/^return_/, '').replace(/_/g, ' ');
}
