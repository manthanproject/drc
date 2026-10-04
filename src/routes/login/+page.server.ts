import { fail, redirect } from '@sveltejs/kit';
import { APP_PASSWORD } from '$app/env/private';
import { same } from '#lib/server/auth.ts';
import { SESSION_COOKIE, SESSION_MAX_AGE, safeNext, sessionToken, validSession } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const load: PageServerLoad = async ({ cookies, url }) => {
	if (await validSession(cookies.get(SESSION_COOKIE))) redirect(303, safeNext(url.searchParams.get('next')));
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		if (!APP_PASSWORD || !same(password, APP_PASSWORD)) {
			await sleep(1000); // slows down guessing
			return fail(401, { wrong: true });
		}
		cookies.set(SESSION_COOKIE, await sessionToken(), {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: SESSION_MAX_AGE
		});
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
