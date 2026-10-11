import { test } from 'node:test';
import assert from 'node:assert/strict';
import { srDate, srStatus, isRtoStatus, normalizeOrderNo, mapShiprocketOrder, trackingData } from '../src/lib/shiprocket-map.ts';
import { trackingUrl, type Rto } from '../src/lib/dashboard.ts';

test('Shiprocket dates are IST', () => {
	assert.equal(srDate('2026-10-09 14:02:00'), '2026-10-09T08:32:00.000Z');
	assert.equal(srDate('09 Oct 2026, 02:02 PM'), '2026-10-09T08:32:00.000Z');
	assert.equal(srDate('09 Oct 2026, 12:05 AM'), '2026-10-08T18:35:00.000Z');
	assert.equal(srDate('9 Oct 2026'), '2026-10-08T18:30:00.000Z');
	assert.equal(srDate('2026-10-09T08:32:00Z'), '2026-10-09T08:32:00.000Z');
	assert.equal(srDate(''), null);
	assert.equal(srDate('0000-00-00 00:00:00'), null);
	assert.equal(srDate('NA'), null);
});

test('status text → DRC status; only RTO and lost orders are tracked', () => {
	assert.equal(srStatus('RTO DELIVERED'), 'rto_delivered');
	assert.equal(srStatus('RTO ACKNOWLEDGED'), 'rto_delivered');
	assert.equal(srStatus('RTO INITIATED'), 'rto_initiated');
	assert.equal(srStatus('RTO_OFD'), 'rto_out_for_delivery');
	assert.equal(srStatus('RTO IN TRANSIT'), 'rto_in_transit');
	assert.equal(srStatus('RTO NDR'), 'rto_ndr');
	assert.equal(srStatus('LOST'), 'lost');
	assert.equal(srStatus('DAMAGED'), 'lost');
	assert.equal(srStatus('RTO LOST'), 'rto_lost');
	for (const s of ['RTO DELIVERED', 'RTO_IN_TRANSIT', 'rto initiated', 'LOST', 'DAMAGED']) assert.ok(isRtoStatus(s), s);
	for (const s of ['DELIVERED', 'IN TRANSIT', 'RETURN DELIVERED', 'RETURN PENDING', 'CANCELED', 'NEW', '']) assert.ok(!isRtoStatus(s), s);
});

test('order numbers match the Velocity rule', () => {
	assert.equal(normalizeOrderNo('#Dropy-4410'), '4410');
	assert.equal(normalizeOrderNo('Dropy-5000-ALL'), '5000');
	assert.equal(normalizeOrderNo('4410'), '4410');
});

const order = {
	id: 901, channel_order_id: 'Dropy-5201', status: 'RTO DELIVERED', created_at: '01 Oct 2026, 10:00 AM', updated_at: '09 Oct 2026, 03:00 PM',
	customer_name: 'Asha K', customer_phone: '+91 98765 43210', total: '1,499.00', payment_method: 'COD',
	products: [{ name: 'Jade roller', channel_sku: 'JR1', quantity: 1, selling_price: '1499' }, { name: 'Free pouch', channel_sku: 'GIFT', quantity: 1, selling_price: '0' }],
	shipments: [{ id: 77, awb: 'SR123456789', courier: 'Delhivery Surface' }]
};
const tracking = {
	tracking_data: {
		shipment_track: [{ awb_code: 'SR123456789', current_status: 'RTO DELIVERED', delivered_date: '2026-10-09 14:02:00' }],
		shipment_track_activities: [
			{ date: '2026-10-09 14:02:00', activity: 'RTO Delivered', location: 'Vashi', 'sr-status-label': 'RTO DELIVERED' },
			{ date: '2026-10-07 09:00:00', activity: 'In transit', location: 'Bhiwandi', 'sr-status-label': 'RTO IN TRANSIT' },
			{ date: '2026-10-04 18:00:00', activity: 'RTO Initiated', location: 'Pune', 'sr-status-label': 'RTO INITIATED' }
		]
	}
};

