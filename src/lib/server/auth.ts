import { error } from '@sveltejs/kit';
import { APP_PASSWORD } from '$app/env/private';

/** Constant-time string compare (no early exit on first mismatch). */
function same(a: string, b: string): boolean {
	let diff = a.length ^ b.length;
	for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
	return diff === 0;
}

/** Throws 401 unless the request carries the shared DRC password in x-drc-pass. */
export function requirePassword(request: Request): void {
	const expected = APP_PASSWORD ?? '';
	if (!expected || !same(request.headers.get('x-drc-pass') ?? '', expected)) error(401, 'Wrong password');
}
