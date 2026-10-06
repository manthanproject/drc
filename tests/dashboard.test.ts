import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DAY, DEFAULT_RULES as R, buildDashboard, bucketOf, needsAction, listRows, matchesSearch,
	trackingUrl, isNonDropy, windowText, ageText, syncState, inr, dateShort, type Rto, type Claim
} from '../src/lib/dashboard.ts';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
let seq = 0;
const rto = (p: Partial<Rto>): Rto => ({
	id: `r${++seq}`, courier: 'velocity', carrier_name: 'DTDC', order_no: String(1000 + seq), order_name: null,
	forward_awb: `AWB${seq}`, rto_awb: null, scanned_code: null, payment_mode: 'cod', order_value: 1000,
	customer_name: 'Test Name', customer_phone10: '9876543210', stage: 'in_flight', courier_status: 'rto_in_transit',
	rto_delivered_at: null, last_movement_at: null, last_event_at: null, legacy_source: null, ...p
});

test('delayed needs a real event date (D)', () => {
	assert.equal(bucketOf(rto({ last_movement_at: ago(4) }), NOW, R), 'delayed');
	assert.equal(bucketOf(rto({ last_movement_at: ago(1) }), NOW, R), 'coming');
	assert.equal(bucketOf(rto({ last_movement_at: null, last_event_at: null }), NOW, R), 'coming');
	assert.equal(bucketOf(rto({ last_movement_at: null, last_event_at: ago(5) }), NOW, R), 'delayed');
});

test('every RTO lands in exactly one bucket; totals add up', () => {
	const stages = ['in_flight', 'awaiting_receipt', 'scanned', 'to_call', 'claim', 'reship', 'ready_stock', 'hold', 'store_credit', 'closed', 'lost', 'inspected', 'unknown_parcel'] as const;
	const rows = stages.map((s) => rto({ stage: s, order_no: s === 'unknown_parcel' ? null : '1' }));
	const d = buildDashboard(rows, [], R, NOW);
	const sum = d.coming.n + d.delayed.n + d.awaiting.n + d.inspect.n + d.call.n + d.claims.n + d.parked.reduce((s, p) => s + p.n, 0);
	assert.equal(sum, rows.length);
});

test('coming-back split and no-date count', () => {
	const d = buildDashboard([
		rto({ courier_status: 'rto_initiated' }),
		rto({ courier_status: 'rto_in_transit', last_movement_at: ago(1) }),
		rto({ courier_status: 'rto_out_for_delivery', last_movement_at: ago(0.2) })
	], [], R, NOW);
	assert.deepEqual(d.coming, { n: 3, started: 1, moving: 1, ofd: 1, noDate: 1 });
});

test('MDND only after 48 h; no-date awaiting still listed', () => {
	const fresh = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(1) });
	const old = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(3) });
	const noDate = rto({ stage: 'awaiting_receipt' });
	const a = needsAction([fresh, old, noDate], [], R, NOW);
	assert.deepEqual(a.map((i) => i.rto?.id).sort(), [old.id, noDate.id].sort());
	assert.equal(ageText(a.find((i) => i.rto === noDate)!), 'no tracking date');
});

test('urgency: open windows soonest first, then the rest by ₹ (Q3)', () => {
	const w5 = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(2), order_value: 100 }); // 5 d left
	const w1 = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(6), order_value: 50 }); // 1 d left
	const closedBig = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(20), order_value: 9000 });
	const closedSmall = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(30), order_value: 200 });
	const lost = rto({ stage: 'lost', order_value: 4000 });
	const a = needsAction([closedSmall, w5, lost, closedBig, w1], [], R, NOW);
	assert.deepEqual(a.map((i) => i.rto!.id), [w1.id, w5.id, closedBig.id, lost.id, closedSmall.id]);
	assert.equal(windowText(a[0]), '1 d left');
	assert.equal(windowText(a[2]), 'Window closed');
	assert.equal(a[0].tone, 'bad');
	assert.equal(a[1].tone, 'warn');
	assert.equal(ageText(a[0]), '6 d ago');
});

