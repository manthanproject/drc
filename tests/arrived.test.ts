import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivedCookie, parseArrived, validArrived, arrivedDay, shortDay } from '../src/lib/arrived.ts';

const NOW = Date.parse('2026-10-11T06:00:00Z'); // 11:30 IST, Sun 11 Oct

test('arrived cookie lasts only the day it was set', () => {
	const c = arrivedCookie('2026-10-10', NOW);
	assert.equal(c, '2026-10-11|2026-10-10');
	assert.equal(parseArrived(c, NOW), '2026-10-10');
	assert.equal(parseArrived(c, NOW + 86_400_000), null); // next day → back to Today
	assert.equal(parseArrived('2026-10-11|2026-10-11', NOW), null); // today = no setting
	assert.equal(parseArrived('2026-10-11|2026-10-12', NOW), null); // future
	assert.equal(parseArrived('2026-10-11|2026-09-01', NOW), null); // > 30 days back
	assert.equal(parseArrived('junk', NOW), null);
	assert.equal(parseArrived(undefined, NOW), null);
});

test('validArrived: up to 30 days before the scan day', () => {
	assert.equal(validArrived('2026-10-10', '2026-10-11'), '2026-10-10');
	assert.equal(validArrived('2026-10-11', '2026-10-11'), '2026-10-11');
	assert.equal(validArrived('2026-10-12', '2026-10-11'), null);
	assert.equal(validArrived('2026-09-10', '2026-10-11'), null);
	assert.equal(validArrived('2026-13-01', '2026-10-11'), null);
	assert.equal(validArrived(5, '2026-10-11'), null);
});

test('arrivedDay and shortDay', () => {
	assert.equal(arrivedDay({ received_on: '2026-10-10', scanned_at: '2026-10-11T04:00:00Z' }), '2026-10-10');
	assert.equal(arrivedDay({ received_on: null, scanned_at: '2026-10-10T19:00:00Z' }), '2026-10-11'); // 00:30 IST
	assert.equal(arrivedDay({ scanned_at: null }), null);
	assert.equal(shortDay('2026-10-10'), 'Sat 10 Oct');
});
