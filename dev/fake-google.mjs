// DEV ONLY: fakes the DRC Uploader (Apps Script) + Google Drive for local UI work. Never deployed (outside src/).
// Run vite with:  NODE_OPTIONS="--import ./dev/fake-google.mjs" DRC_UPLOADER_URL=https://script.google.com/fake DRC_UPLOADER_TOKEN=x npm run dev
// Resumable uploads are pointed at the mock server (dev/mock-supabase.mjs, /fake-upload/…), which answers like Drive.
const real = globalThis.fetch;
// FAKE_REFUND_SHEET=path.json: rows of the "Dropy Refund" tab for the one-time import ([[{text, bg}]])
import { readFileSync } from 'node:fs';
if (process.env.FAKE_REFUND_SHEET) globalThis.__drcRefundSheet = JSON.parse(readFileSync(process.env.FAKE_REFUND_SHEET, 'utf8'));
const files = new Map(); // id → {name, parent, mimeType}
let n = 0;
let tokens = 0;
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
import { appendFileSync } from 'node:fs';
export const driveLog = [];
const _push = driveLog.push.bind(driveLog);
driveLog.push = (x) => { try { appendFileSync(process.env.FAKE_DRIVE_LOG ?? '/tmp/fake-drive.log', JSON.stringify(x) + '\n'); } catch {} return _push(x); };

globalThis.fetch = async (input, init = {}) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	// FAKE_SHIPROCKET=1: a tiny Shiprocket (login, orders, tracking) for local work on the Shiprocket sync
	if (process.env.FAKE_SHIPROCKET === '1' && url.startsWith('https://apiv2.shiprocket.in/')) {
		if (url.endsWith('/auth/login')) return json({ token: 'fake-sr-token' });
		if (url.includes('/orders?')) return json({ data: [
			{ id: 901, channel_order_id: 'Dropy-5201', status: 'RTO DELIVERED', created_at: '2026-10-01 10:00', customer_name: 'SECRET NAME', customer_phone: '9999999999', total: '1499.00', payment_method: 'cod', shipments: [{ id: 1, awb: 'SR123456789', courier: 'Delhivery Surface', customer_address: 'SECRET' }] },
			{ id: 902, channel_order_id: 'Dropy-5202', status: 'RTO IN TRANSIT', created_at: '2026-10-03 10:00', total: '899.00', payment_method: 'prepaid', shipments: [{ id: 2, awb: 'SR987654321', courier: 'Xpressbees' }] },
			{ id: 903, channel_order_id: 'Dropy-5203', status: 'DELIVERED', created_at: '2026-10-04 10:00', total: '599.00', shipments: [{ id: 3, awb: 'SR555', courier: 'Delhivery' }] }
		], meta: { pagination: { total: 3 } } });
		if (url.includes('/courier/track/awb/') && !url.endsWith('/SR123456789')) return json({ tracking_data: { shipment_track: [{ awb_code: url.split('/').pop(), current_status: 'RTO IN TRANSIT' }], shipment_track_activities: [{ date: '2026-10-08 09:00:00', activity: 'In transit', location: 'Bhiwandi', 'sr-status-label': 'RTO IN TRANSIT' }] } });
		if (url.includes('/courier/track/awb/')) return json({ tracking_data: { track_status: 1, shipment_status: 10, shipment_track: [{ awb_code: 'SR123456789', current_status: 'RTO DELIVERED', delivered_date: '2026-10-09 14:02:00', courier_name: 'Delhivery Surface', consignee_name: 'SECRET' }], shipment_track_activities: [{ date: '2026-10-09 14:02:00', activity: 'RTO Delivered', location: 'Vashi', 'sr-status': '10', 'sr-status-label': 'RTO DELIVERED' }] } });
	}
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
		files.set(`fakeUp${String(n + 1).padStart(8, '0')}x`, { name: meta.name, parent: meta.parents?.[0], mimeType: meta.mimeType }); // id the mock upload will return
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
		if ((init.method ?? 'GET') === 'PATCH') {
			const id = decodeURIComponent(u.pathname.split('/').pop());
			driveLog.push({ op: 'trash', id, name: files.get(id)?.name });
			files.delete(id);
			return json({ id });
		}
		if ((init.method ?? 'GET') === 'GET') {
			const q = u.searchParams.get('q') ?? '';
			const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, '$1');
			const parent = q.match(/'([^']+)' in parents/)?.[1];
			if (name === undefined) return json({ files: [...files].filter(([, f]) => f.parent === parent).map(([id, f]) => ({ id, name: f.name, mimeType: f.mimeType })) });
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
