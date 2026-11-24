import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanForwardClaim, cleanOrderNo, cleanAwb, cleanAmount } from '../src/lib/forward-claims.ts';
import { buildQueue } from '../src/lib/queue.ts';
import { DEFAULT_RULES } from '../src/lib/dashboard.ts';

const TODAY = '2026-11-24';
const base = { courier: 'velocity', order_no: '#Dropy-6770', awb: '7D 1441-82713', reason: 'damaged', channel: 'panel_dispute', claimed_amount: '₹1,379', raised_on: '2026-11-06' };

test('order no., AWB and amount cleaning', () => {
	assert.equal(cleanOrderNo('#Dropy-6770'), '6770');
	assert.equal(cleanOrderNo('Dropy-6770-ALL'), '6770');
	assert.equal(cleanOrderNo('1517-1'), '1517-1');
	assert.equal(cleanOrderNo('6139f'), '6139F');
	assert.equal(cleanOrderNo('hello'), '');
	assert.equal(cleanAwb('7d 1441-82713'), '7D144182713');
	assert.equal(cleanAwb('12'), '');
	assert.equal(cleanAmount('₹1,379.00'), '1379');
	assert.equal(cleanAmount('0'), null);
	assert.equal(cleanAmount('abc'), null);
});

test('a valid delivery claim becomes RPC args', () => {
	const r = cleanForwardClaim(base, TODAY);
	assert.ok(r.ok);
	if (!r.ok) return;
	assert.equal(r.args.order_no, '6770');
	assert.equal(r.args.order_name, 'Dropy-6770');
	assert.equal(r.args.awb, '7D144182713');
	assert.equal(r.args.claimed_amount, '1379');
	assert.equal(r.args.status, 'raised');
	assert.equal(r.args.ticket_ref, undefined);
	const e = cleanForwardClaim({ ...base, status: 'escalated', ticket_ref: '124093' }, TODAY);
	assert.ok(e.ok && e.args.status === 'escalated' && e.args.ticket_ref === '#124093');
});

test('plain-English refusals', () => {
	const err = (x: object) => {
		const r = cleanForwardClaim({ ...base, ...x }, TODAY);
		return r.ok ? '' : r.error;
	};
	assert.match(err({ courier: 'dhl' }), /courier/);
	assert.match(err({ order_no: '' }), /order no/);
	assert.match(err({ awb: '' }), /AWB/);
	assert.match(err({ reason: 'cod_fraud' }), /went wrong/);
	assert.match(err({ channel: 'support_ticket' }), /ticket number/);
	assert.match(err({ claimed_amount: '' }), /amount/);
	assert.match(err({ raised_on: '2026-11-25' }), /today or earlier/);
});

test('queue: a forward claim on a ticket reads "Delivery: Damaged, ticket"', () => {
	const rto = { id: 'f1', courier: 'velocity', kind: 'forward', stage: 'claim', order_no: '6770', order_name: 'Dropy-6770', forward_awb: '7D144182713', order_value: 1379 } as any;
	const claim = { id: 'c1', rto_id: 'f1', reason: 'damaged', status: 'escalated', channel: 'support_ticket', ticket_ref: '#124093', claimed_amount: 1379,
		deadline_at: null, raised_at: '2026-11-24T06:00:00Z', next_follow_up_at: '2026-11-27T06:00:00Z', follow_ups: 0 } as any;
	const q = buildQueue([rto], [claim], {}, DEFAULT_RULES, Date.parse('2026-11-25T06:00:00Z'));
	assert.equal(q.raised.length, 1);
	assert.match(q.raised[0].sub, /^Delivery: Damaged, ticket/);
	assert.equal(q.toRaise.length, 0);
});
