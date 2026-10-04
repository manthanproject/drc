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
	add({ order_no: order ?? undefined, order_value: value, stage: 'awaiting_receipt', courier_status: 'rto_delivered',
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

const settings = [
	{ key: 'mdnd_hours', value: 48 }, { key: 'delayed_days', value: 3 }, { key: 'dispute_window_days', value: 7 },
	{ key: 'velocity_last_sync', value: { ok: true, at: new Date(NOW - 6 * 60_000).toISOString(), fetched: { unique: 206 } } }
];
const tables = { rtos: rows, claims: [], claim_money: [], settings };

http.createServer((req, res) => {
	const u = new URL(req.url, 'http://x');
	const t = u.pathname.replace('/rest/v1/', '');
	let data = tables[t];
	if (!data) { res.writeHead(404).end('{}'); return; }
	const keyIn = u.searchParams.get('key');
	if (keyIn?.startsWith('in.(')) { const ks = keyIn.slice(4, -1).split(','); data = data.filter((r) => ks.includes(r.key)); }
	const off = Number(u.searchParams.get('offset') ?? 0), lim = Number(u.searchParams.get('limit') ?? 1e9);
	const range = req.headers.range?.match(/(\d+)-(\d+)/);
	data = range ? data.slice(+range[1], +range[2] + 1) : data.slice(off, off + lim);
	res.writeHead(200, { 'content-type': 'application/json', 'content-range': `0-${data.length}/*` }).end(JSON.stringify(data));
}).listen(54321, '127.0.0.1', () => {
	const by = rows.reduce((m, r) => ((m[r.stage] = (m[r.stage] ?? 0) + 1), m), {});
	const aw = rows.filter((r) => r.stage === 'awaiting_receipt');
	console.log('mock supabase :54321', rows.length, 'rtos', JSON.stringify(by), 'awaiting ₹', aw.reduce((s, r) => s + r.order_value, 0));
});
