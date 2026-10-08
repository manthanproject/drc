import { loadRefunds } from '#lib/server/refunds.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	return loadRefunds();
};
