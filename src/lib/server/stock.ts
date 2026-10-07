import { error } from '@sveltejs/kit';
import { db } from './supabase.ts';
import { allRtos } from './rto-data.ts';
import { fail, UUID } from './actions.ts';
import { buildStock, type StockItem, type StockRto } from '#lib/stock.ts';

const ITEM_COLS = 'id, rto_id, sku, title, qty, is_gift, condition, ready_stock_state, ready_stock_at, reused_qty, reused_orders';

/** Every item that is or was Ready Stock (in stock, partly or fully re-used). */
export async function stockItems(): Promise<StockItem[]> {
	const out: StockItem[] = [];
	for (let from = 0; ; from += 1000) {
		const { data, error: e } = await db().from('rto_items').select(ITEM_COLS).in('ready_stock_state', ['in_stock', 'reused']).order('id').range(from, from + 999);
		if (e) throw new Error(`rto_items: ${e.message}`);
		out.push(...((data ?? []) as StockItem[]));
		if (!data || data.length < 1000) return out;
	}
}

export async function loadStock() {
	const [items, rtos] = await Promise.all([stockItems(), allRtos()]);
	const stock = buildStock(items, rtos as StockRto[]);
	return { stock, now: Date.now() };
}

/** 'reuse' {item_id, order_no?} (one unit) or 'money_done' {rto_id}. Both undoable for 10 minutes. */
export async function stockAction(raw: unknown) {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	let args: Record<string, string>;
	if (b.action === 'reuse') {
		if (typeof b.item_id !== 'string' || !/^[\w-]{1,64}$/.test(b.item_id)) error(400, 'Bad item');
		args = { item_id: b.item_id };
		if (typeof b.order_no === 'string' && b.order_no.trim()) args.order_no = b.order_no.trim().slice(0, 40);
	} else if (b.action === 'money_done') {
		if (typeof b.rto_id !== 'string' || !UUID.test(b.rto_id)) error(400, 'Bad RTO id');
		args = { rto_id: b.rto_id };
	} else error(400, 'Unknown action');
	const { data, error: e } = await db().rpc('stock_action', { p_action: b.action, p_args: args });
	if (e) fail(e.message);
	return data as { event_id: number; left?: number; refund_state?: string };
}
