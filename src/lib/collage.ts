// Claim photo collage: 7 shots (label, front, back, 4 sides) in ONE image with a stamped header.
// The layout is pure (tested); drawing runs in the browser on a canvas.

export const TILE = 500;
const GAP = 10;
const PAD = 16;
const HEAD = 104;
export const CAPTION = 44;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Row 1: label (2 tiles wide, the AWB stays readable), front, back. Row 2: the 4 sides. */
export function collageLayout(): { width: number; height: number; header: Rect; tiles: Rect[] } {
	const width = PAD * 2 + TILE * 4 + GAP * 3;
	const top = PAD + HEAD + GAP;
	const at = (col: number, row: number, span = 1): Rect => ({ x: PAD + col * (TILE + GAP), y: top + row * (TILE + GAP), w: TILE * span + GAP * (span - 1), h: TILE });
	return {
		width,
		height: top + TILE * 2 + GAP + PAD,
		header: { x: PAD, y: PAD, w: width - PAD * 2, h: HEAD },
		tiles: [at(0, 0, 2), at(2, 0), at(3, 0), at(0, 1), at(1, 1), at(2, 1), at(3, 1)]
	};
}

/** Biggest box of the image's shape that fits inside the tile, centred: nothing is cropped away. */
export function fitInside(imgW: number, imgH: number, box: Rect): Rect {
	const s = Math.min(box.w / imgW, box.h / imgH);
	const w = Math.round(imgW * s), h = Math.round(imgH * s);
	return { x: box.x + Math.round((box.w - w) / 2), y: box.y + Math.round((box.h - h) / 2), w, h };
}

/** '15 Oct 2026, 12:31 IST' */
export function stampTime(now: number): string {
	const d = new Date(now + 5.5 * 3_600_000);
	const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
	return `${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} IST`;
}

export interface Stamp {
	order: string; // 'Dropy-4082'
	awb: string | null;
	courier: string | null;
	what: string; // 'RTO claim evidence'
}

export function stampLines(s: Stamp, now: number): [string, string] {
	return [`${s.order} · ${s.what}`, [s.awb ? `AWB ${s.awb}` : null, s.courier, stampTime(now)].filter(Boolean).join(' · ')];
}

/** Browser only: the collage JPEG (kept under ~1.9 MB so courier portals with a 2 MB limit take it). */
export async function buildCollage(shots: { label: string; file: Blob }[], stamp: Stamp, now = Date.now()): Promise<File> {
	const L = collageLayout();
	const c = document.createElement('canvas');
	c.width = L.width;
	c.height = L.height;
	const g = c.getContext('2d')!;
	g.fillStyle = '#ffffff';
	g.fillRect(0, 0, L.width, L.height);

	// header: order, AWB, courier, time
	g.fillStyle = '#0f3d36';
	g.fillRect(L.header.x, L.header.y, L.header.w, L.header.h);
	const [l1, l2] = stampLines(stamp, now);
	g.fillStyle = '#ffffff';
	g.textBaseline = 'middle';
	g.font = '700 38px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
	g.fillText(l1, L.header.x + 24, L.header.y + 34, L.header.w - 48);
	g.font = '500 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
	g.fillText(l2, L.header.x + 24, L.header.y + 76, L.header.w - 48);

	for (let i = 0; i < L.tiles.length; i++) {
		const t = L.tiles[i];
		g.fillStyle = '#eef0f2';
		g.fillRect(t.x, t.y, t.w, t.h);
		const shot = shots[i];
		if (shot) {
			const img = await loadImage(shot.file);
			// the caption gets its own strip under the photo, so it never covers the label / AWB
			const r = fitInside(img.width, img.height, { ...t, h: t.h - CAPTION });
			g.drawImage(img, r.x, r.y, r.w, r.h);
			if ('close' in img) (img as ImageBitmap).close();
		}
		// caption band
		g.fillStyle = '#1f2933';
		g.fillRect(t.x, t.y + t.h - CAPTION, t.w, CAPTION);
		g.fillStyle = '#ffffff';
		g.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
		g.fillText(`${i + 1}. ${shot?.label ?? ''}`, t.x + 14, t.y + t.h - 22, t.w - 28);
	}

	let q = 0.86;
	let blob = await toJpeg(c, q);
	while (blob.size > 1_900_000 && q > 0.5) {
		q -= 0.12;
		blob = await toJpeg(c, q);
	}
	const name = `collage_${stamp.order.replace(/[^\w-]+/g, '_')}.jpg`;
	return new File([blob], name, { type: 'image/jpeg' });
}

function toJpeg(c: HTMLCanvasElement, q: number): Promise<Blob> {
	return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not make the collage'))), 'image/jpeg', q));
}

/** Respects the photo's own rotation (phones save portrait photos sideways + an EXIF flag). */
async function loadImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
	if (typeof createImageBitmap === 'function') {
		try {
			return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
		} catch {
			/* fall back to <img> */
		}
	}
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		return img;
	} finally {
		URL.revokeObjectURL(url);
	}
}
