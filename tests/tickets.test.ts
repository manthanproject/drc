import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTickets, ticketText, ticketSub, ticketPill, cleanTicketRef, placeText, type TicketRto } from '../src/lib/tickets.ts';
import { DEFAULT_RULES, needsAction, rowFor, actionGroup, actionWhat, type Claim } from '../src/lib/dashboard.ts';
import { buildQueue } from '../src/lib/queue.ts';
import { describe as say } from '../src/lib/history.ts';

const NOW = Date.parse('2026-10-07T07:30:00Z');
const DAY = 86_400_000;
const iso = (dAgo: number) => new Date(NOW - dAgo * DAY).toISOString();
const rto = (id: string, p: Partial<TicketRto> = {}) =>
	({ id, courier: 'velocity', carrier_name: 'DTDC Standard', order_no: id, order_name: null, forward_awb: `7D${id}`, rto_awb: null, scanned_code: null,
		payment_mode: 'cod', order_value: 1000, customer_name: null, customer_phone10: null, stage: 'in_flight', courier_status: 'rto_in_transit',
		rto_delivered_at: null, last_movement_at: null, last_event_at: null, legacy_source: null, scanned_at: null, ...p }) as TicketRto;

const RTOS = [
	rto('1146', { last_movement_at: iso(91), order_value: 3250, last_event_text: 'RTO In Transit', last_event_location: 'DELHI  HUB ,DELHI' }),
	rto('1595', { last_movement_at: iso(42), order_value: 900, last_event_text: '261', last_event_location: ' , ' }), // DTDC raw code + empty place: hidden
	rto('2001', { last_movement_at: iso(6.9) }), // 6 d: not yet (7)
	rto('2002', { last_movement_at: null }), // no date: can't tell
	rto('3082', { stage: 'lost', last_movement_at: iso(19), order_value: 3977, carrier_name: 'Delhivery' }),
	rto('2529', { stage: 'awaiting_receipt', rto_delivered_at: '2026-08-22T15:31:00Z', order_value: 998 }), // window closed
	rto('3946', { stage: 'awaiting_receipt', rto_delivered_at: iso(3) }), // inside window → panel MDND, not ticket
	rto('1098', { stage: 'awaiting_receipt', rto_delivered_at: null, order_value: 1950 }), // no date → ticket
	rto('2954', { stage: 'awaiting_receipt', rto_delivered_at: iso(30), reship_state: 'pending' }), // probably re-shipped
	rto('3100', { stage: 'awaiting_receipt', rto_delivered_at: iso(30), scanned_at: iso(1) }), // scanned
	rto('4000', { stage: 'in_flight', last_movement_at: iso(20), courier: 'shiprocket' }),
	rto('5000', { last_movement_at: iso(20) }), // has an open claim already
	rto('sheet', { forward_awb: null, legacy_source: 'sheet', stage: 'awaiting_receipt', courier: null }),
	rto('Praveen', { stage: 'awaiting_receipt', rto_delivered_at: null, order_value: 32867.72 })
];
const CLAIMS = [{ rto_id: '5000', status: 'raised' }, { rto_id: '1595', status: 'closed' }];

