import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istDate, parseDay, dayRange, shiftDay, dayLabel, istTime, buildScanLog, summarise, scanLogCsv, type LogEvent } from '../src/lib/scanlog.ts';
import type { Rto } from '../src/lib/dashboard.ts';

const NOW = Date.parse('2026-10-06T05:00:00Z'); // 10:30 IST

test('IST day helpers', () => {
	assert.equal(istDate(Date.parse('2026-10-05T19:00:00Z')), '2026-10-06'); // 00:30 IST next day
	assert.equal(parseDay(null, NOW), '2026-10-06');
	assert.equal(parseDay('2026-10-04', NOW), '2026-10-04');
	assert.equal(parseDay('2026-12-01', NOW), '2026-10-06'); // future → today
	assert.equal(parseDay('junk', NOW), '2026-10-06');
	assert.deepEqual(dayRange('2026-10-06'), { from: '2026-10-05T18:30:00.000Z', to: '2026-10-06T18:30:00.000Z' });
	assert.equal(shiftDay('2026-10-01', -1), '2026-09-30');
	assert.equal(dayLabel('2026-10-06'), 'Tue 6 Oct 2026');
	assert.equal(istTime('2026-10-06T04:35:00Z'), '10:05');
});

const rto = (id: string, order_no: string, stage: string, v = 1000): Rto => ({
	id, courier: 'velocity', carrier_name: 'DTDC Standard', order_no, order_name: null, forward_awb: `7D${id}`, rto_awb: null,
	scanned_code: null, payment_mode: 'cod', order_value: v, customer_name: null, customer_phone10: null, stage: stage as never,
	courier_status: null, rto_delivered_at: null, last_movement_at: null, last_event_at: null, legacy_source: null
});
const map = new Map([['a', rto('a', '2876', 'to_call', 3444)], ['b', rto('b', '2594', 'reship', 2000)], ['c', rto('c', '3619', 'closed', 500)]]);
const ev = (id: number, rto_id: string | null, kind: string, payload: any, t: string): LogEvent => ({ id, rto_id, kind, payload, received_at: t });
const events = [
	ev(5, 'b', 'stage_change', { action: 'hold', to: 'hold', args: { scanned: true } }, '2026-10-06T04:42:00Z'),
	ev(3, 'a', 'stage_change', { action: 'received_call', to: 'to_call', args: { scanned: true } }, '2026-10-06T04:35:00Z'),
	ev(4, 'a', 'stage_change', { action: 'call_no_answer', to: 'to_call', args: {} }, '2026-10-06T04:36:00Z'), // not a scan
	ev(6, 'c', 'stage_change', { action: 'close', to: 'closed', args: { scanned: true }, undone: true }, '2026-10-06T04:50:00Z'),
	ev(7, 'b', 'stage_change', { action: 'reship', to: 'reship', args: { reship_date: '2026-10-07' } }, '2026-10-06T05:10:00Z'), // later change, not a scan
	ev(8, null, 'unknown_parcel', { code: 'ZZZ999', note: 'box' }, '2026-10-06T04:55:00Z')
];

test('scan log: only scans + unknown parcels, oldest first, with "now" status', () => {
	const rows = buildScanLog(events, map);
	assert.deepEqual(rows.map((r) => [r.time, r.order, r.scannedAs, r.now, r.changed, r.undone]), [
		['10:05', '#2876', 'To call', 'To call', false, false],
		['10:12', '#2594', 'Hold', 'Re-ship', true, false],
		['10:20', '#3619', 'Closed', 'Closed', false, true],
		['10:25', 'Unknown ZZZ999', 'Unknown parcel', '—', false, false]
	]);
	const s = summarise(rows);
	assert.equal(s.total, 3); // undone scan left out
	assert.deepEqual(s.parts.map((p) => p.label).sort(), ['Hold', 'To call', 'Unknown parcel']);
	assert.equal(s.value, 5444);
});

test('CSV: header, escaping, formula-safe, Excel BOM', () => {
	const csv = scanLogCsv('2026-10-06', buildScanLog(events, map));
	assert.ok(csv.startsWith('﻿Date,Time (IST),Order,'));
	assert.ok(csv.includes('2026-10-06,10:05,#2876,DTDC Standard,7Da,To call,To call,3444,'));
	assert.ok(csv.includes(',Closed,Closed,500,yes'));
	const evil = buildScanLog([ev(9, null, 'unknown_parcel', { code: '=HYPERLINK("x")' }, '2026-10-06T05:00:00Z')], map);
	assert.ok(scanLogCsv('2026-10-06', evil).includes(`"'=HYPERLINK(""x"")"`));
});
