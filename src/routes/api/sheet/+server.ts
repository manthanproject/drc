import { json, error } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { runSheetSync, setAuto, decide } from '#lib/server/sheet-sync.ts';
import { ORDER_RE } from '#lib/sheet-sync.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

/** Sheet check page: {op: 'sync'} | {op: 'auto', on} | {op: 'use_drc' | 'ignore' | 'add', order}. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const b = await request.json().catch(() => ({}));
	const op = String(b?.op ?? '');
	if (op === 'sync') {
		const r = await runSheetSync(true);
		if (!r.ok) error(502, r.error ?? 'Sync failed');
		return json(r);
	}
	if (op === 'auto') {
		await setAuto(b?.on === true);
		return json({ ok: true, auto: b?.on === true });
	}
	if (op === 'use_drc' || op === 'ignore' || op === 'add') {
		const order = String(b?.order ?? '').trim();
		if (!ORDER_RE.test(order)) error(400, 'Bad order number');
		try {
			return json({ ok: true, message: await decide(op, order) });
		} catch (e) {
			error(409, e instanceof Error ? e.message : 'Could not save');
		}
	}
	error(400, 'Unknown action');
};