test('last day of window', () => {
	const r = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(6.5) });
	assert.equal(windowText(needsAction([r], [], R, NOW)[0]), 'Last day');
});

test('claims box: stage claim, ₹ = order value until a claim row exists', () => {
	const a = rto({ stage: 'claim', order_value: 3977 });
	const b = rto({ stage: 'claim', order_value: 3828 });
	const claims: Claim[] = [{ id: 'c1', rto_id: a.id, reason: 'lost', status: 'waiting', deadline_at: null, approved_at: null, outstanding: 2500 }];
	const d = buildDashboard([a, b], claims, R, NOW);
	assert.deepEqual(d.claims, { n: 2, atStake: 2500 + 3828 });
});

test('credit due + claim window from claims table', () => {
	const a = rto({ stage: 'claim' });
	const claims: Claim[] = [
		{ id: 'c1', rto_id: a.id, reason: 'lost', status: 'approved', deadline_at: null, approved_at: ago(10), outstanding: 2500 },
		{ id: 'c2', rto_id: a.id, reason: 'damaged', status: 'raised', deadline_at: new Date(NOW + 2.5 * DAY).toISOString(), approved_at: null, outstanding: 3828 }
	];
	const d = buildDashboard([a], claims, R, NOW);
	assert.deepEqual(d.creditDue, { n: 1, value: 2500 });
	assert.deepEqual(d.action.map((i) => i.kind), ['claim_window', 'credit_due']);
	assert.equal(windowText(d.action[0]), '2 d left');
});

test('sheet-only rows are not tappable (C); velocity rows link to tracking', () => {
	assert.equal(trackingUrl(rto({ legacy_source: 'sheet', courier: null, forward_awb: null })), null);
	assert.equal(trackingUrl(rto({ forward_awb: '7D139889794' })), 'https://www.velocityshipping.in/track/7D139889794');
	const rows = listRows([rto({ stage: 'reship', legacy_source: 'sheet', courier: null, forward_awb: null })], 'reship', '', R, NOW);
	assert.equal(rows[0].href, null);
	assert.equal(rows[0].sheetOnly, true);
});

test('non-Dropy tag', () => {
	assert.equal(isNonDropy(rto({ order_no: 'Praveen' })), true);
	assert.equal(isNonDropy(rto({ order_no: 'Krishna 1005' })), true);
	assert.equal(isNonDropy(rto({ order_no: '1642-1-1' })), false);
});

test('search: order forms, AWB, phone, name', () => {
	const r = rto({ order_no: '3479', forward_awb: '7D139889794', customer_phone10: '9820012345', customer_name: 'Anita Rao' });
	for (const q of ['3479', '#3479', '#Dropy-3479', 'Dropy-3479-ALL', '7d1398', '+91 98200 12345', 'anita']) assert.ok(matchesSearch(r, q), q);
	assert.ok(!matchesSearch(r, 'zzz'));
});

test('sync label: green ≤30 min, red when stale or failed', () => {
	assert.deepEqual(syncState({ ok: true, at: new Date(NOW - 2 * 60_000).toISOString() }, NOW), { text: '2 min ago', ok: true });
	assert.equal(syncState({ ok: true, at: new Date(NOW - 47 * 60_000).toISOString() }, NOW).ok, false);
	assert.equal(syncState({ ok: false, at: new Date(NOW).toISOString(), error: 'x' }, NOW).ok, false);
	assert.equal(syncState(null, NOW).ok, false);
});

test('date in IST, 3-letter month', () => {
	assert.equal(dateShort('2026-09-22T19:00:00Z'), '23 Sep'); // 00:30 IST next day
	assert.equal(dateShort('2026-09-22T10:00:00Z'), '22 Sep');
	assert.equal(dateShort(null), '');
});

test('Indian rupee format', () => {
	assert.equal(inr(188661), '₹1,88,661');
	assert.equal(inr(32867.72), '₹32,868');
});

