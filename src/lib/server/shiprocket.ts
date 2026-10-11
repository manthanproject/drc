import { SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD } from '$app/env/private';

/**
 * Shiprocket API, read-only use in DRC. Logs in with DRC's own API user (Shiprocket → Settings → API),
 * whose email + password live only in Vercel env vars. The token (valid 10 days) is kept in memory per instance.
 */
const BASE = 'https://apiv2.shiprocket.in/v1/external';
const READ_ONLY = [/^\/orders(\?|$)/, /^\/orders\/show\/\d+$/, /^\/shipments(\?|$)/, /^\/courier\/track\/awb\/[A-Za-z0-9-]+$/];

export class ShiprocketAuthError extends Error {}
let cached: { token: string; at: number } | null = null;

async function token(): Promise<string> {
	if (cached && Date.now() - cached.at < 8 * 24 * 3_600_000) return cached.token;
	if (!SHIPROCKET_EMAIL || !SHIPROCKET_PASSWORD) throw new ShiprocketAuthError('Shiprocket API user not set (SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD)');
	const r = await fetch(`${BASE}/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({ email: SHIPROCKET_EMAIL, password: SHIPROCKET_PASSWORD }),
		signal: AbortSignal.timeout(15_000)
	});
	const b = await r.json().catch(() => ({}));
	if (!r.ok || !b?.token) {
		// Shiprocket's reason ("Invalid email and password combination", "User blocked ..."); never contains the password
		const why = typeof b?.message === 'string' ? `: ${b.message.replace(/\s+/g, ' ').slice(0, 160)}` : '';
		throw new ShiprocketAuthError(`Shiprocket login failed (HTTP ${r.status})${why}`);
	}
	cached = { token: String(b.token), at: Date.now() };
	return cached.token;
}

export async function shiprocketGet(path: string): Promise<{ status: number; body: any }> {
	if (!READ_ONLY.some((re) => re.test(path))) throw new Error(`Blocked: ${path} is not a read-only endpoint`);
	const call = async () =>
		fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${await token()}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
	let r = await call();
	if (r.status === 401) {
		cached = null; // token expired: log in again once
		r = await call();
	}
	const text = await r.text();
	let body: any = text;
	try {
		body = JSON.parse(text);
	} catch {
		/* keep text */
	}
	return { status: r.status, body };
}
