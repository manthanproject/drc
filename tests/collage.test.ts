import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collageLayout, fitInside, stampLines, stampTime, TILE } from '../src/lib/collage.ts';

test('collage layout: 7 tiles, label double width, nothing overlaps or leaves the canvas', () => {
	const L = collageLayout();
	assert.equal(L.tiles.length, 7);
	assert.equal(L.tiles[0].w, TILE * 2 + 10);
	for (const t of L.tiles) assert.ok(t.x >= 0 && t.y > L.header.y + L.header.h && t.x + t.w <= L.width && t.y + t.h <= L.height);
	for (let i = 0; i < 7; i++)
		for (let j = i + 1; j < 7; j++) {
			const a = L.tiles[i], b = L.tiles[j];
			assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${i} overlaps ${j}`);
		}
	assert.ok(L.width * L.height < 2_600_000); // ~2.3 MP: a small JPEG
});

test('photos fit inside their tile without cropping', () => {
	const box = { x: 0, y: 0, w: 500, h: 500 };
	assert.deepEqual(fitInside(4000, 3000, box), { x: 0, y: 63, w: 500, h: 375 });
	assert.deepEqual(fitInside(1080, 1920, box), { x: 110, y: 0, w: 281, h: 500 });
});

test('stamp lines', () => {
	const now = Date.parse('2026-10-15T07:01:00Z');
	assert.equal(stampTime(now), '15 Oct 2026, 12:31 IST');
	assert.deepEqual(stampLines({ order: 'Dropy-4082', awb: '7D140806819', courier: 'DTDC Standard', what: 'RTO claim evidence' }, now), [
		'Dropy-4082 · RTO claim evidence',
		'AWB 7D140806819 · DTDC Standard · 15 Oct 2026, 12:31 IST'
	]);
	assert.equal(stampLines({ order: 'Dropy-1', awb: null, courier: null, what: 'x' }, now)[1], '15 Oct 2026, 12:31 IST');
});
