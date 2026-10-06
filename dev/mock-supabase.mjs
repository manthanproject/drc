// DEV ONLY: fake PostgREST for screenshots / local UI work. Never deployed (outside src/).
// Data is SYNTHETIC but shaped like live DRC on 4 Oct 2026 (stage counts, awaiting-receipt age groups and ₹).
// Run: node dev/mock-supabase.mjs   then   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY=x APP_PASSWORD=... npm run dev
import http from 'node:http';

const NOW = Date.now();
const DAY = 86_400_000;
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const FIRST = ['Anita', 'Rohit', 'Sneha', 'Imran', 'Priya', 'Karan', 'Meera', 'Arjun', 'Fatima', 'Vikram', 'Neha', 'Sahil', 'Pooja', 'Aditya', 'Ritu', 'Nikhil'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Khan', 'Reddy', 'Mehta', 'Nair', 'Gupta', 'Shaikh', 'Joshi', 'Das', 'Kulkarni'];
const CARRIERS = [['DTDC', () => `7D14${Math.floor(1e7 + rnd() * 9e7)}`], ['Delhivery', () => `3481${Math.floor(1e9 + rnd() * 9e9)}`], ['Shadowfax', () => `SF${Math.floor(1e9 + rnd() * 9e9)}VEL`]];

let id = 0;
let used = new Set([2529, 3315, 2765, 3048, 3536, 4024, 2731, 3544, 3946, 2876, 2951, 2954, 1098, 1032, 3479, 3082, 3673, 4301]);
const orderNo = () => { let n; do n = 1100 + Math.floor(rnd() * 3700); while (used.has(n)); used.add(n); return String(n); };
const rows = [];
function add(p) {
	const [carrier, awb] = pick(CARRIERS);
	rows.push({
		id: `00000000-0000-0000-0000-${String(++id).padStart(12, '0')}`,
		courier: 'velocity', carrier_name: carrier, order_no: orderNo(), order_name: null, forward_awb: awb(), rto_awb: null,
		scanned_code: null, payment_mode: pick(['cod', 'cod', 'prepaid', 'partial']), order_value: Math.round(900 + rnd() * 4200),
		customer_name: `${pick(FIRST)} ${pick(LAST)}`, customer_phone10: String(9000000000 + Math.floor(rnd() * 999999999)),
		stage: 'in_flight', courier_status: 'rto_in_transit', rto_delivered_at: null, last_movement_at: null, last_event_at: null,
		legacy_source: null, ...p
	});
}
/** n rows whose values add up to total (fixed values first). */
function spread(total, n, fixed = []) {
	const rest = total - fixed.reduce((s, v) => s + v, 0);
	const k = n - fixed.length;
	const w = Array.from({ length: k }, () => 0.5 + rnd());
	const sw = w.reduce((s, v) => s + v, 0);
	const vals = w.map((x) => Math.round((x / sw) * rest));
	vals[0] += rest - vals.reduce((s, v) => s + v, 0);
	return [...fixed, ...vals];
}

// in flight 41: 18 started (2 with no date), 20 moving (4 stale > 3 d), 3 out for delivery
for (let i = 0; i < 18; i++) { const t = i < 2 ? null : iso(rnd() * 2); add({ courier_status: 'rto_initiated', last_movement_at: t, last_event_at: t }); }
for (let i = 0; i < 20; i++) { const t = iso(i < 4 ? 4 + rnd() * 6 : rnd() * 2.5); add({ courier_status: 'rto_in_transit', last_movement_at: t, last_event_at: t }); }
for (let i = 0; i < 3; i++) { const t = iso(rnd() * 0.5); add({ courier_status: 'rto_out_for_delivery', last_movement_at: t, last_event_at: t }); }

// awaiting receipt 58 = ₹1,88,661, by age group (tablet, 4 Oct)
const aw = (order, value, daysAgo, extra = {}) =>
	add({ ...(order ? { order_no: order } : {}), order_value: value, stage: 'awaiting_receipt', courier_status: 'rto_delivered',
		rto_delivered_at: daysAgo === null ? null : iso(daysAgo), ...(order ? {} : {}), ...extra });
spread(36899, 12).forEach((v) => aw(null, v, 0.2 + rnd() * 1.7));
const d37 = ['3536', '4024', '2731', '3544', '3946', '2876', '2951', '2954', '1642-1-1'];
spread(25541, 9).forEach((v, i) => aw(d37[i], v, 3 + i * 0.5));
const d830 = spread(34586, 11, [12049, 6739, 2310, 998]);
['3315', '2765', '3048', '2529'].forEach((o, i) => aw(o, d830[i], [9, 14, 21, 12][i], o === '2529' ? { carrier_name: 'DTDC', forward_awb: '7D137726427', payment_mode: 'prepaid' } : {}));
d830.slice(4).forEach((v) => aw(null, v, 8 + rnd() * 22));
spread(55160, 23).forEach((v) => aw(null, v, 31 + rnd() * 60));
aw('Praveen', 32867.72, null, { customer_name: 'Praveen' });
aw('1098', 1950.28, null);
aw('1032', 1657, null);

// staff stages (sheet backfill): 20 of them sheet-only (no AWB, no courier)
const staff = { to_call: 30, claim: 22, closed: 21, reship: 20, ready_stock: 19, hold: 13, store_credit: 1 };
let sheetOnly = 20;
for (const [stage, n] of Object.entries(staff)) {
	for (let i = 0; i < n; i++) {
		const legacy = sheetOnly > 0 && i % 3 === 2 && stage !== 'claim';
		if (legacy) sheetOnly--;
		add({ stage, courier_status: legacy ? null : 'rto_delivered', rto_delivered_at: legacy ? null : iso(10 + rnd() * 80),
			...(legacy ? { courier: null, carrier_name: null, forward_awb: null, legacy_source: 'sheet' } : {}) });
	}
}
add({ stage: 'lost', courier_status: 'lost', order_no: '3082', order_value: 3977, carrier_name: 'Delhivery', forward_awb: '38539512054802', last_movement_at: iso(19), last_event_at: iso(19) });

// one "Arrived, not scanned" RTO that the hourly check found re-shipped (Phase 3a)
{ const r = rows.find((x) => x.order_no === '2954'); Object.assign(r, { reship_state: 'pending', reship_order_no: '2954-1', reship_awb: 'TEST000009', reship_created_at: new Date(NOW - 4 * DAY).toISOString(), reship_courier_status: 'delivered' }); }

// Velocity disputes as the real API returned them on 6 Oct (status "raised" = panel "In Review")
for (const [o, at] of [['2731', '2026-10-04T19:55:03.252+05:30'], ['3536', '2026-10-04T19:54:50.852+05:30']]) {
	const r = rows.find((x) => x.order_no === o);
	if (r) { r.stage = 'claim'; r.disputes = [{ id: `d-${o}`, images: [], reason: `RTO for order #Dropy-${o} is marked "RTO Delivered" on 29 Sep 2026 21:01 IST, but it has not been received at our warehouse. Please share POD within 48 hours, or treat it as lost and settle the claim.`, status: 'raised', raised_at: at, dispute_type: 'mdnd' }]; }
}

const settings = [
	{ key: 'mdnd_hours', value: 48 }, { key: 'delayed_days', value: 3 }, { key: 'dispute_window_days', value: 7 },
	{ key: 'velocity_last_sync', value: { ok: true, at: new Date(NOW - 6 * 60_000).toISOString(), fetched: { unique: 206 } } }
];
const rtoItems = rows.map((r, i) => ({ id: `item-${i}`, rto_id: r.id, sku: `SKU-${r.order_no}`, title: `Item of #${r.order_no}`, qty: 1, is_gift: false, ready_stock_state: 'na' }));
// #3048: real dropy.in SKUs (2 real, 1 fake) + a free gift, and an address, for the product-link check
{ const r = rows.find((x) => x.order_no === '3048');
  r.ship = { full_address: 'Flat 2, MG Road', city: 'Gulbarga', state: 'Karnataka', zip: '585102' };
  for (let k = rtoItems.length - 1; k >= 0; k--) if (rtoItems[k].rto_id === r.id) rtoItems.splice(k, 1);
  rtoItems.push(
    { id: 'it-a', rto_id: r.id, sku: 'Dropy-B0CWJSFYWT', title: 'Dr. Westin Childs T2 Cream Thyroid Support Lotion', qty: 1, is_gift: false, ready_stock_state: 'na' },
    { id: 'it-b', rto_id: r.id, sku: 'Dropy-B0F67B33PQ', title: 'ROUND LAB Birch Juice Icy Cooling Eye Stick', qty: 2, is_gift: false, ready_stock_state: 'na' },
    { id: 'it-c', rto_id: r.id, sku: 'Dropy-B0FAKE12345', title: 'Item that is not on the store', qty: 1, is_gift: false, ready_stock_state: 'na' },
    { id: 'it-d', rto_id: r.id, sku: null, title: 'Foaming cleanser sample', qty: 1, is_gift: true, ready_stock_state: 'na' }); }
for (const r of rows) r.amount_collected = r.payment_mode === 'prepaid' ? r.order_value : r.payment_mode === 'partial' ? Math.round(r.order_value * 0.26 * 100) / 100 : 0;
for (const r of rows) Object.assign(r, { callback_attempts: 0, refund_state: r.refund_state ?? 'na', scanned_at: null, reship_state: r.reship_state ?? 'none' });
settings.push({ key: 'max_call_attempts', value: 3 });
const events = [];
const claims = rows.filter((r) => r.disputes).map((r, i) => ({ id: `c-${i}`, rto_id: r.id, reason: 'mdnd', status: 'raised', deadline_at: '2026-10-06T14:24:00Z', approved_at: null, raised_at: r.disputes[0].raised_at }));
const claimMoney = claims.map((c) => ({ claim_id: c.id, outstanding: rows.find((r) => r.id === c.rto_id).order_value }));
const tables = { rtos: rows, claims, claim_money: claimMoney, settings, rto_items: rtoItems, events };
const STAGE_OF = { received_call: 'to_call', ready_stock: 'ready_stock', reship: 'reship', hold: 'hold', close: 'closed', reship_confirm: 'closed' };
function mockAction({ p_rto, p_action, p_args = {} }) {
	const r = rows.find((x) => x.id === p_rto);
	if (!r) return [400, { message: 'DRC_NOT_FOUND' }];
	if (p_action === 'ready_stock' && ['prepaid', 'partial'].includes(r.payment_mode) && !['refund', 'credit'].includes(p_args.money)) return [400, { message: 'DRC_MONEY_CHOICE_REQUIRED' }];
	if (p_action === 'reship' && !p_args.reship_date) return [400, { message: 'DRC_RESHIP_DATE_REQUIRED' }];
	const before = { stage: r.stage, scanned_at: r.scanned_at, refund_state: r.refund_state, callback_attempts: r.callback_attempts, reship_state: r.reship_state };
	let to = STAGE_OF[p_action];
	if (p_action === 'call_no_answer') { r.callback_attempts++; to = r.callback_attempts >= 3 ? 'hold' : 'to_call'; }
	if (p_action === 'reship_reject') { to = r.stage; r.reship_state = 'rejected'; }
	if (p_action === 'reship_confirm') r.reship_state = 'confirmed';
	if (p_action === 'ready_stock') r.refund_state = p_args.money === 'refund' ? 'due' : p_args.money === 'credit' ? 'credit_due' : 'na';
	if (p_action === 'reship') r.reship_date = p_args.reship_date;
	if (p_args.scanned && !r.scanned_at) r.scanned_at = new Date().toISOString();
	const from = r.stage; r.stage = to;
	const id = ++eventId;
	events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: p_action, from, to, before, args: p_args } });
	return [200, { event_id: id, from, to }];
}
function mockUndo({ p_event }) {
	const e = events.find((x) => x.id === p_event && x.kind === 'stage_change');
	if (!e) return [400, { message: 'DRC_NOT_FOUND' }];
	if (e.payload.undone) return [400, { message: 'DRC_ALREADY_UNDONE' }];
	const r = rows.find((x) => x.id === e.rto_id);
	Object.assign(r, e.payload.before);
	e.payload.undone = true;
	events.unshift({ id: ++eventId, source: 'user', rto_id: r.id, kind: 'undo', received_at: new Date().toISOString(), payload: { undid: e.id, restored_stage: r.stage } });
	return [200, { rto_id: r.id, stage: r.stage }];
}

