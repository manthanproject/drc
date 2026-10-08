// Phase 6 money check: read the Velocity passbook download, sort each line into a category, suggest which claim a
// "financial note for lost Shipment" credit belongs to, and sum charges per month. Pure, tested on the real file.

export type LedgerCategory = 'shipping' | 'cod' | 'rto' | 'weight' | 'reversal' | 'recharge' | 'claim_credit' | 'other';

export interface LedgerRow {
	at: string; // ISO with +05:30 (the passbook is in IST)
	type: 'credit' | 'debit';
	amount: string; // two decimals
	balance: string;
	awb: string;
	notes: string;
	category: LedgerCategory;
}

export interface Parsed {
	rows: LedgerRow[];
	skipped: { line: number; why: string }[];
	from: string | null;
	to: string | null;
}

/** Minimal RFC-4180 CSV: quotes, doubled quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
	const out: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let q = false;
	const s = text.replace(/^﻿/, '');
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (q) {
			if (ch === '"') {
				if (s[i + 1] === '"') { cell += '"'; i++; }
				else q = false;
			} else cell += ch;
		} else if (ch === '"') q = true;
		else if (ch === ',') { row.push(cell); cell = ''; }
		else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && s[i + 1] === '\n') i++;
			row.push(cell); cell = '';
			if (row.some((c) => c.trim() !== '')) out.push(row);
			row = [];
		} else cell += ch;
	}
	row.push(cell);
	if (row.some((c) => c.trim() !== '')) out.push(row);
	return out;
}

/** What a passbook line is, from Velocity's Notes / Description. */
export function categoryOf(notes: string, type: 'credit' | 'debit'): LedgerCategory {
	const n = notes.toLowerCase();
	if (/financial note|lost shipment|lost credit|damaged credit/.test(n) && type === 'credit') return 'claim_credit';
	if (/revers/.test(n)) return 'reversal';
	if (/weight discrepancy/.test(n)) return 'weight';
	if (/recharge/.test(n)) return 'recharge';
	if (/\brto\b/.test(n)) return 'rto';
	if (/\bcod\b/.test(n)) return 'cod';
	if (/shipping|freight/.test(n)) return 'shipping';
	return 'other';
}

const HEADERS: Record<keyof Omit<LedgerRow, 'category'>, RegExp> = {
	type: /^(transaction type|credit ?\/ ?debit|type)$/i,
	amount: /^amount/i,
	balance: /^(closing )?balance/i,
	awb: /^(tracking number|awb|awb code)$/i,
	notes: /^(notes|description( ?\/ ?remarks)?|remarks)$/i,
	at: /^(created at|date|transaction date)$/i
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number | string) => String(n).padStart(2, '0');

