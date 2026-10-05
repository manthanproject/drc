import { json, error } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { db } from '#lib/server/supabase.ts';
import type { RequestHandler } from './$types';

/** POST {code, note?} → saves a parcel nobody can match yet, so it is never lost. Same code twice = same record. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const body = await request.json().catch(() => ({}));
	const code = String(body?.code ?? '').trim().slice(0, 80);
	const note = String(body?.note ?? '').trim().slice(0, 500) || null;
	if (!code) error(400, 'Scan or type the code first');

	const { data: existing } = await db().from('rtos').select('id').eq('stage', 'unknown_parcel').eq('scanned_code', code).maybeSingle();
	if (existing) return json({ id: existing.id, existing: true });

	const { data, error: e } = await db()
		.from('rtos')
		.insert({ stage: 'unknown_parcel', scanned_code: code, scanned_at: new Date().toISOString(), notes: note })
		.select('id')
		.single();
	if (e) {
		console.error('unknown parcel insert failed', e.message);
		error(500, 'Could not save');
	}
	await db().from('events').insert({ source: 'user', rto_id: data.id, kind: 'unknown_parcel', payload: { code, note } });
	return json({ id: data.id, existing: false });
};