// Fake Velocity /shipments search for the re-ship check (VELOCITY_API_URL=http://127.0.0.1:54321/velocity)
// MOCK_VEL_DELAY_MS = answer time per search; order MOCK_VEL_HANG never answers.
const VEL_DELAY = Number(process.env.MOCK_VEL_DELAY_MS ?? 300);
const VEL_HANG = process.env.MOCK_VEL_HANG ?? '';
let velCalls = 0;

let eventId = 100;
const rpcLog = [];
http.createServer(async (req, res) => {
	const u = new URL(req.url, 'http://x');
	const tname = u.pathname.replace('/rest/v1/', '');
	if (req.method === 'POST' && !u.pathname.startsWith('/rest/v1/rpc/') && tables[tname] && tname !== 'settings') {
		let body = '';
		for await (const c of req) body += c;
		const recs = [].concat(JSON.parse(body || '[]')).map((x) => ({ id: x.id ?? `00000000-0000-0000-0000-${String(900000 + ++eventId).padStart(12, '0')}`, received_at: new Date().toISOString(), ...x }));
		if (tname === 'events') tables.events.unshift(...recs); else tables[tname].push(...recs);
		const one = (req.headers.accept ?? '').includes('vnd.pgrst.object');
		res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(one ? recs[0] : recs));
		return;
	}
	if (u.pathname.startsWith('/rest/v1/rpc/')) {
		let body = '';
		for await (const c of req) body += c;
		const fn = u.pathname.split('/').pop();
		const args = JSON.parse(body || '{}');
		rpcLog.push({ fn, args });
		if (fn === 'rto_action' || fn === 'undo_rto_action') {
			const [st, out] = fn === 'rto_action' ? mockAction(args) : mockUndo(args);
			res.writeHead(st, { 'content-type': 'application/json' }).end(JSON.stringify(out));
			return;
		}
		if (fn === 'record_reship_checks') {
			const found = (args.p_rows ?? []).filter((x) => x.reship_order_no).length;
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ checked: (args.p_rows ?? []).length, found, new: found }));
			return;
		}
		res.writeHead(404).end('{}');
		return;
	}
	if (u.pathname === '/velocity/shipments') {
		let body = '';
		for await (const c of req) body += c;
		const { search } = JSON.parse(body || '{}');
		velCalls++;
		if (VEL_HANG && (VEL_HANG === 'ALL' || search === VEL_HANG)) return; // never answers
		await new Promise((r) => setTimeout(r, VEL_DELAY));
		const data = search === '2954'
			? [{ attributes: { order: { display_id: '#Dropy-2954-1' }, created_at: new Date(NOW - 4 * DAY).toISOString(), status: 'delivered', tracking_number: 'TEST000009', items: [{ sku: 'SKU-2954' }] } }]
			: [];
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data, meta: { total: data.length } }));
		return;
	}
	if (u.pathname === '/__vel_calls') { res.writeHead(200).end(String(velCalls)); return; }
	if (u.pathname === '/__rpc_log') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rpcLog)); return; }
	const t = u.pathname.replace('/rest/v1/', '');
	let data = tables[t];
	if (!data) { res.writeHead(404).end('{}'); return; }
	// minimal PostgREST filters: col=eq.x, col=in.(a,b), col=not.is.null, order=col.asc.nullsfirst
	for (const [k, v] of u.searchParams) {
		if (['select', 'order', 'offset', 'limit'].includes(k)) continue;
		if (v.startsWith('eq.')) data = data.filter((r) => String(r[k]) === v.slice(3));
		else if (v.startsWith('in.(')) { const vs = v.slice(4, -1).split(','); data = data.filter((r) => vs.includes(String(r[k] ?? 'none'))); }
		else if (v === 'not.is.null') data = data.filter((r) => r[k] != null);
		else if (v.startsWith('gte.')) data = data.filter((r) => r[k] != null && String(r[k]) >= v.slice(4));
		else if (v.startsWith('lt.')) data = data.filter((r) => r[k] != null && String(r[k]) < v.slice(3));
	}
	const off = Number(u.searchParams.get('offset') ?? 0), lim = Number(u.searchParams.get('limit') ?? 1e9);
	const range = req.headers.range?.match(/(\d+)-(\d+)/);
	data = range ? data.slice(+range[1], +range[2] + 1) : data.slice(off, off + lim);
	if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) {
		if (data.length !== 1) { res.writeHead(406, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'PGRST116', message: 'not one row' })); return; }
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data[0]));
		return;
	}
	res.writeHead(200, { 'content-type': 'application/json', 'content-range': `0-${data.length}/*` }).end(JSON.stringify(data));
}).listen(54321, '127.0.0.1', () => {
	const by = rows.reduce((m, r) => ((m[r.stage] = (m[r.stage] ?? 0) + 1), m), {});
	const aw = rows.filter((r) => r.stage === 'awaiting_receipt');
	console.log('mock supabase :54321', rows.length, 'rtos', JSON.stringify(by), 'awaiting ₹', aw.reduce((s, r) => s + r.order_value, 0));
});