test('tickets: stuck 7+ d, lost, not received after the window; grouped per courier; open claims skipped', () => {
	const g = buildTickets(RTOS, CLAIMS, DEFAULT_RULES, NOW);
	assert.deepEqual(g.map((x) => x.courier), ['velocity', 'shiprocket']);
	assert.deepEqual(g[0].rows.map((r) => [r.label, r.kind]), [
		['#1146', 'stuck'], ['#1595', 'stuck'], ['#3082', 'lost'], ['Praveen', 'not_received'], ['#1098', 'not_received'], ['#2529', 'not_received']
	]);
	assert.equal(g[0].value, 3250 + 900 + 3977 + 32867.72 + 1950 + 998);
	assert.deepEqual(g[1].rows.map((r) => r.label), ['#4000']);
	const [a, , l, p, n, m] = g[0].rows;
	assert.equal(ticketSub(a), 'No movement for 91 d · DTDC · RTO In Transit');
	assert.equal(ticketSub(l), 'Courier says lost 18 Sep 2026 · Delhivery');
	assert.equal(ticketSub(n), 'Marked delivered (no date), never arrived · DTDC');
	assert.equal(ticketSub(m), 'Marked delivered 45 d ago, never arrived · DTDC');
	assert.deepEqual(ticketPill(a), { label: 'Likely lost', tone: 'bad' });
	assert.equal(p.orderName, 'Praveen');
	assert.equal(p.nonDropy, true);
	assert.equal(a.lastPlace, 'DELHI HUB, DELHI');
	// setting can be changed: 5 days catches #2001
	assert.ok(buildTickets(RTOS, CLAIMS, { ...DEFAULT_RULES, stuckDays: 5 }, NOW)[0].rows.some((r) => r.label === '#2001'));
});

test('ticket text: sections only for kinds present, numbered lines, asks, total; no company name', () => {
	const rows = buildTickets(RTOS, CLAIMS, DEFAULT_RULES, NOW)[0].rows.filter((r) => ['#1146', '#3082', '#2529'].includes(r.label));
	const t = ticketText(rows, 7);
	assert.equal(t.subject, 'RTO stuck in transit / marked lost / marked delivered, not received: 3 shipments | Dropy');
	assert.equal(t.body, [
		'Hi Team,',
		'',
		'Please help with the RTO shipments below. They have not come back to our warehouse.',
		'',
		'A. RTO stuck in transit: no tracking update for 7+ days',
		'1. #Dropy-1146 | AWB 7D1146 (DTDC) | last update 8 Jul 2026: "RTO In Transit" at DELHI HUB, DELHI (91 days ago) | ₹3,250',
		'',
		'B. Marked lost by the courier',
		'1. #Dropy-3082 | AWB 7D3082 (Delhivery) | marked lost 18 Sep 2026 | ₹3,977',
		'',
		'C. Marked "RTO Delivered", but never received at our warehouse',
		'1. #Dropy-2529 | AWB 7D2529 (DTDC) | marked delivered 22 Aug 2026 at 9:01 pm (45 days ago) | ₹998',
		'',
		'What we need within 48 hours:',
		'- A: Trace each shipment and deliver it back to our warehouse, or confirm it as lost and settle it for the order value shown.',
		'- B: Settle each claim for the order value shown and share the credit note number for each AWB.',
		'- C: Share the POD for each AWB (receiver signature, delivery photo, receiver name and ID). If there is no POD, treat it as lost and settle it for the order value shown.',
		'',
		'Total order value: ₹8,225 across 3 shipments. Pre-dispatch packing videos are available for every shipment if needed.',
		'',
		'Thanks & Regards,',
		'Team Dropy',
		'support@dropy.in'
	].join('\n'));
	assert.ok(!/costech/i.test(t.body));

	const one = ticketText(rows.slice(0, 1), 7);
	assert.equal(one.subject, 'RTO stuck in transit: AWB 7D1146 | #Dropy-1146');
	assert.match(one.body, /^Please help with the RTO shipment below\. It has not come back/m);
	assert.match(one.body, /^RTO stuck in transit: no tracking update for 7\+ days$/m, 'no letter when one section');
	assert.match(one.body, /^- Trace each shipment/m);
});

test('raw courier status codes are not shown as the last update', () => {
	const g = buildTickets(RTOS, CLAIMS, DEFAULT_RULES, NOW)[0].rows;
	assert.equal(ticketSub(g.find((r) => r.label === '#1595')!), 'No movement for 42 d · DTDC');
	assert.match(ticketText(g.filter((r) => r.label === '#1595'), 7).body, /\| last update 26 Aug 2026 \(42 days ago\) \|/);
});

