import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parsePassbook, categoryOf, istIso, suggestFor, monthly, monthLabel, rupees, parseCnDetails, orderNoOf } from '../src/lib/money.ts';

// Lines copied from the real Velocity passbook download (Dropy-Ledger_Report-20261008_161139.csv), same header and format
const REAL = [
	'Transaction Type,Amount,Balance,Tracking Number,Notes,Created At',
	'Credit,33.45,16421.26,7D140852538,Shipping Charges Reversed,2026-09-30 17:26:55',
	'Debit,78.06,1697.16,7D137548148,Shipping Charges,2026-08-20 09:08:22',
	'Debit,118.0,4862.43,38539511863993,RTO Charges,2026-08-27 18:05:28',
	'Debit,43.97,17948.19,I81054067,COD Charges,2026-09-28 10:15:21',
	'Credit,2179.0,20563.59,,Being financial note issued for lost Shipment,2026-09-24 14:14:00',
	'Credit,5000.0,5220.61,,Wallet Recharge,2026-08-19 13:18:39',
	'Credit,1728.0,6482.67,,Being financial note issued for lost Shipment,2026-10-01 15:16:40',
	'Credit,4999.99,5714.28,,Being financial note issued for lost Shipment,2026-10-08 12:26:20',
	'Debit,22.42,5739.74,7D139888253,RTO Charges,2026-10-08 13:03:00',
	'Credit,47.88,5762.16,7D139888253,COD Charges Reversed,2026-10-08 13:03:00'
].join('\r\n');

test('real passbook file: every line read, IST dates, categories', () => {
	const p = parsePassbook('﻿' + REAL + '\r\n');
	assert.equal(p.skipped.length, 0);
	assert.equal(p.rows.length, 10);
	assert.equal(p.from, '2026-08-19T13:18:39+05:30');
	assert.equal(p.to, '2026-10-08T13:03:00+05:30');
	assert.deepEqual(p.rows[0], { at: '2026-09-30T17:26:55+05:30', type: 'credit', amount: '33.45', balance: '16421.26', awb: '7D140852538', notes: 'Shipping Charges Reversed', category: 'reversal' });
	assert.deepEqual(p.rows.map((r) => r.category), ['reversal', 'shipping', 'rto', 'cod', 'claim_credit', 'recharge', 'claim_credit', 'claim_credit', 'rto', 'reversal']);
	assert.equal(p.rows[2].amount, '118.00');
	assert.equal(p.rows[4].awb, '');
});

test('on-screen column names and date format work too; bad lines are listed, not guessed', () => {
	const p = parsePassbook([
		'Date,AWB,Amount,Credit /Debit,Closing Balance,Description / Remarks',
		'08 Oct 26 | 01:03 PM,7D139888253,"₹22.42",Debit,"₹5,739.74",RTO Charges',
		'08 Oct 26 | 12:26 PM,N/A,"₹4,999.99",Credit,"₹5,714.28",Being financial note issued for lost Shipment',
		'yesterday,X,1,Debit,1,Shipping Charges',
		'08 Oct 26 | 10:32 AM,7D144136645,abc,Debit,1,Shipping Charges'
	].join('\n'));
	assert.deepEqual(p.rows.map((r) => [r.at, r.awb, r.amount, r.type, r.balance, r.category]), [
		['2026-10-08T13:03:00+05:30', '7D139888253', '22.42', 'debit', '5739.74', 'rto'],
		['2026-10-08T12:26:00+05:30', '', '4999.99', 'credit', '5714.28', 'claim_credit']
	]);
	assert.deepEqual(p.skipped, [{ line: 4, why: 'date "yesterday"' }, { line: 5, why: 'amount "abc"' }]);
	assert.match(parsePassbook('Order,Value\n1,2').skipped[0].why, /not a Velocity passbook/);
	assert.equal(parsePassbook('').rows.length, 0);
});

