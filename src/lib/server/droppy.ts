import { DROPPY_LOG_ID } from '$app/env/private';
import { sheetsReadonly } from './google.ts';

export type PackingRecord = {
	trackingId: string;
	orderName: string;
	videoFileId: string;
	frontPhotoId: string;
	backPhotoId: string;
	labelPhotoId: string;
	filesDeleted: string;
};

const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();

/** Finds the DROPPY-Log row for a forward AWB. Read only. */
export async function findPacking(awb: string): Promise<PackingRecord | null> {
	const r = await sheetsReadonly().spreadsheets.values.get({
		spreadsheetId: DROPPY_LOG_ID,
		range: 'Sheet1',
		majorDimension: 'ROWS'
	});
	const [header = [], ...rows] = r.data.values ?? [];
	const col = (name: string) => header.findIndex((h) => String(h).trim() === name);
	const c = {
		tracking: col('Tracking ID'),
		order: col('Order Name'),
		video: col('Video File ID'),
		front: col('Front Photo ID'),
		back: col('Back Photo ID'),
		label: col('Label Photo ID'),
		deleted: col('Files Deleted')
	};
	if (c.tracking < 0 || c.video < 0) throw new Error('DROPPY-Log headers changed');
	const want = norm(awb);
	for (let i = rows.length - 1; i >= 0; i--) {
		const row = rows[i];
		if (norm(row[c.tracking]) !== want) continue;
		const get = (k: number) => (k >= 0 ? String(row[k] ?? '').trim() : '');
		return {
			trackingId: get(c.tracking),
			orderName: get(c.order),
			videoFileId: get(c.video),
			frontPhotoId: get(c.front),
			backPhotoId: get(c.back),
			labelPhotoId: get(c.label),
			filesDeleted: get(c.deleted)
		};
	}
	return null;
}
