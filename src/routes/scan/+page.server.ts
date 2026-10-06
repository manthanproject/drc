import { scannedToday } from '#lib/server/today.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, setHeaders }) => {
	depends('drc:today');
	setHeaders({ 'cache-control': 'no-store' });
	return { today: await scannedToday() };
};
