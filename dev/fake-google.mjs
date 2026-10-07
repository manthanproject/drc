// DEV ONLY: fakes the DRC Uploader (Apps Script) + Google Drive for local UI work. Never deployed (outside src/).
// Run vite with:  NODE_OPTIONS="--import ./dev/fake-google.mjs" DRC_UPLOADER_URL=https://script.google.com/fake DRC_UPLOADER_TOKEN=x npm run dev
// Resumable uploads are pointed at the mock server (dev/mock-supabase.mjs, /fake-upload/…), which answers like Drive.
const real = globalThis.fetch;
const files = new Map(); // id → {name, parent, mimeType}
let n = 0;
let tokens = 0;
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
export const driveLog = [];

globalThis.fetch = async (input, init = {}) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	if (url.startsWith('https://script.google.com/')) return json({ ok: true, accessToken: `fake-token-${++tokens}`, account: 'fake@dev' });
	// FAKE_DRIVE_EXPIRED_TOKEN=1: the first token handed out is already expired (Drive answers 401), like a part-used Apps Script token
	const auth = String(new Headers(init.headers ?? {}).get('authorization') ?? '');
	if (url.startsWith('https://www.googleapis.com/') && process.env.FAKE_DRIVE_EXPIRED_TOKEN === '1' && auth === 'Bearer fake-token-1') {
		driveLog.push({ op: '401', url });
		return new Response('{"error":{"code":401,"message":"Invalid Credentials"}}', { status: 401 });
	}
	if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
		const meta = JSON.parse(String(init.body ?? '{}'));
		driveLog.push({ op: 'upload-session', name: meta.name, parent: meta.parents?.[0] });
		const q = new URLSearchParams({ name: meta.name, parent: meta.parents?.[0] ?? '' });
		return new Response('', { status: 200, headers: { location: `http://127.0.0.1:54321/fake-upload/${++n}?${q}` } });
	}
	if (url.startsWith('https://www.googleapis.com/drive/v3/files')) {
		const u = new URL(url);
		const perm = u.pathname.match(/\/files\/([^/]+)\/permissions$/);
		if (perm) {
			driveLog.push({ op: 'share', id: perm[1], body: JSON.parse(String(init.body ?? '{}')) });
			return json({ id: 'anyoneWithLink' });
		}
		if ((init.method ?? 'GET') === 'GET') {
			const q = u.searchParams.get('q') ?? '';
			const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, '$1');
			const parent = q.match(/'([^']+)' in parents/)?.[1];
			const hit = [...files].find(([, f]) => f.name === name && f.parent === parent);
			return json({ files: hit ? [{ id: hit[0] }] : [] });
		}
		const meta = JSON.parse(String(init.body ?? '{}'));
		const id = `fake${meta.mimeType?.endsWith('folder') ? 'Folder' : meta.mimeType?.endsWith('shortcut') ? 'Shortcut' : 'File'}${String(++n).padStart(6, '0')}`;
		files.set(id, { name: meta.name, parent: meta.parents?.[0], mimeType: meta.mimeType });
		driveLog.push({ op: 'create', id, name: meta.name, mimeType: meta.mimeType });
		return json({ id, name: meta.name });
	}
	return real(input, init);
};
globalThis.__fakeDriveLog = driveLog;
console.log('[fake-google] Drive + Uploader faked for dev');
