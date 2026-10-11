import { scannedToday } from '#lib/server/today.ts';
import { ARRIVED_COOKIE, parseArrived } from '#lib/arrived.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, setHeaders, cookies }) => {
	depends('drc:today');
	setHeaders({ 'cache-control': 'no-store' });
	return { today: await scannedToday(), arrived: parseArrived(cookies.get(ARRIVED_COOKIE), Date.now()) };
};