test('maps an RTO-delivered order with its tracking', () => {
	const m = mapShiprocketOrder(order, tracking);
	assert.equal(m.awb, 'SR123456789');
	assert.equal(m.order_no, '5201');
	assert.equal(m.status, 'rto_delivered');
	assert.equal(m.sub_status, 'RTO DELIVERED');
	assert.equal(m.carrier_name, 'Delhivery Surface');
	assert.equal(m.payment_mode, 'cod');
	assert.equal(m.order_value, 1499);
	assert.equal(m.amount_collected, 0);
	assert.equal(m.customer_phone10, '9876543210');
	assert.equal(m.rto_delivered_at, '2026-10-09T08:32:00.000Z');
	assert.equal(m.last_event_at, '2026-10-09T08:32:00.000Z');
	assert.equal(m.last_event_location, 'Vashi');
	assert.equal(m.shipment_id, '77');
	assert.deepEqual(m.items.map((i) => [i.sku, i.price]), [['JR1', 1499], ['GIFT', 0]]);
});

test('no tracking: falls back to order dates; in-transit has no delivered time', () => {
	const m = mapShiprocketOrder({ ...order, status: 'RTO IN TRANSIT', payment_method: 'prepaid' });
	assert.equal(m.status, 'rto_in_transit');
	assert.equal(m.rto_delivered_at, null);
	assert.equal(m.last_event_at, '2026-10-09T09:30:00.000Z');
	assert.equal(m.amount_collected, 1499);
	const d = mapShiprocketOrder({ ...order, shipments: [{ awb: 'X1', rto_delivered_date: '2026-10-08 11:00:00' }] });
	assert.equal(d.rto_delivered_at, '2026-10-08T05:30:00.000Z');
});

test('tracking that says RTO delivered wins over a lagging order status; tracking of another AWB is ignored', () => {
	assert.equal(mapShiprocketOrder({ ...order, status: 'RTO IN TRANSIT' }, tracking).status, 'rto_delivered');
	const other = mapShiprocketOrder({ ...order, status: 'RTO IN TRANSIT', shipments: [{ awb: 'OTHER1' }] }, tracking);
	assert.equal(other.status, 'rto_in_transit');
	assert.equal(other.rto_delivered_at, null);
	assert.equal(other.last_event_location, null);
});

test('masked customer details (no PII access) stay empty', () => {
	const m = mapShiprocketOrder({ ...order, customer_name: 'Ra****', customer_phone: '98XXXXXX10' });
	assert.equal(m.customer_name, null);
	assert.equal(m.customer_phone10, null);
	assert.equal(mapShiprocketOrder({ ...order, customer_phone: '******3210' }).customer_phone10, null);
	assert.equal(mapShiprocketOrder({ ...order, customer_name: 'Alex Rao' }).customer_name, 'Alex Rao');
});

test('items with no price are not gifts; tracking keyed by AWB is read', () => {
	const m = mapShiprocketOrder({ ...order, products: [{ name: 'A', quantity: 1 }, { name: 'B', quantity: 1 }] });
	assert.deepEqual(m.items.map((i) => i.price), [749.5, 749.5]);
	assert.ok(trackingData({ SR123456789: tracking }).shipment_track);
	assert.equal(mapShiprocketOrder({ status: 'RTO DELIVERED' }).awb, '');
});

test('Shiprocket rows open the Shiprocket tracking page', () => {
	assert.equal(trackingUrl({ courier: 'shiprocket', forward_awb: 'SR1', legacy_source: null } as unknown as Rto), 'https://shiprocket.co/tracking/SR1');
});

test('Home warning names the login problem in plain words', async () => {
	const { shiprocketWarning } = await import('../src/lib/dashboard.ts');
	assert.match(shiprocketWarning('Shiprocket login failed (HTTP 403): User blocked due to too many failed login attempts.'), /blocked/);
	assert.match(shiprocketWarning('Shiprocket login failed (HTTP 403): Invalid email and password combination'), /SHIPROCKET_PASSWORD/);
	assert.match(shiprocketWarning('Shiprocket /orders page 1: HTTP 502'), /retries/);
});
