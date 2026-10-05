import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { db } from '#lib/server/supabase.ts';
import { findPacking } from '#lib/server/droppy.ts';
import type { RequestHandler } from './$types';

/** Packing video from DROPPY-Log (read only): found / missing / purged. Never copies the file. */
export const GET: RequestHandler = async ({ request, params, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const { data } = await db().from('rtos').select('forward_awb').eq('id', params.id).maybeSingle();
	if (!data?.forward_awb) return json({ state: 'missing', reason: 'No AWB' });
	try {
		const p = await findPacking(data.forward_awb);
		if (!p || !p.videoFileId) return json({ state: 'missing' });
		if (p.filesDeleted) return json({ state: 'purged' });
		return json({ state: 'found', url: `https://drive.google.com/file/d/${encodeURIComponent(p.videoFileId)}/view` });
	} catch (e) {
		console.error('packing lookup failed', e);
		return json({ state: 'error' });
	}
};
