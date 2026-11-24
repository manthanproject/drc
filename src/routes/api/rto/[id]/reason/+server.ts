import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { db } from '#lib/server/supabase.ts';
import { velocityPost, VelocityKeyError } from '#lib/server/velocity-api.ts';
import { exactReason } from '#lib/reason.ts';
import type { RequestHandler } from './$types';

/** The courier's exact failed-delivery note for an RTO, read live from Velocity's full tracking. Read only, nothing saved. */
export const GET: RequestHandler = async ({ request, params, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const { data } = await db().from('rtos').select('courier, kind, forward_awb').eq('id', params.id).maybeSingle();
	if (!data?.forward_awb || data.courier !== 'velocity' || (data.kind ?? 'rto') !== 'rto') return json({ state: 'none' });
	try {
		const r = await velocityPost('/order-tracking', { awbs: [data.forward_awb] }, { timeoutMs: 12_000 });
		if (r.status !== 200) return json({ state: 'error' });
		const td = r.body?.result?.[data.forward_awb]?.tracking_data;
		const hit = exactReason(td?.shipment_track_activities);
		return json(hit ? { state: 'found', ...hit } : { state: 'none' });
	} catch (e) {
		if (!(e instanceof VelocityKeyError)) console.error('reason lookup failed', e);
		return json({ state: 'error' });
	}
};
