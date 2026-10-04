import { json } from '@sveltejs/kit';
import { requirePassword } from '#lib/server/auth.ts';
import { velocityPost, VelocityKeyError } from '#lib/server/velocity-api.ts';
import { redact } from '#lib/server/redact.ts';
import type { RequestHandler } from './$types';

const FILTERS = ['page', 'per_page', 'status', 'granular_status', 'date_field', 'start_time', 'end_time', 'sort_order', 'search', 'rto_reason', 'is_cod'];

/**
 * Read-only look at Velocity's API with DRC's key.
 * Body: {"endpoint":"shipments", ...filters} or {"endpoint":"tracking","awbs":["..."]}. PII masked.
 */
export const POST: RequestHandler = async ({ request }) => {
	requirePassword(request);
	const b = await request.json().catch(() => ({}));
	try {
		if (b.endpoint === 'tracking') {
			const awbs = (Array.isArray(b.awbs) ? b.awbs : []).map(String).slice(0, 5);
			if (!awbs.length) return json({ error: 'awbs required' }, { status: 400 });
			const r = await velocityPost('/order-tracking', { awbs });
			return json({ httpStatus: r.status, reply: redact(r.body) });
		}
		const body: Record<string, unknown> = { page: 1, per_page: 3 };
		for (const k of FILTERS) if (b[k] !== undefined) body[k] = b[k];
		body.per_page = Math.min(Number(body.per_page) || 3, 5);
		const r = await velocityPost('/shipments', body);
		const rows: any[] = Array.isArray(r.body?.data) ? r.body.data : [];
		return json({
			httpStatus: r.status,
			sent: body,
			meta: r.body?.meta ?? null,
			attributeKeys: [...new Set(rows.flatMap((x) => Object.keys(x?.attributes ?? {})))].sort(),
			sample: redact(rows.length ? rows : r.body)
		});
	} catch (e) {
		const key = e instanceof VelocityKeyError;
		return json({ error: e instanceof Error ? e.message : String(e), keyRejected: key }, { status: key ? 401 : 502 });
	}
};