test('csv quotes, dates, categories', () => {
	assert.deepEqual(parseCsv('a,"b,c","d ""e"""\n\n1,2,3'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
	assert.equal(istIso('2026-10-08 09:05'), '2026-10-08T09:05:00+05:30');
	assert.equal(istIso('08 Oct 26 | 12:05 AM'), '2026-10-08T00:05:00+05:30');
	assert.equal(istIso('8-10-2026 16:09:36'), '2026-10-08T16:09:36+05:30');
	assert.equal(istIso('soon'), null);
	assert.equal(categoryOf('Weight Discrepancy RTO Charge Deducted', 'debit'), 'weight');
	assert.equal(categoryOf('RTO Charges Reversed', 'credit'), 'reversal');
	assert.equal(categoryOf('Being financial note issued for lost Shipment', 'debit'), 'other', 'a debit is never claim money');
	assert.equal(categoryOf('Something new', 'credit'), 'other');
});

test('suggestions: caps within ₹1, claimed amount, orders with no claim', () => {
	const rtos = [
		{ id: 'r1', order_no: '3315', order_value: 12049, forward_awb: 'A1' },
		{ id: 'r2', order_no: '3082', order_value: 3977, forward_awb: 'A2' },
		{ id: 'r3', order_no: '1419', order_value: 1728, forward_awb: 'A3' },
		{ id: 'r4', order_no: '2954', order_value: 1728, forward_awb: 'A4' },
		{ id: 'r5', order_no: 'Praveen', order_value: 32867.72, forward_awb: 'A5' }
	];
	const claims = [
		{ id: 'c1', rto_id: 'r1', status: 'raised', reason: 'lost', claimed_amount: 12049, expected_amount: 2500 },
		{ id: 'c2', rto_id: 'r2', status: 'approved', reason: 'lost', claimed_amount: 3977, expected_amount: 2500, approved_amount: 2500 },
		{ id: 'c4', rto_id: 'r4', status: 'closed', reason: 'mdnd', claimed_amount: 1728 }
	];
	const s5 = suggestFor(4999.99, claims, rtos);
	assert.deepEqual(s5.map((s) => [s.order, s.why]), [['#3315', '₹5,000 cap (order ₹12,049)']]);
	assert.deepEqual(suggestFor(2500, claims, rtos).map((s) => [s.order, s.why]), [['#3082', 'approved amount ₹2,500'], ['#3315', 'expected amount ₹2,500']]);
	const s1728 = suggestFor(1728, claims, rtos);
	assert.deepEqual(s1728.map((s) => [s.kind, s.order, s.why]), [['order', '#1419', 'order value ₹1,728, no open claim'], ['order', '#2954', 'order value ₹1,728, no open claim']]);
	assert.equal(suggestFor(777, claims, rtos).length, 0);
});

test('monthly summary: charges, counts, reversals, claim money, net', () => {
	const m = monthly([
		{ source: 'v', month: '2026-10', category: 'shipping', txn_type: 'debit', n: 10, amount: '500.00' },
		{ source: 'v', month: '2026-10', category: 'rto', txn_type: 'debit', n: 2, amount: '60' },
		{ source: 'v', month: '2026-10', category: 'weight', txn_type: 'debit', n: 3, amount: '90' },
		{ source: 'v', month: '2026-10', category: 'reversal', txn_type: 'credit', n: 1, amount: '50' },
		{ source: 'v', month: '2026-10', category: 'claim_credit', txn_type: 'credit', n: 1, amount: '4999.99' },
		{ source: 'v', month: '2026-10', category: 'recharge', txn_type: 'credit', n: 1, amount: '25000' },
		{ source: 'v', month: '2026-09', category: 'cod', txn_type: 'debit', n: 4, amount: '200' }
	]);
	assert.deepEqual(m.map((x) => x.month), ['2026-10', '2026-09']);
	assert.deepEqual(m[0], { month: '2026-10', shipping: 500, cod: 0, rto: 60, rtoCount: 2, weight: 90, weightCount: 3, reversed: 50, claimMoney: 4999.99, net: 600 });
	assert.equal(m[1].net, 200);
	assert.equal(monthLabel('2026-10'), 'Oct 2026');
	assert.equal(rupees(4999.99), '₹4,999.99');
	assert.equal(rupees(1728), '₹1,728');
});

// The three real credit-note detail files (Velocity → Payments → Credit Note → second icon), byte for byte
const H = 'Credit Note Id,Order Id,Order Value,Shipment Type(FWD/REV),AWB Number,Shipment Status,Claim Amount';
const CN246 = [H, 'VSF/FN/1026/246,#Dropy-3082,3977.0,FWD,38539512054802,lost,2499.9952', 'VSF/FN/1026/246,#Dropy-1708,3847.0,FWD,7D130953961,rto_delivered,2499.9952', ''].join('\n');
const CN096 = [H, 'VSF/FN/1026/096,#Dropy-1419,1728.0,FWD,7D130942098,lost,1728.0038', ''].join('\n');
const CN393 = [H, 'VSF/FN/0926/393,#Dropy-2354,2179.0,FWD,38539512014305,rto_delivered,2178.9998', ''].join('\n');

test('credit-note details: real file with two orders', () => {
	const p = parseCnDetails(CN246);
	assert.equal(p.skipped.length, 0);
	assert.equal(p.notes.length, 1);
	assert.equal(p.notes[0].cn, 'VSF/FN/1026/246');
	assert.equal(p.notes[0].total, 4999.99); // the passbook line
	assert.deepEqual(p.notes[0].rows[0], { awb: '38539512054802', order_no: '3082', order_value: 3977, status: 'lost', amount: 2499.9952 });
	assert.deepEqual(p.notes[0].rows.map((r) => [r.order_no, r.status]), [['3082', 'lost'], ['1708', 'rto_delivered']]);
});

test('credit-note details: files joined, one total per note, duplicates once', () => {
	const p = parseCnDetails(CN246 + CN096 + CN393 + CN096);
	assert.deepEqual(p.notes.map((n) => [n.cn, n.rows.length, n.total]), [['VSF/FN/1026/246', 2, 4999.99], ['VSF/FN/1026/096', 1, 1728], ['VSF/FN/0926/393', 1, 2179]]);
	assert.equal(p.skipped.length, 0);
});

test('credit-note details: wrong file and bad lines', () => {
	assert.match(parseCnDetails(REAL).skipped[0].why, /not a credit-note details file/);
	assert.equal(parseCnDetails(REAL).notes.length, 0);
	assert.equal(parseCnDetails('').skipped[0].why, 'empty file');
	const p = parseCnDetails([H, 'VSF/X,#Dropy-1,10,FWD,,lost,5', 'VSF/X,#Dropy-2,10,FWD,AWB2,lost,abc', 'VSF/X,#Dropy-3,10,FWD,AWB3,lost,5'].join('\n'));
	assert.deepEqual(p.skipped, [{ line: 2, why: 'no AWB' }, { line: 3, why: 'amount "abc"' }]);
	assert.equal(p.notes[0].rows.length, 1);
	assert.equal(orderNoOf('#Dropy-3082'), '3082');
	assert.equal(orderNoOf('Dropy 4101-1'), '4101-1');
	assert.equal(orderNoOf('SHOP-77'), 'SHOP-77');
});
