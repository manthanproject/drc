import { json, error } from '@sveltejs/kit';
import { requirePassword } from '#lib/server/auth.ts';
import { claimFolder, startUpload } from '#lib/server/drive.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url }) => {
	requirePassword(request);
	const b = await request.json();
	const orderNo = String(b.orderNo ?? '').replace(/\D+/g, '');
	const awb = String(b.awb ?? '').trim();
	if (!orderNo || !awb || !b.fileName || !b.size) error(400, 'orderNo, awb, fileName, size required');
	try {
		const folder = await claimFolder(orderNo, awb);
		const uploadUrl = await startUpload(folder.id, String(b.fileName), String(b.mimeType ?? ''), Number(b.size), url.origin);
		return json({ uploadUrl, folder });
	} catch (e) {
		error(502, e instanceof Error ? e.message : String(e));
	}
};
