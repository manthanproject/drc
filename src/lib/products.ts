// Product verification links (pure parts, tested). DRC links an item to a dropy.in product page ONLY when
// that page's own variant SKUs contain the item's SKU. Otherwise it offers a dropy.in search link.

export const STORE = 'https://dropy.in';

/** Velocity SKUs are 'Dropy-<ASIN>'; old sheet rows may hold just the ASIN. */
export function skuForms(sku: string): string[] {
	const s = sku.trim();
	if (!s) return [];
	return /^dropy-/i.test(s) ? [s] : [`Dropy-${s}`, s];
}

export const searchUrl = (sku: string) => `${STORE}/search?q=${encodeURIComponent(skuForms(sku)[0] ?? sku)}&type=product`;

/** '/products/abc?_pos=1&…' → 'abc' */
export function handleOf(url: string): string | null {
	const m = String(url ?? '').match(/\/products\/([^/?#]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

export interface ProductJs {
	handle: string;
	title: string;
	featured_image?: string | null;
	variants?: { sku?: string | null }[];
}

export function skuMatches(p: ProductJs, sku: string): boolean {
	const want = new Set(skuForms(sku).map((x) => x.toLowerCase()));
	return (p.variants ?? []).some((v) => typeof v.sku === 'string' && want.has(v.sku.trim().toLowerCase()));
}

export interface ProductLink {
	sku: string;
	verified: boolean;
	url: string;
	title?: string;
	image?: string;
}

export function toLink(sku: string, p: ProductJs | null): ProductLink {
	if (!p) return { sku, verified: false, url: searchUrl(sku) };
	const img = p.featured_image ? (p.featured_image.startsWith('//') ? `https:${p.featured_image}` : p.featured_image) : undefined;
	return {
		sku,
		verified: true,
		url: `${STORE}/products/${encodeURIComponent(p.handle)}`,
		title: p.title,
		image: img ? `${img}${img.includes('?') ? '&' : '?'}width=120` : undefined
	};
}

/** Shipping address lines from Velocity's shipping_address (city/state/PIN added only if not already in the line). */
export function addressLines(a: { full_address?: string | null; city?: string | null; state?: string | null; zip?: string | null } | null | undefined): string[] {
	if (!a) return [];
	const full = String(a.full_address ?? '').replace(/\s+/g, ' ').trim();
	const lines = full ? [full] : [];
	const low = full.toLowerCase();
	const tail = [a.city, a.state].filter((x) => x && !low.includes(String(x).toLowerCase())).join(', ');
	const zip = a.zip && !low.includes(String(a.zip)) ? String(a.zip) : '';
	const last = [tail, zip].filter(Boolean).join(' ');
	if (last) lines.push(last);
	return lines;
}
