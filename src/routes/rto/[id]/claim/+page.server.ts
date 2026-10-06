import { getRtoDetail } from '#lib/server/rto-detail.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	return getRtoDetail(params.id);
};
