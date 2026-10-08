import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRefundSheet, colourStatus, sheetOrderNos, cleanColumns, cleanValue, counts, matches, orderNo, newColKey, type SheetCell, type Refund } from '../src/lib/refunds.ts';

// Rows as on the real "Dropy Refund" tab (8 Oct screenshot), with the fill of the Order Id cell
const G = { green: 1 }, CY = { green: 1, blue: 1 }, Y = { red: 1, green: 1 }, R = { red: 0.92, green: 0.26, blue: 0.21 }, GR = { red: 0.72, green: 0.72, blue: 0.72 }, W = { red: 1, green: 1, blue: 1 };
const row = (bg: SheetCell['bg'], ...t: string[]): SheetCell[] => t.map((text, i) => ({ text, bg: i === 0 ? bg : null }));
const SHEET: SheetCell[][] = [
	row(null, 'Order Id', 'Reason', 'Payment through', 'Source', 'Status'),
	row(W, 'Dropy-4046', 'Not available', 'Bank', 'Original payment method', ''),
	row(G, 'Dropy-3012', 'Told Expired - RTO intransit', 'Bank', 'Original payment method', 'Done'),
	row(null, 'Dropy-5080', 'Personal Reason - No refund', '', '', ''),
	row(R, 'Dropy-3081', 'Wait for the exact product stattus - it shows delivered', '', '', ''),
	row(R, 'Dropy-3898, 3263', 'Currently unavailable', '', '', ''),
	row(Y, 'Dropy-3298', 'On Hold - COD No refund', '', '', ''),
	row(G, 'Dropy-4645', 'Customer cancelled', 'Payu', 'Original payment method', 'Done'),
	row(CY, 'Dropy-3489', 'Awaited for bank details', 'Bank', 'Original payment method', ''),
	row(GR, 'Dropy-3322', 'Just for men - Message to Dropy-1931', '', '', ''),
	row(null, 'Dropy-4320', '', '', '', ''),
	row(G, 'Dropy-3292', 'Currently Unavailable', 'Razorpay', 'Original payment method', 'Done'),
	row(null, '', 'stray note', '', '', ''),
	row(null, '', '', '', '', '')
];

test('real sheet rows → refunds with status from colour / text', () => {
	const p = parseRefundSheet(SHEET);
	const by = Object.fromEntries(p.rows.map((r) => [r.order_no, r]));
	assert.deepEqual(by['4046'], { sheet_row: 2, order_no: '4046', reason: 'Not available', via: 'bank', refund_to: 'original', status: 'to_refund' });
	assert.equal(by['3012'].status, 'done');
	assert.equal(by['5080'].status, 'no_refund');
	assert.equal(by['3081'].status, 'needs_check');
	assert.deepEqual([by['3898'].sheet_row, by['3263'].sheet_row, by['3263'].status], [6, 6, 'needs_check']);
	assert.equal(by['3298'].status, 'on_hold');
	assert.deepEqual([by['4645'].status, by['4645'].via], ['done', 'payu']);
	assert.equal(by['3489'].status, 'waiting');
	assert.equal(by['3322'].status, 'no_refund');
	assert.equal(by['3322'].order_no, '3322'); // the "Dropy-1931" in the reason is not a second order
	assert.equal(by['4320'].status, 'needs_check');
	assert.equal(by['3292'].via, 'razorpay');
	assert.equal(p.rows.length, 12);
	assert.deepEqual(p.skipped, [13]);
});

test('colours and order cells', () => {
	assert.equal(colourStatus(W), null);
	assert.equal(colourStatus(null), null);
	assert.equal(colourStatus({ red: 0, green: 1, blue: 0 }), 'done');
	assert.equal(colourStatus({ red: 0.6, green: 0.6, blue: 0.6 }), 'no_refund');
	assert.deepEqual(sheetOrderNos('Dropy-3898, 3263'), ['3898', '3263']);
	assert.deepEqual(sheetOrderNos('Dropy-1381-1'), ['1381-1']);
	assert.equal(orderNo(' #Dropy-3082'), '3082');
});

test('columns setting is re-checked', () => {
	const ok = cleanColumns({ custom: [{ key: 'c_ab12cd34', label: ' Ticket ', type: 'text' }, { key: 'c_zz99zz99', label: 'Priority', type: 'choice', options: ['High', 'Low', 'High', ''] }], hidden: ['via', 'order', 'c_ab12cd34', 'nope'] });
	assert.deepEqual(ok, { custom: [{ key: 'c_ab12cd34', label: 'Ticket', type: 'text' }, { key: 'c_zz99zz99', label: 'Priority', type: 'choice', options: ['High', 'Low'] }], hidden: ['via', 'c_ab12cd34'] });
	assert.throws(() => cleanColumns({ custom: [{ key: 'c_ab12cd34', label: 'Reason', type: 'text' }] }), /already a column called "Reason"/);
	assert.throws(() => cleanColumns({ custom: [{ key: 'c_ab12cd34', label: 'X', type: 'choice', options: [] }] }), /add at least one choice/);
	assert.throws(() => cleanColumns({ custom: [{ key: 'bad', label: 'X', type: 'text' }] }), /needs a name and a type/);
	assert.match(newColKey(), /^c_[a-z0-9]{8}$/);
});

test('custom values are cleaned by type', () => {
	assert.equal(cleanValue({ key: 'c_a', label: 'N', type: 'number' }, '₹1,234'), 1234);
	assert.throws(() => cleanValue({ key: 'c_a', label: 'N', type: 'number' }, 'abc'), /must be a number/);
	assert.equal(cleanValue({ key: 'c_a', label: 'D', type: 'date' }, '2026-10-08'), '2026-10-08');
	assert.equal(cleanValue({ key: 'c_a', label: 'T', type: 'text' }, '  '), null);
	assert.throws(() => cleanValue({ key: 'c_a', label: 'P', type: 'choice', options: ['A'] }, 'B'), /pick one/);
});

test('counts and search', () => {
	const r = (o: Partial<Refund>) => ({ id: '1', order_no: '3489', rto_id: null, reason: 'Awaited for bank details', via: 'bank', refund_to: 'original', amount: null, status: 'waiting', done_at: null, done_ref: 'UTR 77', extra: { c_x: 'Priya' }, source: 'sheet', created_at: '', updated_at: '', ...o }) as Refund;
	assert.equal(counts([r({}), r({ status: 'done' }), r({})]).waiting, 2);
	assert.ok(matches(r({}), '#Dropy-348'));
	assert.ok(matches(r({}), 'bank details'));
	assert.ok(matches(r({}), 'utr 77'));
	assert.ok(matches(r({}), 'priya'));
	assert.ok(!matches(r({}), '3500'));
});
