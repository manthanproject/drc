import { error } from '@sveltejs/kit';
import { db } from './supabase.ts';
import { fail, UUID } from './actions.ts';
import { claimFolder, startUpload, shareAnyoneReader, ensureShortcut, trashUnused, DriveError } from './drive.ts';
import { allRtos } from './rto-data.ts';
import { findPacking } from './droppy.ts';
import { reasonOf, isMediaKind, isDummyItem, mediaFileName, extOf, claimRemarks, driveFileUrl, driveFolderUrl, orderFilePrefix, mdndRemarks, bulkSameMinute } from '#lib/claims.ts';

const ID = /^[\w-]{1,64}$/; // rto_items ids (uuid in the database)
const DRIVE_ID = /^[\w-]{10,200}$/;
const MAX_BYTES = 600 * 1024 * 1024;

interface ClaimRto {
	id: string;
	courier: string | null;
	order_no: string | null;
	forward_awb: string | null;
	order_value: number | string | null;
	rto_delivered_at: string | null;
	scanned_at: string | null;
}

async function loadRto(id: string): Promise<ClaimRto> {
	if (!UUID.test(id)) error(404, 'RTO not found');
	const { data, error: e } = await db()
		.from('rtos')
		.select('id, courier, order_no, forward_awb, order_value, rto_delivered_at, scanned_at')
		.eq('id', id)
		.maybeSingle();
	if (e) throw new Error(`rtos: ${e.message}`);
	if (!data) error(404, 'RTO not found');
	const r = data as ClaimRto;
	if (!r.courier || !r.forward_awb || !r.order_no) error(400, 'Old-sheet RTO with no courier/AWB: a claim is not possible here');
	return r;
}

function driveFail(e: unknown): never {
	console.error('drive failed', e);
	const code = e instanceof DriveError ? e.code : 'network';
	error(502, `Google Drive did not answer (${code}). Nothing was saved, try again.`);
}

/** Upload link for ONE evidence file. The phone then PUTs the file straight to Drive (never through Vercel). */
export async function mediaSession(rtoId: string, raw: unknown, origin: string) {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const kind = b.kind;
	if (!isMediaKind(kind) && kind !== 'extra') error(400, 'Unknown media type');
	const mime = String(b.mimeType ?? '').slice(0, 100);
	if (!/^(video|image)\/[\w.+-]+/.test(mime)) error(400, 'Only photos and videos');
	const size = Number(b.size);
	if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) error(400, 'File is empty or bigger than 600 MB');
	const r = await loadRto(rtoId);
	try {
		const folder = await claimFolder(r.order_no!, r.forward_awb!);
		const name = mediaFileName(r.order_no!, String(kind), extOf(String(b.name ?? ''), mime), Date.now());
		const uploadUrl = await startUpload(folder.id, name, mime, size, origin);
		return { uploadUrl, folderId: folder.id, folderUrl: folder.url, name };
	} catch (e) {
		driveFail(e);
	}
}

export interface MediaIn {
	kind: string;
	drive_file_id: string;
	mime_type: string | null;
	size_bytes: number | null;
}

