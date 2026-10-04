import { json, error } from '@sveltejs/kit';
import { requirePassword } from '#lib/server/auth.ts';
import { claimFolder, addShortcut } from '#lib/server/drive.ts';
import { findPacking } from '#lib/server/droppy.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	requirePassword(request);
	const b = await request.json();
	const orderNo = String(b.orderNo ?? '').replace(/\D+/g, '');
	const awb = String(b.awb ?? '').trim();
	if (!orderNo || !awb) error(400, 'orderNo and awb required');
	try {
		const packing = await findPacking(awb);
		if (!packing) return json({ state: 'missing', message: 'AWB not found in DROPPY-Log' });
		if (packing.filesDeleted) return json({ state: 'purged', packing });
		if (!packing.videoFileId) return json({ state: 'missing', message: 'Row found but no Video File ID', packing });
		const folder = await claimFolder(orderNo, awb);
		const shortcut = await addShortcut(folder.id, packing.videoFileId, `${orderNo}_packing (shortcut)`);
		return json({ state: 'found', packing, folder, shortcut });
	} catch (e) {
		error(502, e instanceof Error ? e.message : String(e));
	}
};
