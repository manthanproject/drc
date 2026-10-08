// Refunds module (option B): labels, the column model (built-in + columns staff add), and the one-time reading of the
// "Dropy Refund" sheet tab (row colour → status). Pure, tested.

export const STATUSES = ['to_refund', 'waiting', 'needs_check', 'on_hold', 'done', 'no_refund'] as const;
export type RefundStatus = (typeof STATUSES)[number];
export const STATUS: Record<RefundStatus, { label: string; pill: string }> = {
	to_refund: { label: 'To refund', pill: 'p-acc' },
	waiting: { label: 'Waiting', pill: 'p-info' },
	needs_check: { label: 'Needs check', pill: 'p-bad' },
	on_hold: { label: 'On hold', pill: 'p-warn' },
	done: { label: 'Done', pill: 'p-ok' },
	no_refund: { label: 'No refund', pill: 'p-mute' }
};
export const OPEN_STATUSES: RefundStatus[] = ['to_refund', 'waiting', 'needs_check', 'on_hold'];
export const VIA: Record<string, string> = { bank: 'Bank', payu: 'PayU', razorpay: 'Razorpay' };
export const TO: Record<string, string> = { original: 'Original method', store_credit: 'Store credit' };
export const REASON_CHIPS = ['Currently unavailable', 'Customer cancelled', 'Damaged', 'Longer delivery', 'High price', 'RTO'];

export interface Refund {
	id: string;
	order_no: string;
	rto_id: string | null;
	reason: string | null;
	via: string | null;
	refund_to: string | null;
	amount: number | string | null;
	status: RefundStatus;
	done_at: string | null;
	done_ref: string | null;
	extra: Record<string, unknown>;
	source: 'manual' | 'sheet' | 'rto';
	created_at: string;
	updated_at: string;
}

// ---------- columns ----------

export type ColType = 'text' | 'number' | 'date' | 'choice';
export interface CustomCol {
	key: string; // c_xxxxxx
	label: string;
	type: ColType;
	options?: string[];
}
export interface ColumnsSetting {
	custom: CustomCol[];
	hidden: string[];
}
/** Built-in columns. Order and Status always show. */
export const BUILTIN: { key: string; label: string; fixed?: boolean }[] = [
	{ key: 'order', label: 'Order', fixed: true },
	{ key: 'reason', label: 'Reason' },
	{ key: 'via', label: 'Via' },
	{ key: 'to', label: 'Refund to' },
	{ key: 'amount', label: 'Amount' },
	{ key: 'status', label: 'Status', fixed: true },
	{ key: 'added', label: 'Added' },
	{ key: 'done', label: 'Done on' }
];
export const COL_TYPES: Record<ColType, string> = { text: 'Text', number: 'Number', date: 'Date', choice: 'Choice list' };

/** Re-checks a columns setting coming from the browser. Throws a plain-English message when it is wrong. */
export function cleanColumns(raw: unknown): ColumnsSetting {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const list = Array.isArray(b.custom) ? b.custom : [];
	if (list.length > 20) throw new Error('Up to 20 columns of your own');
	const custom: CustomCol[] = [];
	const labels = new Set(BUILTIN.map((c) => c.label.toLowerCase()));
	for (const x of list as Record<string, unknown>[]) {
		const key = String(x?.key ?? '');
		const label = String(x?.label ?? '').trim().slice(0, 40);
		const type = (['text', 'number', 'date', 'choice'] as const).find((t) => t === x?.type);
		if (!/^c_[a-z0-9]{4,16}$/.test(key) || !label || !type) throw new Error('A column needs a name and a type');
		if (labels.has(label.toLowerCase())) throw new Error(`There is already a column called "${label}"`);
		labels.add(label.toLowerCase());
		const options = type === 'choice'
			? [...new Set((Array.isArray(x.options) ? x.options : []).map((o) => String(o).trim().slice(0, 40)).filter(Boolean))].slice(0, 20)
			: undefined;
		if (type === 'choice' && !options?.length) throw new Error(`"${label}": add at least one choice`);
		custom.push(options ? { key, label, type, options } : { key, label, type });
	}
	const known = new Set([...BUILTIN.filter((c) => !c.fixed).map((c) => c.key), ...custom.map((c) => c.key)]);
	const hidden = [...new Set((Array.isArray(b.hidden) ? b.hidden : []).map(String))].filter((k) => known.has(k));
	return { custom, hidden };
}

export const newColKey = (rnd = Math.random) => 'c_' + Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rnd() * 36)]).join('');

/** A custom column's value, cleaned for saving ('' clears it). */
export function cleanValue(col: CustomCol, v: unknown): string | number | null {
	const s = String(v ?? '').trim();
	if (!s) return null;
	if (col.type === 'number') {
		const n = Number(s.replace(/[₹,\s]/g, ''));
		if (!Number.isFinite(n)) throw new Error(`"${col.label}" must be a number`);
		return n;
	}
	if (col.type === 'date') {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`"${col.label}" must be a date`);
		return s;
	}
	if (col.type === 'choice' && !col.options?.includes(s)) throw new Error(`"${col.label}": pick one of the choices`);
	return s.slice(0, 300);
}

