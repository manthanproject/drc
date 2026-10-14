import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrders, parseSheet, stageFor, drcLabel, drcCell, same, parseSheetDate, compare, receiveAction, colLetter, sheetText, type DrcRto, type Baseline } from '../src/lib/sheet-sync.ts';

const NOW = Date.parse('2026-10-14T09:00:00Z');
const istDay = (iso: string) => new Date(Date.parse(iso) + 19_800_000).toISOString().slice(0, 10);
const HEAD = ['Date', 'Order ID', 'Iteams', 'SKU', 'RTO - Status', 'Status', 'Re delivery initiated'];

test('order numbers in a cell', () => {
	assert.deepEqual(parseOrders('Dropy-4915'), ['4915']);
	assert.deepEqual(parseOrders('#Dropy-1381-1'), ['1381-1']);
	assert.deepEqual(parseOrders('Dropy-1093, 1073'), ['1093', '1073']);
	assert.deepEqual(parseOrders('Dropy-5000-ALL'), ['5000']);
	assert.deepEqual(parseOrders('dropy 2502'), ['2502']);
	assert.deepEqual(parseOrders('4841'), ['4841']);
	assert.deepEqual(parseOrders('RTO claim'), []);
	assert.deepEqual(parseOrders(''), []);
});

test('sheet words → status, and DRC labels read back the same', () => {
	assert.equal(stageFor('All received'), 'closed');
	assert.equal(stageFor('All Recieved'), 'closed');
	assert.equal(stageFor('Customer busy, call later'), 'to_call');
	assert.equal(stageFor("Customer doesn't want"), 'ready_stock');
	assert.equal(stageFor('Ready stock'), 'ready_stock');
	assert.equal(stageFor('Wants re-delivery'), 'reship');
	assert.equal(stageFor('RTO in transit'), 'skip');
	assert.equal(stageFor('All received', 'Claimed'), 'claim');
	assert.equal(stageFor('', '', 'RTO claim'), 'claim');
	assert.equal(stageFor('Hold - admin pending'), 'hold');
	assert.equal(stageFor('Store credit given'), 'store_credit');
	for (const s of ['to_call', 'reship', 'ready_stock', 'store_credit', 'hold', 'claim', 'closed'])
		assert.equal(stageFor(drcLabel(s, s === 'reship' ? '2026-10-16' : null)), s, s);
	assert.equal(drcLabel('reship', '2026-10-16'), 'Re-deliver 16 Oct');
	// real sheet wording (14 Oct check)
	assert.equal(stageFor("i don't want give refund to mee"), 'ready_stock');
	assert.equal(stageFor('Don’t want'), 'ready_stock');
	assert.equal(stageFor("She doesn't need that product"), 'ready_stock');
	assert.equal(stageFor("mam said she didn't placed the order"), 'ready_stock');
	assert.equal(stageFor('re-shipped'), 'reshipped');
	assert.equal(stageFor('Done re-shipped 05.10.2026'), 'reshipped');
	assert.equal(stageFor("didn't pick switch off"), 'to_call');
	assert.equal(stageFor("didn't pick the call so sent a voice mail"), 'to_call');
	assert.equal(stageFor('Ready stock — didn\'t pick'), 'ready_stock');
	assert.equal(stageFor('Hold — didn\'t pick'), 'hold');
	assert.equal(stageFor('Claim — re-shipped'), 'claim');
	assert.ok(same('reshipped', 'closed') && same('reshipped', 'reship') && !same('reshipped', 'to_call'));
	assert.ok(same('to_call', 'hold') && !same('hold', 'to_call'));
	// DRC keeps the team's note when it writes its status
	assert.equal(drcCell('ready_stock', null, "didn't pick"), "Ready stock — didn't pick");
	assert.equal(drcCell('hold', null, "Ready stock — didn't pick"), "Hold — didn't pick");
	assert.equal(drcCell('reship', '2026-10-20', 'Re-deliver 16 Oct — wants it Monday'), 'Re-deliver 20 Oct — wants it Monday');
	assert.equal(drcCell('closed', null, ''), 'All received');
	assert.equal(drcCell('claim', null, 'Claim'), 'Claim');
});

test('sheet dates', () => {
	assert.equal(parseSheetDate('10/10/2026', NOW), '2026-10-10');
	assert.equal(parseSheetDate('9-10-26', NOW), '2026-10-09');
	assert.equal(parseSheetDate('2026-10-08', NOW), '2026-10-08');
	assert.equal(parseSheetDate('12 Oct', NOW), '2026-10-12');
	assert.equal(parseSheetDate('12 October 2026', NOW), '2026-10-12');
	assert.equal(parseSheetDate('31/02/2026', NOW), null);
	assert.equal(parseSheetDate('', NOW), null);
});

test('header columns found by name; blank lines skipped', () => {
	const s = parseSheet([HEAD, ['', '', '', '', '', '', ''], ['10/10/2026', 'Dropy-4915', 'Balm', 'S1', 'All received', '', '']]);
	assert.equal(s.cols.order, 1);
	assert.equal(s.cols.rtoStatus, 4);
	assert.equal(s.rows.length, 1);
	assert.equal(s.rows[0].row, 3);
	assert.throws(() => parseSheet([['Foo', 'Bar']]));
	// a blank line in the middle does not end the tab: new rows go below the last filled row
	const g = parseSheet([HEAD, ['', 'Dropy-1', '', '', 'x', '', ''], ['', '', '', '', '', '', ''], ['', 'Dropy-2', '', '', 'y', '', ''], ['', '', '']]);
	assert.equal(g.lastRow, 4);
});

