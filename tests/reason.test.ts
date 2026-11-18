import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasonLabel, rtoReason } from '../src/lib/reason.ts';

test('known Velocity codes read as plain words', () => {
	assert.equal(reasonLabel('customer_refused_to_accept'), 'Customer refused to accept');
	assert.equal(reasonLabel('consignee_uncontactable'), 'Customer not reachable');
	assert.equal(reasonLabel('cancelled_by_seller_via_panel'), 'Cancelled by us in the courier panel');
	assert.equal(reasonLabel('OTHER'), 'Other (courier gave no detail)');
});

test('unknown codes are turned into a sentence, plain text is kept', () => {
	assert.equal(reasonLabel('shipment_held_at_hub'), 'Shipment held at hub');
	assert.equal(reasonLabel('Consignee unavailable'), 'Consignee unavailable');
	assert.equal(reasonLabel('  '), null);
	assert.equal(reasonLabel(null), null);
});

test('rtoReason: rto_reason first, then NDR reason, never for customer returns', () => {
	assert.equal(rtoReason({ kind: 'rto', rto_reason: 'customer_not_available', ndr_reason: 'address_incomplete' }), 'Customer not available');
	assert.equal(rtoReason({ kind: 'rto', rto_reason: null, ndr_reason: 'address_incomplete' }), 'Address incomplete');
	assert.equal(rtoReason({ kind: 'rto', rto_reason: '', ndr_reason: null }), null);
	assert.equal(rtoReason({ kind: 'customer_return', rto_reason: 'other' }), null);
	assert.equal(rtoReason(null), null);
});

import { readFileSync } from 'node:fs';
import { exactReason, tidyActivity } from '../src/lib/reason.ts';

// Real Velocity /order-tracking activities (18 Nov 2026): #1708-2 (Amazon) and #6709 (DTDC)
const FIX = JSON.parse(readFileSync(new URL('./fixtures-velocity-tracking.json', import.meta.url), 'utf8'));

test('exactReason: Amazon #1708-2 → recipient refused, before the first return scan', () => {
	const r = exactReason(FIX['372181028419'])!;
	assert.equal(r.text, 'Recipient refused to accept the shipment and provided verification');
	assert.equal(r.at, '2026-09-07 18:23:01');
	assert.deepEqual(r.earlier.map((e) => e.text), ['Delivery was attempted but unsuccessful']);
});

test('exactReason: DTDC #6709 → receiver refused, earlier door lock; misroutes ignored', () => {
	const r = exactReason(FIX['7D144181238'])!;
	assert.equal(r.text, 'Receiver refused delivery');
	assert.equal(r.at, '2026-11-02 15:17:00');
	assert.equal(r.location, 'KONDIVITA LANE, MUMBAI');
	assert.deepEqual(r.earlier.map((e) => e.text), ['Office closed or door lock']);
});

test('exactReason: nothing usable → null; tidyActivity cleans codes and caps', () => {
	assert.equal(exactReason([{ date: '2026-11-01 10:00:00', activity: 'In Transit' }, { date: '2026-11-02 10:00:00', activity: 'Return - Delivered' }]), null);
	assert.equal(exactReason(null), null);
	assert.equal(tidyActivity('RECEIVER REFUSED DELIVERY(CIR)'), 'Receiver refused delivery');
	assert.equal(tidyActivity('Consignee not available.'), 'Consignee not available');
});
