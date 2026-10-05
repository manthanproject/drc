import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skuForms, handleOf, skuMatches, toLink, searchUrl, addressLines } from '../src/lib/products.ts';

test('SKU forms: Velocity form as-is, bare ASIN gets the Dropy- prefix first', () => {
	assert.deepEqual(skuForms('Dropy-B0CWJSFYWT'), ['Dropy-B0CWJSFYWT']);
	assert.deepEqual(skuForms('B000UJPHL8'), ['Dropy-B000UJPHL8', 'B000UJPHL8']);
	assert.deepEqual(skuForms('  '), []);
});

test('handle from a dropy.in search result url', () => {
	assert.equal(handleOf('/products/dr-westin-childs-t2-thyroid-support-cream-lotion?_pos=1&_psq=x'), 'dr-westin-childs-t2-thyroid-support-cream-lotion');
	assert.equal(handleOf('/collections/x'), null);
});

// Shape and values as returned by dropy.in /products/<handle>.js on 5 Oct 2026
const t2 = { handle: 'dr-westin-childs-t2-thyroid-support-cream-lotion', title: 'Dr. Westin Childs T2 Cream Thyroid Support Lotion', featured_image: '//cdn.shopify.com/s/files/1/0589/5431/7904/files/71Jc1tL6blL.jpg?v=1', variants: [{ sku: 'Dropy-B0CWJSFYWT' }] };

test('only an exact SKU match counts as verified', () => {
	assert.equal(skuMatches(t2, 'Dropy-B0CWJSFYWT'), true);
	assert.equal(skuMatches(t2, 'dropy-b0cwjsfywt'), true);
	assert.equal(skuMatches(t2, 'B0CWJSFYWT'), true); // bare ASIN from the old sheet
	assert.equal(skuMatches(t2, 'Dropy-B0CWJSFYWX'), false);
});

test('verified link to the product page with a small https image; otherwise a search link', () => {
	const ok = toLink('Dropy-B0CWJSFYWT', t2);
	assert.equal(ok.url, 'https://dropy.in/products/dr-westin-childs-t2-thyroid-support-cream-lotion');
	assert.equal(ok.image, 'https://cdn.shopify.com/s/files/1/0589/5431/7904/files/71Jc1tL6blL.jpg?v=1&width=120');
	const no = toLink('Dropy-B0FAKE12345', null);
	assert.equal(no.verified, false);
	assert.equal(no.url, searchUrl('Dropy-B0FAKE12345'));
	assert.equal(no.url, 'https://dropy.in/search?q=Dropy-B0FAKE12345&type=product');
});

test('address lines: city/state/PIN only added when not already in the line', () => {
	assert.deepEqual(addressLines({ full_address: 'Flat 2, MG Road, Gulbarga, Karnataka 585102', city: 'Gulbarga', state: 'Karnataka', zip: '585102' }), ['Flat 2, MG Road, Gulbarga, Karnataka 585102']);
	assert.deepEqual(addressLines({ full_address: 'Flat 2, MG Road', city: 'Gulbarga', state: 'Karnataka', zip: '585102' }), ['Flat 2, MG Road', 'Gulbarga, Karnataka 585102']);
	assert.deepEqual(addressLines(null), []);
});

test('ASIN shown without the Dropy- prefix and linked to Amazon.com', async () => {
	const { asinOf, amazonUrl } = await import('../src/lib/products.ts');
	assert.equal(asinOf('Dropy-B0CWJSFYWT'), 'B0CWJSFYWT');
	assert.equal(asinOf('dropy-b0cwjsfywt'), 'B0CWJSFYWT');
	assert.equal(asinOf('B000UJPHL8'), 'B000UJPHL8');
	assert.equal(asinOf('SKU-3048'), null); // not an ASIN → shown as-is, no link
	assert.equal(asinOf(null), null);
	assert.equal(amazonUrl('B0CWJSFYWT'), 'https://www.amazon.com/dp/B0CWJSFYWT');
});
