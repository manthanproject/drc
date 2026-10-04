import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, validSession } from '#lib/server/session.ts';

/**
 * Every page needs the DRC login cookie.
 * /api/* is left alone: each endpoint keeps its own check (x-cron-secret / x-drc-pass), health stays public.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (path.startsWith('/api/') || path === '/login') return resolve(event);
	if (!(await validSession(event.cookies.get(SESSION_COOKIE)))) {
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}
	return resolve(event);
};
