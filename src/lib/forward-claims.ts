// Delivery claims (24 Nov 2026): a claim on a parcel that went OUT to the customer and never came back to us
// (delivered damaged / wrong / short, or marked delivered but never received). Stored as an rtos row of kind
// 'forward' that only holds its claim (migration 0026). Pure helpers here; the database call is in server/forward-claims.ts.
import { cleanTicketRef } from './tickets.ts';

export const FWD_REASONS = [
	{ key: 'damaged', label: 'Delivered damaged / leaked' },
	{ key: 'wrong_product', label: 'Wrong product delivered' },
	{ key: 'missing_items', label: 'Item missing / empty box' },
	{ key: 'mdnd', label: 'Marked delivered, customer never got it' },
	{ key: 'lost', label: 'Lost in transit' },
	{ key: 'other', label: 'Other' }
] as const;

export const FWD_CHANNELS = [
	{ key: 'panel_dispute', label: 'Dispute on the courier panel' },
	{ key: 'support_ticket', label: 'Support ticket' },
	{ key: 'email', label: 'Email' }
] as const;

export type FwdReason = (typeof FWD_REASONS)[number]['key'];
export type FwdChannel = (typeof FWD_CHANNELS)[number]['key'];

export interface ForwardClaimArgs {
	courier: 'velocity' | 'shiprocket';
	awb: string;
	order_no: string;
	order_name: string;
	carrier_name?: string;
	customer_name?: string;
	order_value?: string;
	reason: FwdReason;
	channel: FwdChannel;
	status: 'raised' | 'escalated';
	ticket_ref?: string;
	raised_on?: string;
	claimed_amount: string;
	description?: string;
	note?: string;
}

/** "#Dropy-6770", "Dropy-6770-ALL", "6770" → "6770"; keeps a split suffix ("1517-1"). Empty when it is not an order no. */
export function cleanOrderNo(v: unknown): string {
	const s = String(v ?? '')
		.trim()
		.replace(/^#/, '')
		.replace(/^dropy[-\s]*/i, '')
		.replace(/-all$/i, '');
	return /^\d{1,7}(-\d{1,2}|[A-Z])?$/i.test(s) ? s.toUpperCase() : '';
}

/** AWBs are letters and digits only (spaces and dashes dropped), 6–30 long. */
export function cleanAwb(v: unknown): string {
	const s = String(v ?? '').replace(/[\s-]/g, '').toUpperCase();
	return /^[A-Z0-9]{6,30}$/.test(s) ? s : '';
}

/** "₹1,379.00" → "1379"; null when not a positive amount. */
export function cleanAmount(v: unknown): string | null {
	const n = Number(String(v ?? '').replace(/[₹,\s]/g, ''));
	return Number.isFinite(n) && n > 0 && n < 10_000_000 ? String(Math.round(n * 100) / 100) : null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Form body → arguments for create_forward_claim, or the first problem in plain words. today = IST YYYY-MM-DD. */
export function cleanForwardClaim(raw: unknown, today: string): { ok: true; args: ForwardClaimArgs } | { ok: false; error: string } {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const courier = b.courier === 'shiprocket' ? 'shiprocket' : b.courier === 'velocity' ? 'velocity' : null;
	if (!courier) return { ok: false, error: 'Pick the courier account (Velocity or Shiprocket)' };
	const order_no = cleanOrderNo(b.order_no);
	if (!order_no) return { ok: false, error: 'Type the order no., e.g. 6770' };
	const awb = cleanAwb(b.awb);
	if (!awb) return { ok: false, error: 'Type the AWB of the delivered parcel' };
	const reason = FWD_REASONS.find((r) => r.key === b.reason)?.key;
	if (!reason) return { ok: false, error: 'Pick what went wrong' };
	const channel = FWD_CHANNELS.find((c) => c.key === b.channel)?.key;
	if (!channel) return { ok: false, error: 'Pick where it was raised' };
	const ticket_ref = cleanTicketRef(b.ticket_ref) || undefined;
	if (channel === 'support_ticket' && !ticket_ref) return { ok: false, error: 'Type the ticket number' };
	const claimed_amount = cleanAmount(b.claimed_amount);
	if (!claimed_amount) return { ok: false, error: 'Type the claim amount' };
	let raised_on: string | undefined;
	if (typeof b.raised_on === 'string' && b.raised_on) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(b.raised_on) || b.raised_on > today) return { ok: false, error: 'Raised date must be today or earlier' };
		raised_on = b.raised_on;
	}
	const order_value = cleanAmount(b.order_value) ?? undefined;
	return {
		ok: true,
		args: {
			courier,
			awb,
			order_no,
			order_name: `Dropy-${order_no}`,
			carrier_name: text(b.carrier_name, 60),
			customer_name: text(b.customer_name, 80),
			order_value,
			reason,
			channel,
			status: b.status === 'escalated' ? 'escalated' : 'raised',
			ticket_ref,
			raised_on,
			claimed_amount,
			description: text(b.description, 4000),
			note: text(b.note, 300)
		}
	};
}
