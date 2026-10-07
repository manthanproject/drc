// Ready Stock (Phase 3e): returned products that can be sold again, re-use one unit at a time,
// money still owed to customers, and the rows for the "DRC Ready Stock" sheet tab. Pure, tested.
import { num, orderLabel, dateShort, type Rto } from './dashboard.ts';
import { isDummyItem } from './claims.ts';
import { asinOf } from './products.ts';

export interface StockItem {
	id: string;
	rto_id: string;
	sku: string | null;
	title: string;
	qty: number;
	is_gift: boolean;
	condition: string;
	ready_stock_state: 'na' | 'in_stock' | 'reused';
	ready_stock_at: string | null;
	reused_qty: number;
	reused_orders: string[] | null;
}

export type StockRto = Pick<Rto, 'id' | 'order_no' | 'stage' | 'payment_mode' | 'order_value' | 'customer_name' | 'forward_awb' | 'legacy_source'> & {
	amount_collected?: number | string | null;
	refund_state?: string | null;
};

export interface StockRow {
	item: StockItem;
	rtoId: string;
	order: string;
	left: number;
	added: string | null;
}
export interface MoneyRow {
	rtoId: string;
	order: string;
	customer: string | null;
	amount: number;
	kind: 'refund' | 'credit';
}
export interface Stock {
	inStock: StockRow[];
	reused: StockRow[];
	money: MoneyRow[];
	/** Ready Stock orders with no item list (old sheet rows): shown as a count, can't be listed by product. */
	noItems: number;
	units: number;
}

const BAD = new Set(['wrong', 'damaged', 'missing', 'leak', 'empty', 'near_expiry']);

export function buildStock(items: StockItem[], rtos: StockRto[]): Stock {
	const byId = new Map(rtos.map((r) => [r.id, r]));
	const inStock: StockRow[] = [];
	const reused: StockRow[] = [];
	const withItems = new Set<string>();
	for (const it of items) {
		const r = byId.get(it.rto_id);
		if (!r || isDummyItem(it)) continue;
		withItems.add(r.id);
		const row = { item: it, rtoId: r.id, order: orderLabel(r as Rto), left: it.qty - (it.reused_qty ?? 0), added: it.ready_stock_at };
		// sent back out as a re-ship → not stock any more; claimed items are not sellable
		if (it.ready_stock_state === 'in_stock' && row.left > 0 && !BAD.has(it.condition) && r.stage !== 'reship') inStock.push(row);
		if ((it.reused_qty ?? 0) > 0) reused.push(row);
	}
	const money: MoneyRow[] = rtos
		.filter((r) => r.refund_state === 'due' || r.refund_state === 'credit_due')
		.map((r) => ({
			rtoId: r.id,
			order: orderLabel(r as Rto),
			customer: r.customer_name,
			amount: r.payment_mode === 'partial' ? num(r.amount_collected) : num(r.order_value),
			kind: r.refund_state === 'due' ? ('refund' as const) : ('credit' as const)
		}))
		.sort((a, b) => b.amount - a.amount);
	const byAdded = (a: StockRow, b: StockRow) => String(b.added ?? '').localeCompare(String(a.added ?? ''));
	inStock.sort(byAdded);
	reused.sort(byAdded);
	return {
		inStock,
		reused,
		money,
		noItems: rtos.filter((r) => r.stage === 'ready_stock' && !withItems.has(r.id)).length,
		units: inStock.reduce((s, x) => s + x.left, 0)
	};
}

/** Search box: product name, SKU/ASIN, order no. */
export function matchStock(row: StockRow, q: string): boolean {
	const s = q.trim().toLowerCase().replace(/^#?(dropy-)?/, '');
	if (!s) return true;
	return [row.item.title, row.item.sku ?? '', row.order.replace('#', '')].some((v) => v.toLowerCase().includes(s));
}

// ---------- "DRC Ready Stock" sheet tab ----------
export const SHEET_TAB = 'DRC Ready Stock';
export const SHEET_HEADER = ['Added', 'Order', 'Product', 'ASIN / SKU', 'Qty', 'Re-used', 'In stock', 'Gift', 'Status', 'Re-used in orders', 'Money', 'Updated'];

const MONEY_WORD: Record<string, string> = { due: 'Refund due', credit_due: 'Store credit due', done: 'Refunded', credit_done: 'Store credit given' };
/** Text cells only (never formulas): leading = + - @ get a quote, like the scan-log CSV. */
const cell = (v: unknown) => {
	const s = String(v ?? '');
	return /^[=+\-@]/.test(s) ? `'${s}` : s;
};

export function sheetRows(items: StockItem[], rtos: StockRto[], now: number): string[][] {
	const byId = new Map(rtos.map((r) => [r.id, r]));
	const updated = `${dateShort(new Date(now).toISOString())} ${new Date(now + 5.5 * 3_600_000).toISOString().slice(11, 16)}`;
	const rows = items
		.filter((it) => !isDummyItem(it) && byId.has(it.rto_id) && (it.ready_stock_state !== 'na' || (it.reused_qty ?? 0) > 0) && !BAD.has(it.condition))
		.map((it) => {
			const r = byId.get(it.rto_id)!;
			const used = it.reused_qty ?? 0;
			const left = it.qty - used;
			const status = r.stage === 'reship' ? 'Sent back to customer' : left <= 0 ? 'Re-used' : used > 0 ? 'Partly re-used' : 'In stock';
			return {
				at: it.ready_stock_at ?? '',
				cells: [
					dateShort(it.ready_stock_at), orderLabel(r as Rto), it.title, asinOf(it.sku) ?? it.sku ?? '', String(it.qty), String(used),
					String(Math.max(left, 0)), it.is_gift ? 'Gift' : '', status, (it.reused_orders ?? []).map((o) => `#${o}`).join(', '),
					MONEY_WORD[r.refund_state ?? ''] ?? '', updated
				].map(cell)
			};
		})
		.sort((a, b) => b.at.localeCompare(a.at));
	return [SHEET_HEADER, ...rows.map((r) => r.cells)];
}
