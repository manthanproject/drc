import { DRC_UPLOADER_URL, DRC_UPLOADER_TOKEN } from '$app/env/private';

const ROOT_NAME = 'DRC Claims Media';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3/files';

let cached: { token: string; until: number } | null = null;
let rootId: string | null = null;

/** Short-lived Drive token for warhawkchaos, vended by the DRC Uploader Apps Script. Server only. */
async function driveToken(): Promise<string> {
	if (cached && Date.now() < cached.until) return cached.token;
	if (!DRC_UPLOADER_URL || !DRC_UPLOADER_TOKEN) throw new Error('DRC Uploader env vars missing');
	const r = await fetch(DRC_UPLOADER_URL, {
		method: 'POST',
		headers: { 'content-type': 'text/plain' },
		body: JSON.stringify({ token: DRC_UPLOADER_TOKEN, action: 'token' })
	});
	const text = await r.text();
	let j: { ok?: boolean; accessToken?: string; error?: string };
	try {
		j = JSON.parse(text);
	} catch {
		throw new Error(`Uploader returned non-JSON (HTTP ${r.status}): ${text.slice(0, 120)}`);
	}
	if (!j.ok || !j.accessToken) throw new Error(`Uploader: ${j.error ?? 'no token'}`);
	cached = { token: j.accessToken, until: Date.now() + 45 * 60 * 1000 };
	return j.accessToken;
}

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
	const token = await driveToken();
	const r = await fetch(url, {
		...init,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) }
	});
	if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
	return r.json() as Promise<T>;
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findOrCreateFolder(name: string, parent: string): Promise<string> {
	const query = `name = '${q(name)}' and '${parent}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
	const found = await api<{ files: { id: string }[] }>(
		`${API}?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`
	);
	if (found.files[0]) return found.files[0].id;
	const made = await api<{ id: string }>(`${API}?fields=id`, {
		method: 'POST',
		body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] })
	});
	return made.id;
}

/** Claim folder `Dropy-<order> (<awb>)` inside "DRC Claims Media". */
export async function claimFolder(orderNo: string, awb: string): Promise<{ id: string; url: string }> {
	rootId ??= await findOrCreateFolder(ROOT_NAME, 'root');
	const id = await findOrCreateFolder(`Dropy-${orderNo} (${awb})`, rootId);
	return { id, url: `https://drive.google.com/drive/folders/${id}` };
}

/** Starts a resumable upload the phone can PUT to directly (CORS allowed for `origin`). */
export async function startUpload(
	folderId: string,
	name: string,
	mimeType: string,
	size: number,
	origin: string
): Promise<string> {
	const token = await driveToken();
	const r = await fetch(
		'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType',
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json; charset=UTF-8',
				'x-upload-content-type': mimeType || 'application/octet-stream',
				'x-upload-content-length': String(size),
				origin
			},
			body: JSON.stringify({ name, parents: [folderId] })
		}
	);
	const location = r.headers.get('location');
	if (!r.ok || !location) throw new Error(`Upload session ${r.status}: ${(await r.text()).slice(0, 200)}`);
	return location;
}

/** 0 MB shortcut to a file we can only view (e.g. a DROPPY packing video). */
export async function addShortcut(folderId: string, targetId: string, name: string) {
	return api<{ id: string; name: string }>(`${API}?fields=id,name`, {
		method: 'POST',
		body: JSON.stringify({
			name,
			mimeType: 'application/vnd.google-apps.shortcut',
			parents: [folderId],
			shortcutDetails: { targetId }
		})
	});
}

/** Anyone with the link can VIEW (needed so Velocity can open the evidence links). Safe to repeat. */
export async function shareAnyoneReader(fileId: string) {
	return api<{ id: string }>(`${API}/${encodeURIComponent(fileId)}/permissions?fields=id&sendNotificationEmail=false`, {
		method: 'POST',
		body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false })
	});
}

/** Adds the shortcut only if the folder does not already hold one with that name. */
export async function ensureShortcut(folderId: string, targetId: string, name: string): Promise<{ id: string; created: boolean }> {
	const query = `name = '${q(name)}' and '${folderId}' in parents and trashed = false`;
	const found = await api<{ files: { id: string }[] }>(`${API}?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`);
	if (found.files[0]) return { id: found.files[0].id, created: false };
	const made = await addShortcut(folderId, targetId, name);
	return { id: made.id, created: true };
}