/** '#Dropy-3082' | 'Dropy 3082' | '3082' → '3082' */
export const orderNo = (v: string) => v.trim().replace(/^#\s*/, '').replace(/^dropy[-\s]*/i, '');

export function counts(list: Pick<Refund, 'status'>[]) {
	const out = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<RefundStatus, number>;
	for (const r of list) out[r.status]++;
	return out;
}

/** Matches the search box: order no. (with or without #/Dropy-), reason, ref, custom values. */
export function matches(r: Refund, q: string): boolean {
	const s = q.trim().toLowerCase();
	if (!s) return true;
	const n = orderNo(s);
	if (n && r.order_no.toLowerCase().startsWith(n)) return true;
	return [r.reason, r.done_ref, ...Object.values(r.extra ?? {})].some((v) => String(v ?? '').toLowerCase().includes(s));
}

// ---------- the "Dropy Refund" sheet tab (one-time import) ----------

export interface SheetCell { text: string; bg?: { red?: number; green?: number; blue?: number } | null }
export interface SheetRefund {
	sheet_row: number;
	order_no: string;
	reason: string;
	via: string | null;
	refund_to: string | null;
	status: RefundStatus;
}

/** The fill colour the team uses on a row → status. White / none → null. */
export function colourStatus(bg: SheetCell['bg']): RefundStatus | null {
	if (!bg) return null;
	const r = bg.red ?? 0, g = bg.green ?? 0, b = bg.blue ?? 0;
	const hi = 0.55, lo = 0.45;
	if (r > 0.95 && g > 0.95 && b > 0.95) return null; // white
	if (Math.abs(r - g) < 0.08 && Math.abs(g - b) < 0.08) return r < 0.95 ? 'no_refund' : null; // grey
	if (g > hi && b > hi && r < lo) return 'waiting'; // cyan
	if (r > hi && g > hi && b < lo) return 'on_hold'; // yellow
	if (g > hi && r < lo && b < lo) return 'done'; // green
	if (r > hi && g < lo && b < lo) return 'needs_check'; // red
	return null;
}

/** '2340' | 'Dropy-3898, 3263' | 'Dropy-1381-1' → order numbers */
export function sheetOrderNos(cell: string): string[] {
	const out: string[] = [];
	for (const m of cell.matchAll(/(?:dropy-?)?(\d{2,6}(?:-\d{1,2})?)/gi)) out.push(m[1]);
	return [...new Set(out)];
}

/**
 * Rows of the tab (header first): Order Id | Reason | Payment through | Source | Status, with the Order Id cell's fill.
 * Status: "Done" text or green → done; cyan → waiting; yellow → on hold; red → needs check; grey or "no refund" in the
 * reason → no refund; empty reason → needs check; else to refund.
 */
export function parseRefundSheet(rows: SheetCell[][]): { rows: SheetRefund[]; skipped: number[] } {
	const out: SheetRefund[] = [];
	const skipped: number[] = [];
	const head = (rows[0] ?? []).map((c) => c.text.trim().toLowerCase());
	const col = (re: RegExp, d: number) => {
		const i = head.findIndex((h) => re.test(h));
		return i >= 0 ? i : d;
	};
	const cOrder = col(/order/, 0), cReason = col(/reason/, 1), cVia = col(/payment|through|via/, 2), cSrc = col(/source|to/, 3), cStatus = col(/status/, 4);
	rows.slice(1).forEach((r, i) => {
		const line = i + 2;
		const get = (c: number) => String(r[c]?.text ?? '').trim();
		const orders = sheetOrderNos(get(cOrder));
		if (!orders.length) {
			if (r.some((c) => c.text.trim())) skipped.push(line);
			return;
		}
		const reason = get(cReason).slice(0, 500);
		const v = get(cVia).toLowerCase();
		const via = /payu/.test(v) ? 'payu' : /razor/.test(v) ? 'razorpay' : /bank/.test(v) ? 'bank' : null;
		const s = get(cSrc).toLowerCase();
		const refund_to = /store|credit|wallet/.test(s) ? 'store_credit' : /original/.test(s) ? 'original' : null;
		const colour = colourStatus(r[cOrder]?.bg);
		const status: RefundStatus = /^done/i.test(get(cStatus)) ? 'done'
			: colour ?? (/no\s*refund/i.test(reason) ? 'no_refund' : reason ? 'to_refund' : 'needs_check');
		for (const order_no of orders) out.push({ sheet_row: line, order_no, reason, via, refund_to, status });
	});
	return { rows: out, skipped };
}
