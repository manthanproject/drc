import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickReship, orderNoOf, searchTermFor } from '../src/lib/reship.ts';

// Real Velocity /shipments search replies (PII masked by the probe), 5 Oct 2026
const rows = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/velocity-search-${f}.json`, import.meta.url), 'utf8')).sample;
const s3544 = rows('p1'), s4042 = rows('p2'), s1642 = rows('p3');

test('order numbers from display ids', () => {
	assert.equal(orderNoOf('#Dropy-3544-1'), '3544-1');
	assert.equal(orderNoOf('#Dropy-1642-1-1'), '1642-1-1');
	assert.equal(searchTermFor('1642-1'), '1642');
});

test('3544: RTO back 30 Sep 12:07, re-ship 3544-1 created 14:56 same SKU → match', () => {
	const m = pickReship({ order_no: '3544', rto_delivered_at: '2026-09-30T12:07:00+05:30', skus: ['Dropy-B0CWJSFYWT'] }, s3544);
	assert.equal(m?.reship_order_no, '3544-1');
	assert.equal(m?.reship_awb, 'TEST000001');
	assert.equal(m?.reship_courier_status, 'delivered');
});

test('re-ship created BEFORE the RTO came back is not proof', () => {
	assert.equal(pickReship({ order_no: '3544', rto_delivered_at: '2026-10-01T10:00:00+05:30', skus: ['Dropy-B0CWJSFYWT'] }, s3544), null);
});

test('different product is not proof', () => {
	assert.equal(pickReship({ order_no: '3544', rto_delivered_at: '2026-09-30T12:07:00+05:30', skus: ['Dropy-OTHER'] }, s3544), null);
});

test('no SKUs on the RTO → never suggest', () => {
	assert.equal(pickReship({ order_no: '3544', rto_delivered_at: '2026-09-30T12:07:00+05:30', skus: [] }, s3544), null);
});

test('chains: 1642-1 (back 9 Sep) → 1642-1-1, and 1642-1-1 itself has no child', () => {
	const skus1642 = s1642.flatMap((r: any) => r.attributes.items.map((i: any) => i.sku)).filter(Boolean);
	const m = pickReship({ order_no: '1642-1', rto_delivered_at: '2026-09-09T22:07:00+05:30', skus: skus1642 }, s1642);
	assert.equal(m?.reship_order_no, '1642-1-1');
	assert.equal(pickReship({ order_no: '1642-1-1', rto_delivered_at: '2026-09-28T15:57:31+05:30', skus: skus1642 }, s1642), null);
});

test('only one level deeper: 1642 does not match its grandchild 1642-1-1', () => {
	const skus = s1642.flatMap((r: any) => r.attributes.items.map((i: any) => i.sku)).filter(Boolean);
	const m = pickReship({ order_no: '1642', rto_delivered_at: '2026-08-01T00:00:00+05:30', skus }, s1642);
	assert.equal(m?.reship_order_no, '1642-1');
});

test('4042-1 is ignored by the caller (4042 was delivered, never an RTO); SKU rule still applies', () => {
	// If 4042 had been an RTO back on 30 Sep with only the TP-Link SKU, the 4042-1 shipment (other SKU) is not proof
	assert.equal(pickReship({ order_no: '4042', rto_delivered_at: '2026-09-30T00:00:00+05:30', skus: ['Dropy-B0829KDY9X'] }, s4042), null);
});

test('cancelled or rejected re-ship is not proof (1990-1, 1543-1)', () => {
	const row = (status: string) => ({ attributes: { order: { display_id: '#Dropy-1990-1' }, created_at: '2026-08-31T17:44:00+05:30', status, tracking_number: 'T', items: [{ sku: 'S1' }] } });
	const rto = { order_no: '1990', rto_delivered_at: '2026-08-30T10:00:00+05:30', skus: ['S1'] };
	assert.equal(pickReship(rto, [row('cancelled')]), null);
	assert.equal(pickReship(rto, [row('rejected')]), null);
	assert.equal(pickReship(rto, [row('not_picked')])?.reship_order_no, '1990-1'); // booked + packed counts
});
