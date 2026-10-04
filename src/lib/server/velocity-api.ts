import { VELOCITY_API_URL, VELOCITY_API_KEY } from '$app/env/private';

/** Velocity Shipping API with DRC's own named API key (Authorization: Bearer). Read-only use in DRC. */
export class VelocityKeyError extends Error {}

const base = () => (VELOCITY_API_URL || '').replace(/\/+$/, '');

/** Read-only endpoints DRC is allowed to call. Booking, cancel, NDR actions are deliberately absent. */
const READ_ONLY = new Set(['/shipments', '/order-tracking', '/return-shipments']);

export async function velocityPost(path: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
	if (!READ_ONLY.has(path)) throw new Error(`Blocked: ${path} is not a read-only endpoint`);
	if (!VELOCITY_API_URL || !VELOCITY_API_KEY) throw new Error('Velocity API env vars missing');
	const r = await fetch(`${base()}${path}`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${VELOCITY_API_KEY}`,
			'content-type': 'application/json',
			accept: 'application/json'
		},
		body: JSON.stringify(body)
	});
	if (r.status === 401 || r.status === 403) throw new VelocityKeyError(`Velocity API key rejected (HTTP ${r.status})`);
	const text = await r.text();
	let parsed: any = text;
	try {
		parsed = JSON.parse(text);
	} catch {
		/* keep text */
	}
	return { status: r.status, body: parsed };
}
