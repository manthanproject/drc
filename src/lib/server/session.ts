import { APP_PASSWORD } from '$app/env/private';
import { same } from './auth.ts';

export const SESSION_COOKIE = 'drc_session';
export const SESSION_MAX_AGE = 400 * 86_400; // browsers cap cookies at 400 days

let cached: { pass: string; token: string } | null = null;

/**
 * Cookie value = HMAC-SHA256(key = APP_PASSWORD, "drc-session-v1"), base64url. Never the password itself.
 * Changing APP_PASSWORD changes the token, so every phone is logged out automatically.
 * Web Crypto (works on Vercel Node and locally, no extra packages).
 */
export async function sessionToken(): Promise<string> {
	const pass = APP_PASSWORD ?? '';
	if (cached?.pass === pass) return cached.token;
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', enc.encode(pass), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('drc-session-v1')));
	const token = btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	cached = { pass, token };
	return token;
}

export async function validSession(value: string | undefined): Promise<boolean> {
	if (!APP_PASSWORD || !value) return false;
	return same(value, await sessionToken());
}

/** Only same-site paths, never "//evil.com" or absolute URLs. */
export function safeNext(next: string | null): string {
	return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}