/** '2026-10-08 12:26:20' | '08 Oct 26 | 01:03 PM' | '08-10-2026 12:26' → '2026-10-08T12:26:20+05:30' (IST). */
export function istIso(v: string): string | null {
	const s = v.trim();
	let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
	if (m) return `${m[1]}-${m[2]}-${m[3]}T${pad(m[4])}:${m[5]}:${m[6] ?? '00'}+05:30`;
	m = s.match(/^(\d{1,2}) ([A-Za-z]{3})\w* (\d{2,4})\s*\|?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
	if (m) {
		const mon = MONTHS.indexOf(m[2].toLowerCase()) + 1;
		if (!mon) return null;
		let h = Number(m[4]);
		if (m[6]) h = (h % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
		const y = m[3].length === 2 ? `20${m[3]}` : m[3];
		return `${y}-${pad(mon)}-${pad(m[1])}T${pad(h)}:${m[5]}:00+05:30`;
	}
	m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
	if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${m[5]}:${m[6] ?? '00'}+05:30`;
	return null;
}

const money = (v: string) => {
	const n = Number(String(v).replace(/[₹,\s]/g, ''));
	return Number.isFinite(n) ? n.toFixed(2) : null;
};

/** The Velocity passbook download (Payments → Passbook → ⬇). Unknown columns are ignored; bad lines are listed, not guessed. */
export function parsePassbook(text: string): Parsed {
	const table = parseCsv(text);
	if (!table.length) return { rows: [], skipped: [{ line: 1, why: 'empty file' }], from: null, to: null };
	const head = table[0].map((h) => h.trim());
	const col = {} as Record<keyof typeof HEADERS, number>;
	for (const k of Object.keys(HEADERS) as (keyof typeof HEADERS)[]) col[k] = head.findIndex((h) => HEADERS[k].test(h));
	const missing = (['type', 'amount', 'at'] as const).filter((k) => col[k] < 0);
	if (missing.length) return { rows: [], skipped: [{ line: 1, why: `not a Velocity passbook: no ${missing.join(', ')} column` }], from: null, to: null };

	const rows: LedgerRow[] = [];
	const skipped: Parsed['skipped'] = [];
	table.slice(1).forEach((r, i) => {
		const get = (k: keyof typeof HEADERS) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
		const t = get('type').toLowerCase();
		const type = t.startsWith('cr') ? 'credit' : t.startsWith('de') ? 'debit' : null;
		const amount = money(get('amount'));
		const at = istIso(get('at'));
		if (!type || amount === null || !at) {
			skipped.push({ line: i + 2, why: !type ? `type "${get('type')}"` : amount === null ? `amount "${get('amount')}"` : `date "${get('at')}"` });
			return;
		}
		const awbRaw = get('awb');
		const awb = /^(n\/?a|-|null|none)$/i.test(awbRaw) ? '' : awbRaw;
		const notes = get('notes');
		rows.push({ at, type, amount, balance: money(get('balance')) ?? '', awb, notes, category: categoryOf(notes, type) });
	});
	const ats = rows.map((r) => r.at).sort();
	return { rows, skipped, from: ats[0] ?? null, to: ats.at(-1) ?? null };
}

// ---------- matching claim money to claims ----------

export interface MatchClaim {
	id: string;
	rto_id: string;
	status: string;
	reason: string;
	claimed_amount: number | string | null;
	expected_amount?: number | string | null;
	approved_amount?: number | string | null;
}
export interface MatchRto {
	id: string;
	order_no: string | null;
	order_value: number | string | null;
	forward_awb: string | null;
}
export interface Suggestion {
	kind: 'claim' | 'order';
	claimId: string | null;
	rtoId: string;
	order: string;
	why: string;
	score: number; // lower = better
}

const num = (v: unknown) => {
	const n = Number(v ?? NaN);
	return Number.isFinite(n) ? n : null;
};
const close = (a: number | null, b: number, tol = 1) => a !== null && Math.abs(a - b) <= tol;
const OPEN = new Set(['raised', 'waiting', 'escalated', 'approved', 'rejected']);
const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)}`;

/**
 * Which open claim a credit of this amount most likely pays: approved / expected / claimed amount within ₹1
 * (Velocity paid ₹4,999.99 against a ₹5,000 cap), then the ₹2,500 / ₹5,000 caps on the order value.
 * Orders with NO open claim whose value matches are listed too: money for a parcel we may have got back.
 */
export function suggestFor(amount: number, claims: MatchClaim[], rtos: MatchRto[], caps: number[] = [2500, 5000]): Suggestion[] {
	const byId = new Map(rtos.map((r) => [r.id, r]));
	const label = (r: MatchRto) => (/^\d+(-\d+)*$/.test(String(r.order_no ?? '')) ? `#${r.order_no}` : String(r.order_no ?? r.forward_awb ?? '?'));
	const out: Suggestion[] = [];
	const claimed = new Set<string>();
	for (const c of claims) {
		if (!OPEN.has(c.status)) continue;
		const r = byId.get(c.rto_id);
		if (!r) continue;
		claimed.add(r.id);
		const value = num(r.order_value);
		const tests: [number | null, string, number][] = [
			[num(c.approved_amount), 'approved amount', 0],
			[num(c.expected_amount), 'expected amount', 1],
			[num(c.claimed_amount), 'claimed amount', 2],
			[value, 'order value', 3],
			...caps.map((cap) => [value !== null && value > cap ? cap : null, `cap`, 4] as [number | null, string, number])
		];
		const hit = tests.find(([v]) => close(v, amount));
		if (hit) out.push({ kind: 'claim', claimId: c.id, rtoId: r.id, order: label(r), score: hit[2],
			why: hit[1] === 'cap' ? `${inr(hit[0]!)} cap (order ${inr(value!)})` : `${hit[1]} ${inr(hit[0]!)}` });
	}
	for (const r of rtos) {
		if (claimed.has(r.id)) continue;
		if (close(num(r.order_value), amount, 0.5)) out.push({ kind: 'order', claimId: null, rtoId: r.id, order: label(r), why: `order value ${inr(num(r.order_value)!)}, no open claim`, score: 9 });
	}
	return out.sort((a, b) => a.score - b.score).slice(0, 6);
}

// ---------- charges per month ----------

export interface MonthlyRow {
	source: string;
	month: string; // YYYY-MM
	category: LedgerCategory;
	txn_type: 'credit' | 'debit';
	n: number;
	amount: number | string;
}
export interface MonthSummary {
	month: string;
	shipping: number;
	cod: number;
	rto: number;
	rtoCount: number;
	weight: number;
	weightCount: number;
	reversed: number;
	claimMoney: number;
	/** what shipping actually cost: charges minus reversals */
	net: number;
}

export function monthly(rows: MonthlyRow[]): MonthSummary[] {
	const by = new Map<string, MonthSummary>();
	for (const r of rows) {
		const m = by.get(r.month) ?? { month: r.month, shipping: 0, cod: 0, rto: 0, rtoCount: 0, weight: 0, weightCount: 0, reversed: 0, claimMoney: 0, net: 0 };
		const a = Number(r.amount) || 0;
		if (r.txn_type === 'debit') {
			if (r.category === 'shipping') m.shipping += a;
			else if (r.category === 'cod') m.cod += a;
			else if (r.category === 'rto') { m.rto += a; m.rtoCount += r.n; }
			else if (r.category === 'weight') { m.weight += a; m.weightCount += r.n; }
		} else if (r.category === 'reversal') m.reversed += a;
		else if (r.category === 'claim_credit') m.claimMoney += a;
		by.set(r.month, m);
	}
	for (const m of by.values()) m.net = m.shipping + m.cod + m.rto + m.weight - m.reversed;
	return [...by.values()].sort((a, b) => b.month.localeCompare(a.month));
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** ₹ with paise only when there are any: ₹4,999.99, ₹1,728. */
export const rupees = (n: number) => inr(Math.round(n * 100) / 100);

export const monthLabel = (ym: string) => `${MONTH_NAMES.at(Number(ym.slice(5, 7)) - 1) ?? ym} ${ym.slice(0, 4)}`;
