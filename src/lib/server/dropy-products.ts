import { handleOf, skuForms, skuMatches, toLink, STORE, type ProductJs, type ProductLink } from '#lib/products.ts';

const cache = new Map<string, { at: number; link: ProductLink }>();
const TTL = 60 * 60 * 1000;
const UA = { 'user-agent': 'DRC (Dropy Return Central) product check', accept: 'application/json' };

async function getJson(url: string): Promise<any> {
	const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(5000) });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return r.json();
}

/** Public storefront lookups only (search + product .js). Verified by exact SKU, else a search link. */
async function lookup(sku: string): Promise<ProductLink> {
	for (const form of skuForms(sku)) {
		const s = await getJson(`${STORE}/search/suggest.json?q=${encodeURIComponent(form)}&resources%5Btype%5D=product&resources%5Blimit%5D=3`);
		const urls: string[] = (s?.resources?.results?.products ?? []).map((p: { url: string }) => p.url);
		for (const u of urls) {
			const handle = handleOf(u);
			if (!handle) continue;
			const p: ProductJs = await getJson(`${STORE}/products/${encodeURIComponent(handle)}.js`);
			if (skuMatches(p, sku)) return toLink(sku, p);
		}
	}
	return toLink(sku, null);
}

export async function productLinks(skus: string[]): Promise<Record<string, ProductLink>> {
	const out: Record<string, ProductLink> = {};
	await Promise.all(
		[...new Set(skus.filter(Boolean))].slice(0, 12).map(async (sku) => {
			const hit = cache.get(sku);
			if (hit && Date.now() - hit.at < TTL) return void (out[sku] = hit.link);
			try {
				const link = await lookup(sku);
				cache.set(sku, { at: Date.now(), link });
				out[sku] = link;
			} catch {
				out[sku] = toLink(sku, null); // dropy.in slow/down: still give a search link, don't cache
			}
		})
	);
	return out;
}
