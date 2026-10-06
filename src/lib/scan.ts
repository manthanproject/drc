// Scan matching (Phase 3b). Pure, tested. Order of trust:
//   1. AWB (forward or RTO) exact            → the parcel in your hand
//   2. Order number, incl. its re-ships        → "1642" lists 1642, 1642-1, 1642-1-1
//   3. Phone (last 10 digits)
//   4. Name (3+ letters, contains)
import { orderNoOf } from './reship.ts';
import type { Rto } from './dashboard.ts';

export type MatchBy = 'awb' | 'order' | 'phone' | 'name' | 'none';

const depth = (o: string | null) => (o ?? '').split('-').length;

export function findMatches(rtos: Rto[], raw: string): { by: MatchBy; matches: Rto[] } {
	const text = String(raw ?? '').trim();
	if (!text) return { by: 'none', matches: [] };
	const up = text.toUpperCase().replace(/\s+/g, '');

	const awb = rtos.filter(
		(r) =>
			(r.forward_awb && r.forward_awb.toUpperCase() === up) ||
			(r.rto_awb && r.rto_awb.toUpperCase() === up) ||
			(r.stage === 'unknown_parcel' && r.scanned_code && r.scanned_code.toUpperCase().replace(/\s+/g, '') === up)
	);
	if (awb.length) return { by: 'awb', matches: awb };

	const order = orderNoOf(text).toLowerCase();
	if (order) {
		const byOrder = rtos.filter((r) => {
			const o = (r.order_no ?? '').toLowerCase();
			return o === order || (/^\d+(-\d+)*$/.test(order) && o.startsWith(order + '-'));
		});
		if (byOrder.length) {
			byOrder.sort((a, b) => depth(a.order_no) - depth(b.order_no) || (a.order_no ?? '').localeCompare(b.order_no ?? ''));
			return { by: 'order', matches: byOrder };
		}
	}

	const digits = text.replace(/\D/g, '');
	if (digits.length >= 10) {
		const byPhone = rtos.filter((r) => r.customer_phone10 && r.customer_phone10 === digits.slice(-10));
		if (byPhone.length) return { by: 'phone', matches: byPhone };
	}

	const letters = text.toLowerCase();
	if (/[a-z]{3,}/i.test(text)) {
		const byName = rtos.filter((r) => (r.customer_name ?? '').toLowerCase().includes(letters));
		if (byName.length) return { by: 'name', matches: byName.slice(0, 20) };
	}
	return { by: 'none', matches: [] };
}

/** Today's start in IST, as an ISO string (for "Scanned today"). */
export function istDayStart(now: number): string {
	const IST = 5.5 * 3_600_000;
	const d = new Date(now + IST);
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST).toISOString();
}

/** Tomorrow in IST as yyyy-mm-dd (default re-ship date). */
export function istTomorrow(now: number): string {
	const d = new Date(now + 5.5 * 3_600_000 + 86_400_000);
	return d.toISOString().slice(0, 10);
}

/** Only same-site paths for ?from= back links ('scan' kept for older links). Never '//x' or 'https://x'. */
export function safePath(v: string | null | undefined): string | null {
	if (!v) return null;
	if (v === 'scan') return '/scan';
	return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') && !v.startsWith('/rto/') ? v : null;
}

/** Link to an RTO page that remembers where it was opened from. */
export const rtoHref = (id: string, from: string) => `/rto/${id}?from=${encodeURIComponent(from)}`;

/** Claim page link. ret 'rto' = come back to the RTO page (which itself goes back to `from`); 'from' = go straight back to `from` (Scan). */
export function claimHref(id: string, from: string, opts: { scanned?: boolean; ret: 'rto' | 'from' }): string {
	const p = new URLSearchParams({ from });
	if (opts.scanned) p.set('scanned', '1');
	p.set('ret', opts.ret);
	return `/rto/${id}/claim?${p}`;
}

/** Where the claim page goes back to (and returns after saving). */
export function claimReturn(id: string, from: string | null, ret: string | null): string {
	const safe = safePath(from);
	if (ret === 'from' && safe) return safe;
	return safe ? rtoHref(id, safe) : `/rto/${id}`;
}

/** Adds ?undo=<event>&msg=… so the page we land on shows the Undo bar. */
export function withUndo(path: string, eventId: number, msg: string): string {
	const u = new URL(path, 'http://x');
	u.searchParams.set('undo', String(eventId));
	u.searchParams.set('msg', msg.slice(0, 120));
	return u.pathname + u.search;
}

/** Reads (and validates) ?undo / ?msg. */
export function undoFromUrl(u: { searchParams: Pick<URLSearchParams, 'get'> }): { eventId: number; text: string } | null {
	const id = Number(u.searchParams.get('undo'));
	if (!Number.isSafeInteger(id) || id <= 0) return null;
	return { eventId: id, text: (u.searchParams.get('msg') ?? 'Saved').slice(0, 120) };
}
