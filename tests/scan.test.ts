import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMatches, istDayStart, istTomorrow, claimHref, claimReturn, withUndo, undoFromUrl } from '../src/lib/scan.ts';
import { describe as say } from '../src/lib/history.ts';
import { needsAction, ageText, DEFAULT_RULES, type Rto } from '../src/lib/dashboard.ts';

let n = 0;
const rto = (p: Partial<Rto>): Rto => ({
	id: `r${++n}`, courier: 'velocity', carrier_name: 'DTDC', order_no: String(5000 + n), order_name: null, forward_awb: `AWB${n}`,
	rto_awb: null, scanned_code: null, payment_mode: 'cod', order_value: 100, customer_name: 'Test Person', customer_phone10: '9000000000',
	stage: 'awaiting_receipt', courier_status: null, rto_delivered_at: null, last_movement_at: null, last_event_at: null, legacy_source: null, ...p
});

const list = [
	rto({ order_no: '1642', forward_awb: null, legacy_source: 'sheet' }),
	rto({ order_no: '1642-1', forward_awb: '7D137723660' }),
	rto({ order_no: '1642-1-1', forward_awb: '34812017714394' }),
	rto({ order_no: '16420', forward_awb: 'X1' }),
	rto({ order_no: '3544', forward_awb: 'XB1', customer_phone10: '9876543210', customer_name: 'Anita Rao' }),
	rto({ order_no: 'Praveen', forward_awb: 'P1' })
];

test('AWB wins, case/space-insensitive', () => {
	const r = findMatches(list, ' 7d137723660 ');
	assert.equal(r.by, 'awb');
	assert.deepEqual(r.matches.map((x) => x.order_no), ['1642-1']);
});

test('order number lists the re-ship chain, not look-alikes (16420)', () => {
	assert.deepEqual(findMatches(list, '1642').matches.map((x) => x.order_no), ['1642', '1642-1', '1642-1-1']);
	assert.deepEqual(findMatches(list, '#Dropy-1642-1').matches.map((x) => x.order_no), ['1642-1', '1642-1-1']);
	assert.deepEqual(findMatches(list, 'Dropy-3544-ALL').matches.map((x) => x.order_no), ['3544']);
});

test('non-Dropy, phone and name', () => {
	assert.equal(findMatches(list, 'praveen').matches[0].order_no, 'Praveen');
	assert.equal(findMatches(list, '+91 98765 43210').by, 'phone');
	assert.equal(findMatches(list, 'anita').by, 'name');
	assert.equal(findMatches(list, 'ZZZ999').by, 'none');
});

test('IST day start and tomorrow', () => {
	const now = Date.parse('2026-10-05T20:00:00Z'); // 6 Oct 01:30 IST
	assert.equal(istDayStart(now), '2026-10-05T18:30:00.000Z');
	assert.equal(istTomorrow(now), '2026-10-07');
});

test('raised claim: follow-up shows "Raised 4 Oct", not "no tracking date"; nothing before 48 h', () => {
	const r = rto({ stage: 'claim' });
	const c = [{ id: 'c', rto_id: r.id, reason: 'mdnd', status: 'raised', deadline_at: '2026-10-06T14:24:00Z', approved_at: null, raised_at: '2026-10-04T14:24:00Z', outstanding: 100 }];
	assert.equal(needsAction([r], c, DEFAULT_RULES, Date.parse('2026-10-05T10:00:00Z')).length, 0);
	const a = needsAction([r], c, DEFAULT_RULES, Date.parse('2026-10-07T10:00:00Z'));
	assert.equal(ageText(a[0]), 'Raised 4 Oct');
	assert.equal(a[0].detail, 'Raised 4 Oct, no update yet');
});