test('re-ship suggestion replaces the MDND line and keeps urgency order', () => {
	const pending = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(5), order_no: '3544', reship_state: 'pending', reship_order_no: '3544-1', reship_created_at: ago(4.9) });
	const rejected = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(6), reship_state: 'rejected', reship_order_no: '1002-1' });
	const a = needsAction([pending, rejected], [], R, NOW);
	const p = a.find((i) => i.rto === pending)!;
	assert.equal(p.kind, 'reship_found');
	assert.equal(p.title, '#3544 re-shipped as #3544-1');
	assert.equal(p.tone, 'ok');
	assert.equal(a.find((i) => i.rto === rejected)!.kind, 'mdnd');
	assert.deepEqual(a.map((i) => i.rto), [rejected, pending]); // 1 d left before 2 d left
});

test('PC table: action groups and short "What" text', async () => {
	const { actionGroup, actionWhat } = await import('../src/lib/dashboard.ts');
	assert.equal(actionGroup({ kind: 'claim_window' }), 'followup');
	assert.equal(actionGroup({ kind: 'mdnd' }), 'notreceived');
	assert.equal(actionGroup({ kind: 'no_date' }), 'notreceived');
	assert.equal(actionGroup({ kind: 'reship_found' }), 'reship');
	assert.equal(actionGroup({ kind: 'unknown' }), 'lost');
	const r = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(5), reship_state: 'pending', reship_order_no: '3544-1', reship_created_at: ago(4) });
	const [i] = needsAction([r], [], R, NOW);
	assert.equal(actionWhat(i), 'Re-shipped as #3544-1?');
});

test('All RTOs: counts per view and oldest-first sort', async () => {
	const { filterCounts, listRows, sortRows } = await import('../src/lib/dashboard.ts');
	const a = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(10), order_value: 100 });
	const b = rto({ stage: 'awaiting_receipt', rto_delivered_at: ago(1), order_value: 900 });
	const c = rto({ stage: 'awaiting_receipt', order_value: 500 });
	const h = rto({ stage: 'hold' });
	const counts = filterCounts([a, b, c, h], [], R, NOW);
	assert.equal(counts.all, 4);
	assert.equal(counts.awaiting, 3);
	assert.equal(counts.hold, 1);
	assert.equal(counts.action, 2); // a (MDND) + c (no date); b is under 48 h
	const rows = listRows([a, b, c], 'awaiting', '', R, NOW);
	assert.deepEqual(sortRows(rows, 'value').map((r) => r.rto), [b, c, a]);
	assert.deepEqual(sortRows(rows, 'old').map((r) => r.rto), [a, b, c]);
});

test('Velocity dispute status (real 6 Oct data: status "raised" = panel "In Review")', async () => {
	const { disputeStatus, disputeType, latestDispute } = await import('../src/lib/dashboard.ts');
	assert.deepEqual(disputeStatus('raised'), { label: 'In Review', tone: 'warn' });
	assert.deepEqual(disputeStatus('approved'), { label: 'Approved', tone: 'ok' });
	assert.deepEqual(disputeStatus('pending_courier_reply'), { label: 'Pending Courier Reply', tone: 'mute' }); // unknown → shown as-is
	assert.equal(disputeType('mdnd'), 'MDND (marked delivered, not received)');
	const r = rto({ stage: 'claim', disputes: [
		{ id: 'a', status: 'rejected', dispute_type: 'mdnd', raised_at: '2026-10-01T10:00:00+05:30' },
		{ id: 'b', status: 'raised', dispute_type: 'mdnd', raised_at: '2026-10-04T19:54:09.731+05:30' }
	] });
	assert.equal(latestDispute(r)?.id, 'b');
	const [i] = needsAction([r], [{ id: 'c', rto_id: r.id, reason: 'mdnd', status: 'raised', deadline_at: '2026-10-06T14:24:00Z', approved_at: null, raised_at: '2026-10-04T14:24:00Z', outstanding: 100 }], R, NOW);
	assert.equal(i.detail, 'Velocity: In Review · Follow up by 6 Oct');
});
