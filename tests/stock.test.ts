import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStock, matchStock, sheetRows, SHEET_HEADER, type StockItem, type StockRto } from '../src/lib/stock.ts';

const rto = (id: string, p: Partial<StockRto> = {}): StockRto => ({ id, order_no: id, stage: 'ready_stock', payment_mode: 'cod', order_value: 1000, customer_name: 'A', forward_awb: `A${id}`, legacy_source: null, refund_state: 'na', ...p });
const item = (id: string, rto_id: string, p: Partial<StockItem> = {}): StockItem => ({ id, rto_id, sku: 'Dropy-B0CWJSFYWT', title: `Item ${id}`, qty: 1, is_gift: false, condition: 'ok', ready_stock_state: 'in_stock', ready_stock_at: '2026-10-06T05:00:00Z', reused_qty: 0, reused_orders: [], ...p });

test('in stock / re-used / money; claimed, re-shipped and dummy lines left out', () => {
	const rtos = [
		rto('1'),
		rto('2', { payment_mode: 'prepaid', order_value: 2500, refund_state: 'due' }),
		rto('3', { payment_mode: 'partial', order_value: 3000, amount_collected: 780, refund_state: 'credit_due', stage: 'claim' }),
		rto('4', { stage: 'reship' }),
		rto('5') // old sheet row, no items
	];
	const items = [
		item('a', '1', { qty: 3, reused_qty: 1, reused_orders: ['5123'] }),
		item('b', '2', { ready_stock_at: '2026-10-07T05:00:00Z' }),
		item('c', '3', { condition: 'wrong' }),          // claimed → not stock
		item('d', '3', { condition: 'ok' }),             // untouched item from a claim → stock
		item('e', '4'),                                  // re-shipped → not stock
		item('f', '1', { sku: null, title: 'Pay on Delivery' }),
		item('g', '1', { qty: 1, reused_qty: 1, ready_stock_state: 'reused' })
	];
	const s = buildStock(items, rtos);
	assert.deepEqual(s.inStock.map((r) => [r.item.id, r.left]), [['b', 1], ['a', 2], ['d', 1]]);
	assert.deepEqual(s.reused.map((r) => r.item.id).sort(), ['a', 'g']);
	assert.deepEqual(s.money.map((m) => [m.order, m.amount, m.kind]), [['#2', 2500, 'refund'], ['#3', 780, 'credit']]);
	assert.equal(s.noItems, 1);
	assert.equal(s.units, 4);
	assert.equal(matchStock(s.inStock[1], '#Dropy-1'), true);
	assert.equal(matchStock(s.inStock[1], 'b0cwj'), true);
	assert.equal(matchStock(s.inStock[1], 'zzz'), false);
});

test('sheet tab rows: header, status per item, money words, formula-safe text', () => {
	const rtos = [rto('1', { refund_state: 'credit_due', payment_mode: 'prepaid' }), rto('4', { stage: 'reship' })];
	const items = [
		item('a', '1', { qty: 2, reused_qty: 1, reused_orders: ['5123'], title: '=HYPERLINK("x")' }),
		item('e', '4'),
		item('n', '1', { ready_stock_state: 'na' })
	];
	const rows = sheetRows(items, rtos, Date.parse('2026-10-07T09:30:00Z'));
	assert.deepEqual(rows[0], SHEET_HEADER);
	assert.equal(rows.length, 3);
	const a = rows.find((r) => r[1] === '#1')!;
	assert.deepEqual(a, ['6 Oct', '#1', `'=HYPERLINK("x")`, 'B0CWJSFYWT', '2', '1', '1', '', 'Partly re-used', '#5123', 'Store credit due', '7 Oct 15:00']);
	assert.equal(rows.find((r) => r[1] === '#4')![8], 'Sent back to customer');
});