test('place clean-up', () => {
	assert.equal(placeText('DELHI  HUB ,DELHI'), 'DELHI HUB, DELHI');
	assert.equal(placeText(' , '), null);
	assert.equal(placeText(','), null);
	assert.equal(placeText('VASHI BRANCH , MUMBAI,'), 'VASHI BRANCH, MUMBAI');
	assert.equal(placeText(null), null);
});

test('ticket ref clean-up', () => {
	assert.equal(cleanTicketRef(' #106373 '), '#106373');
	assert.equal(cleanTicketRef('106373'), '#106373');
	assert.equal(cleanTicketRef('# 106373'), '#106373');
	assert.equal(cleanTicketRef('SR-55 '), 'SR-55');
	assert.equal(cleanTicketRef('  '), '');
	assert.equal(cleanTicketRef(null), '');
});

test('needs action: stuck parcels flagged "Likely lost"; parcels on a ticket are not asked about again', () => {
	const claims: Claim[] = [{ id: 'c', rto_id: '2529', reason: 'mdnd', status: 'raised', deadline_at: null, approved_at: null, outstanding: 998 }];
	const items = needsAction(RTOS, claims, DEFAULT_RULES, NOW);
	const stuck = items.find((i) => i.key === 'stuck-1146')!;
	assert.equal(stuck.title, '#1146 likely lost');
	assert.equal(stuck.detail, 'No movement since 8 Jul (RTO In Transit), raise a ticket');
	assert.equal(stuck.ageDays, 91);
	assert.equal(stuck.tone, 'bad');
	assert.equal(actionGroup(stuck), 'lost');
	assert.equal(actionWhat(stuck), 'Likely lost');
	assert.ok(!items.some((i) => i.key === 'stuck-2001'), '6 days is not stuck yet');
	assert.ok(!items.some((i) => i.rto?.id === '2529'), 'ticketed parcel left out');
	assert.ok(items.some((i) => i.key === 'nd-1098'), 'others still listed');
	assert.equal(rowFor(RTOS[0], NOW, DEFAULT_RULES).ageText, 'Last move 8 Jul · 91 d ago · likely lost');
	assert.equal(rowFor(RTOS[2], NOW, DEFAULT_RULES).ageText, 'Last move 30 Sep · 6 d ago');
});

test('queue: ticket claims show as "Lost, ticket" with DRC status, not the panel dispute', () => {
	const r = rto('3082', { stage: 'lost', disputes: [{ id: 'd', status: 'rejected', dispute_type: 'mdnd', raised_at: '2026-09-01T00:00:00Z' }] });
	const q = buildQueue([r], [{ id: 'c', rto_id: '3082', reason: 'lost', status: 'raised', channel: 'support_ticket', ticket_ref: '#106373', claimed_amount: 3977,
		deadline_at: null, raised_at: '2026-10-05T06:30:00Z', description: 'x', created_at: '2026-10-07T06:00:00Z' }], {}, DEFAULT_RULES, NOW);
	assert.deepEqual(q.raised.map((x) => [x.sub, x.pill.label]), [['Lost, ticket · raised 5 Oct · #106373', 'Raised']]);
});

test('history wording for tickets', () => {
	const ev = (payload: any) => ({ id: 1, source: 'user', kind: 'stage_change', payload, received_at: '2026-10-07T06:00:00Z' });
	assert.equal(say(ev({ action: 'ticket_raised', from: 'in_flight', to: 'in_flight', args: { ticket_ref: '#106373', reason: 'lost', parcels: 3 } })).text,
		'Courier ticket #106373 raised: lost or stuck (3 parcels on this ticket)');
	assert.equal(say(ev({ action: 'ticket_raised', args: { ticket_ref: '#1', reason: 'mdnd', parcels: 1 }, undone: true })).text,
		'Courier ticket #1 raised: not received (undone)');
});