/** Saves the claim in one go (create_rto_claim). Drive first: share the folder, add the packing shortcut. */
export async function createClaim(rtoId: string, raw: unknown) {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const reason = reasonOf(b.reason);
	if (!reason) error(400, 'Pick a reason');
	const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(0, 60) : []);
	const items = ids(b.items);
	const restock = ids(b.restock);
	const media: MediaIn[] = (Array.isArray(b.media) ? b.media : []).slice(0, 12).flatMap((m: any) =>
		m && (isMediaKind(m.kind) || m.kind === 'extra') && typeof m.id === 'string' && DRIVE_ID.test(m.id)
			? [{ kind: m.kind, drive_file_id: m.id, mime_type: typeof m.mime === 'string' ? m.mime.slice(0, 100) : null, size_bytes: Number.isSafeInteger(m.size) ? m.size : null }]
			: []
	);
	const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : '';
	const scanned = b.scanned === true;

	const r = await loadRto(rtoId);
	const { data: itemRows, error: ie } = await db().from('rto_items').select('id, sku, title, qty').eq('rto_id', r.id);
	if (ie) throw new Error(`rto_items: ${ie.message}`);
	const real = (itemRows ?? []).filter((i) => !isDummyItem(i));
	const affected = real.filter((i) => items.includes(i.id));
	if (real.length && !affected.length) error(400, 'Tick the item(s) with the problem');
	if (restock.some((id) => !real.some((i) => i.id === id))) error(400, 'Those items do not belong to this RTO');

	// Drive: same folder the files went into; make it viewable by link; packing video as a 0 MB shortcut
	let folder: { id: string; url: string };
	try {
		folder = await claimFolder(r.order_no!, r.forward_awb!);
		await shareAnyoneReader(folder.id);
	} catch (e) {
		driveFail(e);
	}
	let packingUrl: string | null = null;
	try {
		const p = await findPacking(r.forward_awb!);
		if (p?.videoFileId && !p.filesDeleted) {
			packingUrl = driveFileUrl(p.videoFileId);
			const s = await ensureShortcut(folder.id, p.videoFileId, `${r.order_no}_packing (shortcut)`);
			media.push({ kind: 'packing_shortcut', drive_file_id: s.id, mime_type: null, size_bytes: 0 });
		}
	} catch (e) {
		console.error('packing shortcut skipped', e); // the claim still saves; the remarks just lack the packing line
	}

	const unboxing = media.find((m) => m.kind === 'unboxing_video');
	const description = claimRemarks({
		order_no: r.order_no,
		forward_awb: r.forward_awb,
		order_value: r.order_value,
		rto_delivered_at: r.rto_delivered_at,
		received_at: r.scanned_at ?? new Date().toISOString(),
		reason: reason.key,
		items: affected.map((i) => ({ title: i.title, qty: i.qty })),
		links: { packing: packingUrl, unboxing: unboxing ? driveFileUrl(unboxing.drive_file_id) : null, folder: driveFolderUrl(folder.id) }
	});

	const { data, error: e } = await db().rpc('create_rto_claim', {
		p_rto: r.id,
		p_args: { reason: reason.key, items, restock, media, folder_id: folder.id, description, note, scanned }
	});
	if (e) fail(e.message);

	// Retakes and failed tries stay in the folder otherwise; Velocity should see only what the claim uses
	let trashed = 0;
	try {
		trashed = await trashUnused(folder.id, media.map((m) => m.drive_file_id), orderFilePrefix(r.order_no!));
	} catch (err) {
		console.error('folder clean-up skipped', err);
	}
	return { ...(data as { event_id: number; claim_id: string; from: string; to: string }), packing: !!packingUrl, trashed };
}

/** MDND draft from the Disputes queue: remarks with the courier's "delivered" time, packing link and bulk-update evidence. */
export async function createMdndDraft(rtoId: string) {
	if (!UUID.test(rtoId)) error(404, 'RTO not found');
	const { data: r, error: e1 } = await db()
		.from('rtos')
		.select('id, courier, order_no, forward_awb, carrier_name, order_value, rto_delivered_at, last_event_text, last_event_location, scanned_at')
		.eq('id', rtoId)
		.maybeSingle();
	if (e1) throw new Error(`rtos: ${e1.message}`);
	if (!r) error(404, 'RTO not found');
	if (!r.courier || !r.forward_awb) error(400, 'Old-sheet RTO with no courier/AWB: a claim is not possible here');

	let packing: string | null = null;
	try {
		const p = await findPacking(r.forward_awb);
		if (p?.videoFileId && !p.filesDeleted) packing = driveFileUrl(p.videoFileId);
	} catch (err) {
		console.error('packing lookup skipped', err);
	}
	const bulk = bulkSameMinute(r, await allRtos());
	const description = mdndRemarks({ ...r, packing, bulk });
	const { data, error: e } = await db().rpc('create_mdnd_claim', { p_rto: r.id, p_args: { description } });
	if (e) fail(e.message);
	return { ...(data as { event_id: number; claim_id: string; from: string; to: string }), bulk: bulk?.count ?? 0, packing: !!packing };
}

/** 'raise' (Draft → Raised, optional ticket ref, final remarks) or 'save_text'. */
export async function claimAction(claimId: string, raw: unknown) {
	if (!UUID.test(claimId)) error(404, 'Claim not found');
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const action = b.action === 'raise' || b.action === 'save_text' ? b.action : null;
	if (!action) error(400, 'Unknown action');
	const args: Record<string, string> = {};
	if (typeof b.description === 'string' && b.description.trim()) args.description = b.description.trim().slice(0, 4000);
	if (typeof b.ticket_ref === 'string' && b.ticket_ref.trim()) args.ticket_ref = b.ticket_ref.trim().slice(0, 80);
	const { data, error: e } = await db().rpc('claim_action', { p_claim: claimId, p_action: action, p_args: args });
	if (e) fail(e.message);
	return data as { event_id?: number; claim_id: string; status: string };
}
