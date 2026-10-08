import { getRtoDetail } from '#lib/server/rto-detail.ts';
import { refundsForRto } from '#lib/server/refunds.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const [detail, refunds] = await Promise.all([getRtoDetail(params.id), refundsForRto(params.id).catch(() => [])]);
	return { ...detail, refunds };
};
