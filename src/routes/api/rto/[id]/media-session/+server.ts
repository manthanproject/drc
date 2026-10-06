import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { mediaSession } from '#lib/server/claims.ts';
import type { RequestHandler } from './$types';

/** POST {kind, mimeType, size, name} → {uploadUrl, folderId, folderUrl, name}. The browser PUTs the file to uploadUrl. */
export const POST: RequestHandler = async ({ request, params, cookies, url }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	return json(await mediaSession(params.id, await request.json().catch(() => ({})), url.origin));
};
