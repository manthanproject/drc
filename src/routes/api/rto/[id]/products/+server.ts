import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { db } from '#lib/server/supabase.ts';
import { productLinks } from '#lib/server/dropy-products.ts';
import type { RequestHandler } from './$types';

/** {<sku>: {verified, url, title?, image?}} for this RTO's items, checked against dropy.in by exact SKU. */
export const GET: RequestHandler = async ({ request, params, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const { data } = await db().from('rto_items').select('sku').eq('rto_id', params.id);
	return json(await productLinks((data ?? []).map((i) => i.sku as string).filter(Boolean)), { headers: { 'cache-control': 'private, max-age=300' } });
};