test('history wording', () => {
	const e = (kind: string, payload: any, source = 'user') => say({ id: 1, source, kind, payload, received_at: '' }).text;
	assert.equal(e('stage_change', { action: 'ready_stock', to: 'ready_stock', args: { money: 'credit', scanned: true } }), 'Scanned · Ready Stock · store credit');
	assert.equal(e('stage_change', { action: 'reship', args: { reship_date: '2026-10-07' } }), 'Re-ship on 7 Oct');
	assert.equal(e('stage_change', { action: 'hold', args: { note: 'call Monday' }, undone: true }), 'Hold — call Monday (undone)');
	assert.equal(e('undo', { restored_stage: 'awaiting_receipt' }), 'Undo, back to Arrived, not scanned');
	assert.equal(e('status_change', { from: 'rto_in_transit', to: 'rto_delivered' }, 'velocity'), 'Courier: rto in transit → rto delivered');
});

test('an unknown parcel is found again by the code it was saved with', () => {
	const u = rto({ stage: 'unknown_parcel', order_no: null, forward_awb: null, scanned_code: 'ZZZ 999' });
	const r = findMatches([...list, u], 'zzz999');
	assert.equal(r.by, 'awb');
	assert.equal(r.matches[0], u);
});

test('payment breakdown: partial shows paid online + COD (real #3544 numbers)', async () => {
	const { paymentBreakdown } = await import('../src/lib/dashboard.ts');
	assert.deepEqual(paymentBreakdown({ payment_mode: 'partial', order_value: 4968, amount_collected: 1301.25 }), { label: 'Partial · ₹4,968', detail: '₹1,301 paid online + ₹3,667 COD' });
	assert.deepEqual(paymentBreakdown({ payment_mode: 'cod', order_value: 4097, amount_collected: 0 }), { label: 'COD · ₹4,097', detail: 'Nothing paid upfront' });
	assert.deepEqual(paymentBreakdown({ payment_mode: 'prepaid', order_value: 998, amount_collected: 998 }), { label: 'Prepaid · ₹998', detail: 'Paid online in full' });
	assert.equal(paymentBreakdown({ payment_mode: 'partial', order_value: 3000, amount_collected: null }).detail, 'Split not known');
});

test('back links: same-site paths only', async () => {
	const { safePath, rtoHref } = await import('../src/lib/scan.ts');
	assert.equal(safePath('/rtos?f=call'), '/rtos?f=call');
	assert.equal(safePath('scan'), '/scan');
	assert.equal(safePath('//evil.com'), null);
	assert.equal(safePath('https://evil.com'), null);
	assert.equal(safePath('/rto/abc'), null);
	assert.equal(rtoHref('abc', '/rtos?f=call'), '/rto/abc?from=%2Frtos%3Ff%3Dcall');
});

test('history: Velocity dispute updates', () => {
	const e = (payload: any) => say({ id: 1, source: 'velocity', kind: 'dispute_update', payload, received_at: '' }).text;
	assert.equal(e({ type: 'mdnd', from: null, to: 'raised' }), 'Velocity dispute (MDND) seen: In Review');
	assert.equal(e({ type: 'mdnd', from: 'raised', to: 'approved' }), 'Velocity dispute (MDND): In Review → Approved');
});

test('claim page links: from Scan back to Scan, from RTO page back to that RTO page', () => {
	assert.equal(claimHref('abc', '/scan', { scanned: true, ret: 'from' }), '/rto/abc/claim?from=%2Fscan&scanned=1&ret=from');
	assert.equal(claimReturn('abc', '/scan', 'from'), '/scan');
	assert.equal(claimReturn('abc', '/rtos?f=claims', 'rto'), '/rto/abc?from=%2Frtos%3Ff%3Dclaims');
	assert.equal(claimReturn('abc', 'https://evil.example', 'from'), '/rto/abc');
	assert.equal(claimReturn('abc', '//evil', 'rto'), '/rto/abc');
	const p = withUndo('/rto/abc?from=%2Fscan', 77, '#3379 saved as RTO claim');
	assert.equal(p, '/rto/abc?from=%2Fscan&undo=77&msg=%233379+saved+as+RTO+claim');
	assert.deepEqual(undoFromUrl(new URL(p, 'http://x')), { eventId: 77, text: '#3379 saved as RTO claim' });
	assert.equal(undoFromUrl(new URL('/scan?undo=x', 'http://x')), null);
});
