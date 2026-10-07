import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, windowNote } from '../src/lib/queue.ts';
import { DEFAULT_RULES, type Rto } from '../src/lib/dashboard.ts';

const NOW = Date.parse('2026-10-07T07:30:00Z');
const H = 3_600_000;
const iso = (hAgo: number) => new Date(NOW - hAgo * H).toISOString();
const rto = (id: string, p: Partial<Rto & { scanned_at: string | null }> = {}) =>
	({ id, courier: 'velocity', carrier_name: 'DTDC', order_no: id, order_name: null, forward_awb: `A${id}`, rto_awb: null, scanned_code: null,
		payment_mode: 'cod', order_value: 1000, customer_name: null, customer_phone10: null, stage: 'awaiting_receipt', courier_status: 'rto_delivered',
		rto_delivered_at: iso(60), last_movement_at: null, last_event_at: null, legacy_source: null, scanned_at: null, ...p }) as Rto & { scanned_at: string | null };
const claim = (id: string, rto_id: string, p: Record<string, unknown> = {}) =>
	({ id, rto_id, reason: 'wrong_product', status: 'draft', ticket_ref: null, claimed_amount: 2000, deadline_at: new Date(NOW + 3 * 24 * H).toISOString(), raised_at: null, description: 'x', created_at: iso(1), ...p });

test('queue: drafts + MDND candidates, most urgent first; raised listed separately', () => {
	const rtos = [
		rto('1', { stage: 'claim' }),                        // draft claim, media 3 of 4
		rto('2', { stage: 'claim', order_value: 5000 }),     // MDND draft, closes sooner
		rto('3', { rto_delivered_at: iso(60), order_value: 3000 }), // MDND candidate: 2.5 d → 4 d left
		rto('4', { rto_delivered_at: iso(20) }),             // < 48 h: not yet
		rto('5', { rto_delivered_at: iso(24 * 9) }),         // window closed → older
		rto('6', { rto_delivered_at: null }),                // no date → older
		rto('7', { reship_state: 'pending' }),               // probably re-shipped → not MDND
		rto('8', { stage: 'claim', disputes: [{ id: 'd', status: 'raised', dispute_type: 'mdnd', raised_at: '2026-10-04T14:24:00Z' }] }),
		rto('9', { scanned_at: iso(2) })                     // scanned: not MDND
	];
	const claims = [
		claim('c1', '1'),
		claim('c2', '2', { reason: 'mdnd', deadline_at: new Date(NOW + 10 * H).toISOString(), claimed_amount: 5000 }),
		claim('c8', '8', { reason: 'mdnd', status: 'raised', raised_at: '2026-10-04T14:24:00Z', ticket_ref: '#106500' }),
		claim('cx', '1', { status: 'closed' })
	];
	const q = buildQueue(rtos, claims, { '1': 3 }, DEFAULT_RULES, NOW);
	assert.deepEqual(q.toRaise.map((r) => [r.label, r.kind, r.sub, r.pill.label]), [
		['#2', 'draft', 'MDND · window closes today', 'Ready'],
		['#1', 'draft', 'Wrong product · 3 d left', 'Media 3 of 4'],
		['#3', 'mdnd', 'Not received (MDND) · 4 d left', 'Draft it']
	]);
	assert.deepEqual(q.raised.map((r) => [r.label, r.sub, r.pill.label]), [['#8', 'MDND · raised 4 Oct · #106500', 'In Review']]);
	assert.equal(q.olderNotReceived, 2);
	assert.deepEqual(q.totals, { n: 3, value: 5000 + 2000 + 3000 });
});

test('window note', () => {
	assert.equal(windowNote(null, NOW), 'no window date');
	assert.equal(windowNote(NOW - 1, NOW), 'window closed');
	assert.equal(windowNote(NOW + 5 * H, NOW), 'window closes today');
	assert.equal(windowNote(NOW + 49 * H, NOW), '2 d left');
});
