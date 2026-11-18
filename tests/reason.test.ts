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
