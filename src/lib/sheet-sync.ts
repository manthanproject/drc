// Sheet ↔ DRC (pure, tested). Keeps the "Return Orders" tab of Dropy Return Orders and DRC in step, both ways.
//  • DRC → sheet: a parcel DRC has received (or claimed) whose order is not in the sheet gets a new row; a status
//    changed in DRC is written into the row's "RTO - Status" cell when nobody changed that cell since the last sync.
//  • Sheet → DRC: a row typed in the sheet for an order DRC still shows as not received marks that parcel received.
//  • Both changed (or they disagree on the first run): listed for a person to decide. Never decided automatically.
// "Last synced" (the baseline) is what both sides said at the previous sync, so DRC can tell who changed what.

import { isDummyItem } from './claims.ts';

export const TAB = 'Return Orders';

// 'reshipped' = the sheet says it was already sent again (done), unlike 'reship' = still to be re-delivered
export type SheetStage = 'claim' | 'ready_stock' | 'reship' | 'reshipped' | 'to_call' | 'store_credit' | 'hold' | 'closed' | 'skip';

export interface SheetRow {
	row: number; // 1-based row number in the tab
	date: string;
	orderCell: string;
	items: string;
	sku: string;
	rtoStatus: string;
	status: string;
	redelivery: string;
	orders: string[];
}

export interface Cols {
	date: number;
	order: number;
	items: number;
	sku: number;
	rtoStatus: number;
	status: number;
	redelivery: number;
	width: number;
}

const HEADERS: Record<Exclude<keyof Cols, 'width'>, RegExp> = {
	date: /^date$/,
	order: /^order\s*id$/,
	items: /^i(te|t)a?ms?$|^iteams$/,
	sku: /^sku$/,
	rtoStatus: /^rto\s*-?\s*status$/,
	status: /^status$/,
	redelivery: /^re\s*-?\s*delivery/
};

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Column positions from the header row. Order ID and RTO - Status must exist. */
export function findCols(header: unknown[]): Cols {
	const h = header.map((x) => clean(x).toLowerCase());
	const at = (re: RegExp) => h.findIndex((x) => re.test(x));
	const c = {
		date: at(HEADERS.date),
		order: at(HEADERS.order),
		items: at(HEADERS.items),
		sku: at(HEADERS.sku),
		rtoStatus: at(HEADERS.rtoStatus),
		status: at(HEADERS.status),
		redelivery: at(HEADERS.redelivery),
		width: h.length
	};
	if (c.order < 0 || c.rtoStatus < 0) throw new Error(`"${TAB}" tab: Order ID / RTO - Status columns not found in the first row`);
	return c;
}