test('receive actions: prepaid Ready Stock needs a person, COD goes straight', () => {
	assert.equal(receiveAction('ready_stock', 'cod', 'x').action, 'ready_stock');
	assert.equal(receiveAction('ready_stock', 'prepaid', 'x').action, 'hold');
	assert.deepEqual(receiveAction('store_credit', 'prepaid', 'x').args.money, 'credit');
	assert.equal(receiveAction('claim', 'cod', 'x').action, 'hold');
	assert.match(receiveAction('closed', 'cod', 'All received').args.note, /From sheet: "All received"/);
});

const R = (o: Partial<DrcRto> & { id: string; order_no: string; stage: string }): DrcRto => ({ kind: 'rto', payment_mode: 'cod', created_at: '2026-10-01T00:00:00Z', ...o });

test('compare: every case', () => {
	const sheet = parseSheet([
		HEAD,
		['', 'Dropy-1001', '', '', 'All received', '', ''], // same as DRC
		['', 'Dropy-1002', '', '', 'Call customer', '', ''], // DRC still waiting → receive
		['', 'Dropy-1003', '', '', 'Hold', '', ''], // DRC changed since last sync, sheet not → write
		['', 'Dropy-1004', '', '', 'Ready stock', '', ''], // both changed → decide
		['', 'Dropy-1005', '', '', 'All received', '', ''], // not in DRC → only in sheet
		['', 'Dropy-1006, 1007', '', '', 'All received', '', ''], // unreadable, but 1007 counts as present
		['', 'Dropy-1008', '', '', 'All received', '', ''], // first check, different → decide
		['', 'Dropy-1009', '', '', 'Hold', '', ''], // DRC un-received since the last sync → decide
		['', 'Dropy-1010', '', '', 'RTO in transit', '', ''] // skip
	]);
	const rtos: DrcRto[] = [
		R({ id: 'a1', order_no: '1001', stage: 'closed', scanned_at: '2026-10-10T05:00:00Z' }),
		R({ id: 'a2', order_no: '1002', stage: 'awaiting_receipt' }),
		R({ id: 'a3', order_no: '1003', stage: 'ready_stock', scanned_at: '2026-10-10T05:00:00Z' }),
		R({ id: 'a4', order_no: '1004', stage: 'claim', scanned_at: '2026-10-10T05:00:00Z' }),
		R({ id: 'a7', order_no: '1007', stage: 'closed', scanned_at: '2026-10-10T05:00:00Z' }),
		R({ id: 'a8', order_no: '1008', stage: 'to_call', scanned_at: '2026-10-10T05:00:00Z' }),
		R({ id: 'a9', order_no: '1009', stage: 'awaiting_receipt' }),
		R({ id: 'a10', order_no: '1010', stage: 'in_flight' }),
		R({ id: 'a11', order_no: '1011', stage: 'ready_stock', scanned_at: '2026-10-13T20:00:00Z', items: [{ title: 'Balm', sku: 'S9', qty: 2 }, { title: 'Pay on Delivery', sku: null, qty: 1 }] }), // not in sheet → append
		R({ id: 'a12', order_no: '1012', stage: 'awaiting_receipt' }), // not received, not in sheet → nothing
		R({ id: 'a13', order_no: '1013', stage: 'closed', kind: 'customer_return', scanned_at: '2026-10-10T05:00:00Z' }) // returns are not synced
	];
	const base: Baseline[] = [
		{ order_no: '1003', sheet_text: 'hold|', drc_stage: 'hold', state: 'ok' },
		{ order_no: '1004', sheet_text: 'hold|', drc_stage: 'hold', state: 'ok' },
		{ order_no: '1009', sheet_text: 'hold|', drc_stage: 'hold', state: 'ok' }
	];
	const p = compare(sheet, rtos, base, NOW, istDay);
	assert.deepEqual(p.same.map((x) => x.order), ['1001']);
	assert.deepEqual(p.receive.map((x) => [x.order, x.rtoId, x.act.action]), [['1002', 'a2', 'received_call']]);
	assert.deepEqual(p.write.map((x) => [x.order, x.row, x.to, x.col]), [['1003', 4, 'Ready stock', 4]]);
	assert.deepEqual(p.decide.map((x) => x.order).sort(), ['1004', '1008', '1009']);
	assert.deepEqual(p.onlySheet.map((x) => x.order), ['1005']);
	assert.deepEqual(p.unreadable.map((x) => x.row), [7]);
	assert.deepEqual(p.append.map((x) => [x.order, x.day, x.items, x.values]), [['1011', '2026-10-14', 'Balm ×2', ['14/10/2026', 'Dropy-1011', 'Balm ×2', 'S9', 'Ready stock', 'DRC', '']]]);
	assert.deepEqual(p.baseline.map((b) => b.order_no), ['1001']);
	// ignored stays quiet until something changes
	const p2 = compare(sheet, rtos, [...base.filter((b) => b.order_no !== '1004'), { order_no: '1004', sheet_text: 'ready stock|', drc_stage: 'claim', state: 'ignored' }], NOW, istDay);
	assert.ok(!p2.decide.some((x) => x.order === '1004'));
	assert.equal(sheetText({ rtoStatus: ' All  Received ', status: 'Claimed' }), 'all received|claimed');
	assert.equal(colLetter(0), 'A');
	assert.equal(colLetter(4), 'E');
	assert.equal(colLetter(27), 'AB');
});
