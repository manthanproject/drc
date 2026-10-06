import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe as say } from '../src/lib/history.ts';
import { REASONS, reasonOf, velocityDisputeType, claimRemarks, isDummyItem, mediaFileName, extOf, dateLong, claimStatus } from '../src/lib/claims.ts';

test('every reason maps to a Velocity dispute type (same mapping as create_rto_claim)', () => {
	const want: Record<string, string> = { wrong: 'wrong_product', damaged: 'damaged', missing: 'missing_items', leak: 'damaged', empty: 'missing_items', near_expiry: 'wrong_product' };
	for (const r of REASONS) {
		assert.equal(r.claimReason, want[r.key], r.key);
		assert.ok(velocityDisputeType(r.claimReason), r.key);
	}
	assert.equal(velocityDisputeType('wrong_product'), 'Wrong Product Received');
	assert.equal(velocityDisputeType('damaged'), 'Damaged Product Received');
	assert.equal(velocityDisputeType('missing_items'), 'Missing items in package');
	assert.equal(velocityDisputeType('mdnd'), 'MDND');
	assert.equal(velocityDisputeType('lost'), null);
	assert.equal(reasonOf('nope'), undefined);
});

test('remarks: order, AWB, delivered date, finding, items, links, value', () => {
	const t = claimRemarks({
		order_no: '3379', forward_awb: '7D139889794', order_value: '3100.4', rto_delivered_at: '2026-10-03T20:30:00Z', received_at: '2026-10-06T06:00:00Z',
		reason: 'wrong', items: [{ title: 'Cream  A ', qty: 1 }, { title: 'Serum B', qty: 2 }],
		links: { packing: 'https://p', unboxing: 'https://u', folder: 'https://f' }
	});
	assert.equal(t, [
		'RTO for order #Dropy-3379 (AWB 7D139889794) was delivered back to our warehouse on 4 Oct 2026. On opening it, we found a different product inside, not the item we shipped.',
		'Affected items: Cream A (qty 1); Serum B (qty 2).',
		'Pre-dispatch packing video with label: https://p',
		'Unboxing video showing all sides and the label: https://u',
		'All photos (front, back, label) and videos: https://f',
		'Claim value ₹3,100 (full order value). Please approve and issue a credit note.'
	].join('\n'));
	assert.ok(!/costech/i.test(t));
});

test('remarks: no courier date → scan date; missing links dropped; suffix order kept', () => {
	const t = claimRemarks({ order_no: '1642-1', forward_awb: 'X1', order_value: 999, rto_delivered_at: null, received_at: '2026-10-06T06:00:00Z',
		reason: 'leak', items: [{ title: 'Toner', qty: 1 }], links: { unboxing: 'https://u' } });
	assert.match(t, /#Dropy-1642-1 \(AWB X1\) was received back at our warehouse on 6 Oct 2026\. On opening it, the product had leaked/);
	assert.match(t, /^Affected item: Toner \(qty 1\)\.$/m);
	assert.ok(!t.includes('packing video'));
	assert.ok(!t.includes('All photos'));
});

test('Pay on Delivery dummy line is not a product', () => {
	assert.equal(isDummyItem({ sku: null, title: 'Pay on Delivery' }), true);
	assert.equal(isDummyItem({ sku: '', title: 'pay on delivery charges' }), true);
	assert.equal(isDummyItem({ sku: 'Dropy-B01', title: 'Pay on Delivery' }), false);
	assert.equal(isDummyItem({ sku: null, title: 'Foaming cleanser sample' }), false);
});

test('media file names are safe and in IST', () => {
	assert.equal(mediaFileName('3379', 'front', 'JPG', Date.parse('2026-10-06T06:12:00Z')), '3379_front_20261006-1142.jpg');
	assert.equal(mediaFileName('1642-1-1', 'unboxing_video', 'webm', Date.parse('2026-10-06T20:00:00Z')), '1642-1-1_unboxing_video_20261007-0130.webm');
	assert.equal(mediaFileName('Krishna 1005/x', 'label', '', 0), 'Krishna_1005_x_label_19700101-0530.bin');
	assert.equal(extOf('IMG_1.HEIC', 'image/heic'), 'heic');
	assert.equal(extOf('blob', 'video/webm;codecs=vp9,opus'), 'webm');
	assert.equal(extOf('', 'image/jpeg'), 'jpg');
	assert.equal(extOf(null, 'video/quicktime'), 'mov');
	assert.equal(dateLong('2026-10-03T19:00:00Z'), '4 Oct 2026');
});

test('claim status words', () => {
	assert.deepEqual(claimStatus('draft'), { label: 'Draft, not raised', tone: 'bad' });
	assert.equal(claimStatus('raised').label, 'Raised');
	assert.equal(claimStatus('weird').label, 'weird');
});

test('history wording for claims', () => {
	const ev = (payload: any) => ({ id: 1, source: 'user', kind: 'stage_change', payload, received_at: '2026-10-06T06:00:00Z' });
	assert.equal(say(ev({ action: 'claim', to: 'claim', claim: { reason: 'wrong', n_items: 1, n_restock: 2 }, args: { scanned: true } })).text,
		'Scanned · RTO claim: Wrong product (1 item), saved as Draft · 2 items to Ready Stock');
	assert.equal(say(ev({ action: 'claim_raised', to: 'claim', args: { ticket_ref: '#106500' } })).text, 'Claim marked raised (ref #106500)');
	assert.equal(say(ev({ action: 'claim_raised', to: 'claim', args: {}, undone: true })).text, 'Claim marked raised (undone)');
});