/** Order numbers in a cell: "Dropy-4915", "#Dropy-1381-1", "Dropy-1093, 1073", "dropy 2502-ALL". */
export function parseOrders(cell: string): string[] {
	const out: string[] = [];
	for (const raw of clean(cell).split(/[,&/;\n|]|\band\b/i)) {
		let t = raw.trim().replace(/^#/, '').replace(/^dropy[\s-]*/i, '').replace(/[\s.]+$/, '');
		t = t.replace(/-(all|[a-z])$/i, '');
		if (/^\d{3,6}(-\d{1,2})?$/.test(t) && !out.includes(t)) out.push(t);
	}
	return out;
}

export function parseSheet(values: unknown[][]): { cols: Cols; rows: SheetRow[]; lastRow: number } {
	if (!values.length) throw new Error(`"${TAB}" tab is empty`);
	const cols = findCols(values[0]);
	const get = (r: unknown[], i: number) => (i >= 0 ? clean(r[i]) : '');
	const rows: SheetRow[] = [];
	values.slice(1).forEach((r, i) => {
		const orderCell = get(r, cols.order);
		const rtoStatus = get(r, cols.rtoStatus);
		if (!orderCell && !rtoStatus && !get(r, cols.items)) return; // blank line
		rows.push({
			row: i + 2,
			date: get(r, cols.date),
			orderCell,
			items: get(r, cols.items),
			sku: get(r, cols.sku),
			rtoStatus,
			status: get(r, cols.status),
			redelivery: get(r, cols.redelivery),
			orders: parseOrders(orderCell)
		});
	});
	// the last row with anything in it (new rows go right below it, never into a gap higher up)
	let lastRow = values.length;
	while (lastRow > 1 && !(values[lastRow - 1] ?? []).some((c) => clean(c))) lastRow--;
	return { cols, rows, lastRow };
}

/** The sheet's words → a DRC status (same rules as the 4 Oct import). */
export function stageFor(rtoStatus: string, status = '', items = ''): SheetStage {
	const t = rtoStatus.toLowerCase().replace(/[’‘`]/g, "'").trim();
	// a cell DRC wrote ("Ready stock — didn't pick") reads as DRC's own word, whatever note follows it
	if (/claim/.test(status.toLowerCase()) || /rto claim/.test(items.toLowerCase())) return 'claim';
	const own = t.match(/^(call customer|re-deliver|ready stock|store credit|hold|claim|all received)\b/);
	if (own) return ({ 'call customer': 'to_call', 're-deliver': 'reship', 'ready stock': 'ready_stock', 'store credit': 'store_credit', hold: 'hold', claim: 'claim', 'all received': 'closed' } as const)[own[1] as 'hold'];
	if (/claim|dispute/.test(t)) return 'claim';
	if (/rto in transit/.test(t)) return 'skip';
	if (/re-?shipped|re-?dispatched|done re-?ship|sent again|dispatched again/.test(t)) return 'reshipped';
	if (/\bstar\b|★|ready stock|(doesn'?t|don'?t|didn'?t|do not|does not|not) (want|need)|didn'?t (place|order)|not (placed|ordered)|refus|cancel|by mistake|again placed/.test(t)) return 'ready_stock';
	if (/pick ?up/.test(t)) return 'reship';
	if (/call|\bpick|busy|voice|talk to|back later|switch(ed)? off/.test(t)) return 'to_call';
	if (/store credit/.test(t)) return 'store_credit';
	if (/hold|admin pending|expiry/.test(t)) return 'hold';
	if (/deliver|dispatch|re-?ship|wants|address update/.test(t)) return 'reship';
	return 'closed';
}

/** The cell DRC writes: its status first, then the team's own note kept (without an older DRC status in front). */
export function drcCell(stage: string, reshipDate: string | null | undefined, old: string): string {
	const label = drcLabel(stage, reshipDate);
	const rest = clean(old).replace(/^(call customer|re-deliver(\s+\d{1,2}\s+[a-z]{3})?|ready stock|store credit|hold|claim|all received|received)\s*(—|-)?\s*/i, '').trim();
	return rest && rest.toLowerCase() !== label.toLowerCase() ? `${label} — ${rest}` : label;
}

/** What DRC writes in "RTO - Status" (each reads back to the same status with stageFor). */
export function drcLabel(stage: string, reshipDate?: string | null): string {
	switch (stage) {
		case 'to_call':
			return 'Call customer';
		case 'reship':
			return reshipDate ? `Re-deliver ${dayMonth(reshipDate)}` : 'Re-deliver';
		case 'ready_stock':
			return 'Ready stock';
		case 'store_credit':
			return 'Store credit';
		case 'hold':
			return 'Hold';
		case 'claim':
			return 'Claim';
		case 'closed':
			return 'All received';
		default:
			return 'Received';
	}
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayMonth(day: string): string {
	const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
	return Number.isNaN(d.getTime()) ? day : `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** 'dd/mm/yyyy' for a new row's Date cell. */
export function sheetDate(day: string): string {
	const [y, m, d] = day.slice(0, 10).split('-');
	return `${d}/${m}/${y}`;
}

/** A sheet Date cell → 'YYYY-MM-DD' (dd/mm/yyyy, d-m-yy, yyyy-mm-dd, "12 Oct 2026", "12 Oct"), else null. */
export function parseSheetDate(v: string, now: number): string | null {
	const s = clean(v);
	if (!s) return null;
	const thisYear = new Date(now).getUTCFullYear();
	const iso = (y: number, m: number, d: number) => {
		if (y < 100) y += 2000;
		const dt = new Date(Date.UTC(y, m - 1, d));
		return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
	};
	let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
	if (m) return iso(+m[1], +m[2], +m[3]);
	m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
	if (m) return iso(+m[3], +m[2], +m[1]);
	m = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s,-]*(\d{2,4})?$/i);
	if (m) {
		const mo = MON.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
		if (mo >= 0) return iso(m[3] ? +m[3] : thisYear, mo + 1, +m[1]);
	}
	return null;
}

// ---- the comparison ------------------------------------------------------------------------------------------

export const COURIER_STAGES = new Set(['in_flight', 'delayed', 'lost', 'awaiting_receipt']);
const TRANSIENT = new Set(['scanned', 'inspected']);

export interface DrcRto {
	id: string;
	order_no: string | null;
	kind?: string | null;
	stage: string;
	payment_mode?: string | null;
	scanned_at?: string | null;
	received_on?: string | null;
	reship_date?: string | null;
	legacy_source?: string | null;
	rto_delivered_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	items?: { title: string | null; sku: string | null; qty: number | null }[];
}

export interface Baseline {
	order_no: string;
	sheet_text: string;
	drc_stage: string;
	state: 'ok' | 'ignored';
}

export const sheetText = (r: Pick<SheetRow, 'rtoStatus' | 'status'>) => `${clean(r.rtoStatus)}|${clean(r.status)}`.toLowerCase();

/** Do the sheet words and the DRC status mean the same thing? */
export function same(sheet: SheetStage, drcStage: string): boolean {
	if (TRANSIENT.has(drcStage)) return true; // scanned, not decided yet: anything the sheet says is fine
	if (sheet === drcStage) return true;
	if (sheet === 'reshipped') return drcStage === 'closed' || drcStage === 'reship'; // sent again = done
	if (sheet === 'to_call' && drcStage === 'hold') return true; // DRC moves "no answer" calls to Hold
	return sheet === 'store_credit' && drcStage === 'ready_stock';
}

export type Receive = { action: 'close' | 'received_call' | 'hold' | 'ready_stock'; args: { money?: 'credit'; note: string } };

/** A sheet row for a parcel DRC shows as not received → the DRC change that marks it received. */
export function receiveAction(stage: SheetStage, paymentMode: string | null | undefined, words: string): Receive {
	const prepaid = paymentMode === 'prepaid' || paymentMode === 'partial';
	const note = (extra = '') => `From sheet: "${words || 'no status'}"${extra}`;
	switch (stage) {
		case 'closed':
			return { action: 'close', args: { note: note() } };
		case 'reshipped':
			return { action: 'close', args: { note: note('. Already re-shipped') } };
		case 'to_call':
			return { action: 'received_call', args: { note: note() } };
		case 'ready_stock':
			return prepaid ? { action: 'hold', args: { note: note('. Prepaid: open it and pick Refund or Store credit') } } : { action: 'ready_stock', args: { note: note() } };
		case 'store_credit':
			return prepaid ? { action: 'ready_stock', args: { money: 'credit', note: note() } } : { action: 'hold', args: { note: note('. COD order: decide what to do') } };
		case 'reship':
			return { action: 'hold', args: { note: note('. Set the re-ship date in DRC') } };
		case 'claim':
			return { action: 'hold', args: { note: note('. Raise the claim in DRC with the media') } };
		default:
			return { action: 'hold', args: { note: note() } };
	}
}

export type Plan = {
	same: { order: string; row: number; stage: string }[];
	receive: { order: string; row: number; rtoId: string; stage: SheetStage; words: string; date: string | null; act: Receive }[];
	append: { order: string; rtoId: string; stage: string; day: string; items: string; values: string[] }[];
	write: { order: string; row: number; rtoId: string; stage: string; from: string; to: string; col: number }[];
	decide: { order: string; row: number; rtoId: string; words: string; status: string; items: string; sheetStage: SheetStage; drcStage: string; why: string }[];
	onlySheet: { order: string; row: number; words: string; stage: SheetStage; date: string | null }[];
	unreadable: { row: number; cell: string; why: string }[];
	baseline: Baseline[]; // baseline rows to save for orders that are now in step (written after the actions)
};

const isTracked = (r: DrcRto) => r.kind !== 'customer_return' && !COURIER_STAGES.has(r.stage) && r.stage !== 'unknown_parcel';

const newest = (rs: DrcRto[]) =>
	[...rs].sort((a, b) => (b.scanned_at ?? b.updated_at ?? b.created_at ?? '').localeCompare(a.scanned_at ?? a.updated_at ?? a.created_at ?? ''))[0];
const oldestWaiting = (rs: DrcRto[]) =>
	[...rs].sort((a, b) => (a.rto_delivered_at ?? a.created_at ?? '').localeCompare(b.rto_delivered_at ?? b.created_at ?? ''))[0];

export function compare(sheet: { cols: Cols; rows: SheetRow[]; lastRow?: number }, rtos: DrcRto[], baselines: Baseline[], now: number, istDay: (iso: string) => string): Plan {
	const plan: Plan = { same: [], receive: [], append: [], write: [], decide: [], onlySheet: [], unreadable: [], baseline: [] };
	const byOrder = new Map<string, DrcRto[]>();
	for (const r of rtos) if (r.order_no) byOrder.set(r.order_no, [...(byOrder.get(r.order_no) ?? []), r]);
	const base = new Map(baselines.map((b) => [b.order_no, b]));

	// every order the sheet mentions anywhere (so a "Dropy-1093, 1073" row still counts as present for both)
	const mentioned = new Set<string>();
	const lastRow = new Map<string, SheetRow>();
	for (const s of sheet.rows) {
		for (const o of s.orders) mentioned.add(o);
		if (s.orders.length === 1) lastRow.set(s.orders[0], s); // duplicates: the lowest row is the latest
		else if (s.orders.length === 0) plan.unreadable.push({ row: s.row, cell: s.orderCell, why: s.orderCell ? 'Order number not recognised' : 'No order number' });
		else plan.unreadable.push({ row: s.row, cell: s.orderCell, why: 'Several orders in one cell' });
	}

	for (const [order, s] of lastRow) {
		const mapped = stageFor(s.rtoStatus, s.status, s.items);
		const text = sheetText(s);
		const all = (byOrder.get(order) ?? []).filter((r) => r.kind !== 'customer_return');
		const b = base.get(order);
		if (!all.length) {
			if ((byOrder.get(order) ?? []).length) continue; // a customer return only: nothing to sync
			if (mapped !== 'skip') plan.onlySheet.push({ order, row: s.row, words: s.rtoStatus, stage: mapped, date: parseSheetDate(s.date, now) });
			continue;
		}
		const tracked = all.filter(isTracked);
		if (!tracked.length) {
			if (mapped === 'skip') continue;
			const waiting = all.filter((r) => COURIER_STAGES.has(r.stage));
			if (!waiting.length) continue;
			// DRC was received before and has since gone back (Mark not arrived / Clear scan) while the sheet row
			// stayed the same: a person decides
			if (b && b.sheet_text === text && !COURIER_STAGES.has(b.drc_stage)) {
				const r = waiting[0];
				if (b.state !== 'ignored' || b.drc_stage !== r.stage)
					plan.decide.push({ order, row: s.row, rtoId: r.id, words: s.rtoStatus, status: s.status, items: s.items, sheetStage: mapped, drcStage: r.stage, why: 'DRC now says not received; the sheet still has the row' });
				continue;
			}
			const r = oldestWaiting(waiting);
			plan.receive.push({ order, row: s.row, rtoId: r.id, stage: mapped, words: s.rtoStatus, date: parseSheetDate(s.date, now), act: receiveAction(mapped, r.payment_mode, s.rtoStatus) });
			continue;
		}
		const r = newest(tracked);
		const ok = mapped === 'skip' || same(mapped, r.stage);
		if (b) {
			const sheetChanged = b.sheet_text !== text;
			const drcChanged = b.drc_stage !== r.stage;
			if (!sheetChanged && !drcChanged) {
				plan.same.push({ order, row: s.row, stage: r.stage });
				continue;
			}
			if (ok) {
				plan.same.push({ order, row: s.row, stage: r.stage });
				plan.baseline.push({ order_no: order, sheet_text: text, drc_stage: r.stage, state: 'ok' });
				continue;
			}
			if (drcChanged && !sheetChanged) {
				plan.write.push({ order, row: s.row, rtoId: r.id, stage: r.stage, from: s.rtoStatus, to: drcCell(r.stage, r.reship_date, s.rtoStatus), col: sheet.cols.rtoStatus });
				continue;
			}
			plan.decide.push({ order, row: s.row, rtoId: r.id, words: s.rtoStatus, status: s.status, items: s.items, sheetStage: mapped, drcStage: r.stage, why: drcChanged ? 'Changed in both since the last sync' : 'The sheet was changed' });
			continue;
		}
		if (ok) {
			plan.same.push({ order, row: s.row, stage: r.stage });
			plan.baseline.push({ order_no: order, sheet_text: text, drc_stage: r.stage, state: 'ok' });
		} else plan.decide.push({ order, row: s.row, rtoId: r.id, words: s.rtoStatus, status: s.status, items: s.items, sheetStage: mapped, drcStage: r.stage, why: 'Different on the first check' });
	}

	// DRC → sheet: received / claimed parcels whose order the sheet does not mention at all
	for (const [order, rs] of byOrder) {
		if (mentioned.has(order)) continue;
		const tracked = rs.filter((r) => isTracked(r) && r.legacy_source !== 'sheet');
		if (!tracked.length) continue;
		const r = newest(tracked);
		const day = r.received_on ?? istDay(r.scanned_at ?? r.rto_delivered_at ?? new Date(now).toISOString());
		const items = (r.items ?? []).filter((i) => i.title && !isDummyItem(i)); // not the "Pay on Delivery" fee line
		const values = new Array(sheet.cols.width).fill('');
		const put = (i: number, v: string) => {
			if (i >= 0) values[i] = v;
		};
		put(sheet.cols.date, sheetDate(day));
		put(sheet.cols.order, `Dropy-${order}`);
		put(sheet.cols.items, items.map((i) => `${i.title}${(i.qty ?? 1) > 1 ? ` ×${i.qty}` : ''}`).join('; '));
		put(sheet.cols.sku, [...new Set(items.map((i) => i.sku).filter(Boolean))].join(', '));
		put(sheet.cols.rtoStatus, drcLabel(r.stage, r.reship_date));
		put(sheet.cols.status, 'DRC');
		plan.append.push({ order, rtoId: r.id, stage: r.stage, day, items: values[sheet.cols.items] ?? '', values });
	}
	return plan;
}

/** Counts for the page and the run log. */
export function planCounts(p: Plan) {
	return { same: p.same.length, receive: p.receive.length, append: p.append.length, write: p.write.length, decide: p.decide.length, onlySheet: p.onlySheet.length, unreadable: p.unreadable.length };
}

/** 'A'..'Z', 'AA'.. for a 0-based column. */
export function colLetter(i: number): string {
	let s = '';
	for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
	return s;
}
