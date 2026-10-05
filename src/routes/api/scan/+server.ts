import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { allRtos } from '#lib/server/rto-data.ts';
import { findMatches } from '#lib/scan.ts';
import { BUCKETS, bucketOf, DEFAULT_RULES, inr, isNonDropy, isSheetOnly, orderLabel, num } from '#lib/dashboard.ts';
import type { RequestHandler } from './$types';

/** GET ?code= → every RTO the scanned / typed code points to (AWB, order + re-ships, phone, name). */
export const GET: RequestHandler = async ({ request, url, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const code = (url.searchParams.get('code') ?? '').slice(0, 80);
	const { by, matches } = findMatches(await allRtos(), code);
	const now = Date.now();
	return json(
		{
			code,
			by,
			matches: matches.slice(0, 20).map((r) => {
				const b = bucketOf(r, now, DEFAULT_RULES);
				return {
					id: r.id,
					label: orderLabel(r),
					value: inr(num(r.order_value)),
					carrier: r.carrier_name,
					awb: r.forward_awb,
					customer: r.customer_name,
					stage: BUCKETS[b].label,
					tone: BUCKETS[b].tone,
					sheetOnly: isSheetOnly(r),
					nonDropy: isNonDropy(r)
				};
			})
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
