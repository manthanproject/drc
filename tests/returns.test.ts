import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapReturn, velocityRefunded } from '../src/lib/returns-map.ts';

// shapes from the real probe (11 Oct 2026), customer details replaced
const delivered = { id: 'r1', type: 'return', attributes: {
	display_id: 'Dropy-5301-ALL-R1', status: 'delivered', refund_status: 'pending', return_reason: 'Received wrong item', total_price: '2009.0',
	is_exchange: false, request_date: '2026-10-04T14:48:45.170+05:30', pii_masked: false,
	shipping_address: { name: 'Test Name', phone: '+91 98765 43210' },
	return_items: [{ quantity: 1, price: '2009.0', name: 'White Flower Balm', sku: 'Dropy-B0X' }],
	shipment: { tracking_number: '39879817355386', status: 'return_delivered', carrier: { name: 'Delhivery Standard 250G' }, shipment_milestones: [
		{ milestone: 'return_pickup_scheduled', milestone_at: '2026-10-04T14:48:50.072+05:30' },
		{ milestone: 'expected_pickup_date', milestone_at: '2026-10-05T23:59:59.999+05:30' },
		{ milestone: 'original_expected_delivery_date', milestone_at: '2026-10-10T23:59:59.999+05:30' },
		{ milestone: 'return_in_transit', milestone_at: '2026-10-04T16:00:29.002+05:30' },
		{ milestone: 'return_delivered', milestone_at: '2026-10-10T15:43:49.840+05:30' }
	] },
	order: { display_id: 'Dropy-5301-ALL', external_id: 'Dropy-5301-ALL' } } };

test('delivered return: order no, AWB, delivered time, last event, items', () => {
	const m = mapReturn(delivered);
	assert.equal(m.order_no, '5301');
	assert.equal(m.awb, '39879817355386');
	assert.equal(m.return_id, 'Dropy-5301-ALL-R1');
	assert.equal(m.status, 'delivered');
	assert.equal(m.courier_status, 'return_delivered');
	assert.equal(m.carrier_name, 'Delhivery Standard 250G');
	assert.equal(m.order_value, 2009);
	assert.equal(m.delivered_at, '2026-10-10T10:13:49.840Z');
	assert.equal(m.last_event_text, 'Delivered to warehouse');
	assert.equal(m.customer_phone10, '9876543210');
	assert.equal(m.return_reason, 'Received wrong item');
	assert.deepEqual(m.items, [{ sku: 'Dropy-B0X', name: 'White Flower Balm', qty: 1, price: 2009 }]);
	assert.deepEqual(m.raw, { refund_status: 'pending', status: 'delivered', return_id: 'Dropy-5301-ALL-R1', reason: 'Received wrong item', pickup_fails: 0, is_exchange: false });
});

test('failed pickups are counted; planned dates never count as the last event', () => {
	const m = mapReturn({ attributes: { status: 'not_picked', display_id: 'Dropy-4963-ALL-R1', order: { display_id: 'Dropy-4963-ALL' },
		shipment: { tracking_number: '253897460004038', status: 'return_not_picked', shipment_milestones: [
			{ milestone: 'return_not_picked', milestone_at: '2026-10-07T13:56:00+05:30' },
			{ milestone: 'return_not_picked', milestone_at: '2026-10-09T13:07:00+05:30' },
			{ milestone: 'expected_pickup_date', milestone_at: '2026-10-12T23:59:59+05:30' },
			{ milestone: 'return_pickup_scheduled', milestone_at: '2026-10-08T10:29:11+05:30' }
		] } } });
	assert.equal(m.last_event_text, 'Pickup failed (2 tries)');
	assert.equal(m.raw.pickup_fails, 2);
	assert.equal(m.delivered_at, null);
	assert.equal(m.order_no, '4963');
});

test('order numbers: "#Dropy-3012", "Dropy-5301"; new return with no AWB yet; masked details stay empty', () => {
	assert.equal(mapReturn({ attributes: { order: { display_id: '#Dropy-3012' } } }).order_no, '3012');
	assert.equal(mapReturn({ attributes: { order: { display_id: 'Dropy-5301' } } }).order_no, '5301');
	const n = mapReturn({ attributes: { status: 'new', order: { display_id: 'Dropy-4236-ALL' } } });
	assert.equal(n.awb, '');
	assert.equal(n.courier_status, 'return_new');
	const p = mapReturn({ attributes: { pii_masked: true, shipping_address: { name: 'Ra****', phone: '98XXXXXX10' } } });
	assert.equal(p.customer_name, null);
	assert.equal(p.customer_phone10, null);
});

test('Velocity refund paid or approved needs a look; pending does not', () => {
	assert.equal(velocityRefunded('pending'), false);
	assert.equal(velocityRefunded(null), false);
	assert.equal(velocityRefunded('approved'), true);
	assert.equal(velocityRefunded('processed'), true);
});

test('returns screen: tabs, late arrivals, failing pickups, refunds to do, Velocity refunds', async () => {
	const { groupReturns, retStatusText } = await import('../src/lib/returns.ts');
	const now = Date.parse('2026-10-11T12:00:00+05:30');
	const base = { courier_status: null, rto_delivered_at: null, scanned_at: null, vref: 'pending', refund: null };
	const list = [
		{ ...base, id: 'a', stage: 'awaiting_receipt', rto_delivered_at: '2026-10-08T10:00:00+05:30' }, // late
		{ ...base, id: 'b', stage: 'awaiting_receipt', rto_delivered_at: '2026-10-11T09:00:00+05:30' },
		{ ...base, id: 'c', stage: 'in_flight', courier_status: 'return_not_picked' },
		{ ...base, id: 'd', stage: 'in_flight', courier_status: 'return_in_transit' },
		{ ...base, id: 'e', stage: 'hold', refund: { status: 'on_hold', amount: 500 } },
		{ ...base, id: 'f', stage: 'ready_stock', refund: { status: 'to_refund', amount: 2009 } },
		{ ...base, id: 'g', stage: 'ready_stock', refund: { status: 'done', amount: 700 }, vref: 'approved' },
		{ ...base, id: 'h', stage: 'closed' }
	];
	const g = groupReturns(list, now);
	assert.deepEqual(Object.fromEntries(Object.entries(g.tabs).map(([k, v]) => [k, v.map((x) => x.id)])), { arrived: ['a', 'b'], coming: ['c', 'd'], hold: ['e'], done: ['f', 'g', 'h'] });
	assert.equal(g.late, 1);
	assert.equal(g.failing, 1);
	assert.equal(g.refundToDo, 2);
	assert.deepEqual(g.velocityPaid.map((x) => x.id), ['g']);
	assert.equal(retStatusText('return_not_picked'), 'Pickup failed');
});
