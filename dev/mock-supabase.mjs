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
let used = new Set([1146, 1595, 2529, 3315, 2765, 3048, 3536, 4024, 2731, 3544, 3946, 2876, 2951, 2954, 1098, 1032, 3479, 3082, 3673, 4301]);
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
// Phase 4: long-stuck parcels coming back (no tracking movement for weeks)
add({ order_no: '1146', order_value: 3250, carrier_name: 'DTDC Standard', courier_status: 'rto_in_transit', last_movement_at: iso(91), last_event_at: iso(91), last_event_text: 'RTO In Transit', last_event_location: 'DELHI HUB , DELHI' });
add({ order_no: '1595', order_value: 2140, carrier_name: 'Delhivery', courier_status: 'rto_in_transit', last_movement_at: iso(42), last_event_at: iso(42), last_event_text: 'Bag Received at Facility', last_event_location: 'Bhiwandi_Mankoli_HB' });
add({ stage: 'lost', courier_status: 'lost', order_no: '3082', order_value: 3977, carrier_name: 'Delhivery', forward_awb: '38539512054802', last_movement_at: iso(19), last_event_at: iso(19) });

// one "Arrived, not scanned" RTO that the hourly check found re-shipped (Phase 3a)
{ const r = rows.find((x) => x.order_no === '2954'); Object.assign(r, { reship_state: 'pending', reship_order_no: '2954-1', reship_awb: 'TEST000009', reship_created_at: new Date(NOW - 4 * DAY).toISOString(), reship_courier_status: 'delivered' }); }

// Phase 3d: DTDC marked 3 RTOs "delivered" in the same minute (bulk update), none scanned
{ const t = new Date(NOW - 3.2 * DAY); t.setUTCSeconds(10, 0);
  for (const [o, sec] of [['3946', 10], ['2876', 25], ['2951', 50]]) { const r = rows.find((x) => x.order_no === o); const d = new Date(t); d.setUTCSeconds(sec);
    Object.assign(r, { carrier_name: 'DTDC Standard', rto_delivered_at: d.toISOString(), last_event_text: 'Return - Delivered', last_event_location: 'VASHI BRANCH , MUMBAI' }); } }

// Velocity disputes as the real API returned them on 6 Oct (status "raised" = panel "In Review")
for (const [o, at] of [['2731', '2026-10-04T19:55:03.252+05:30'], ['3536', '2026-10-04T19:54:50.852+05:30']]) {
	const r = rows.find((x) => x.order_no === o);
	if (r) { r.stage = 'claim'; r.disputes = [{ id: `d-${o}`, images: [], reason: `RTO for order #Dropy-${o} is marked "RTO Delivered" on 29 Sep 2026 21:01 IST, but it has not been received at our warehouse. Please share POD within 48 hours, or treat it as lost and settle the claim.`, status: o === '3536' ? 'rejected' : 'raised', raised_at: at, dispute_type: 'mdnd' }]; }
}

const settings = [
	{ key: 'mdnd_hours', value: 48 }, { key: 'delayed_days', value: 3 }, { key: 'dispute_window_days', value: 7 }, { key: 'stuck_days', value: 7 }, { key: 'follow_up_hours', value: 48 }, { key: 'mdnd_hours_dtdc', value: 72 },
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
const claims = rows.filter((r) => r.disputes).map((r, i) => ({ id: `00000000-0000-0000-0000-c0000000000${i}`, rto_id: r.id, reason: 'mdnd', status: 'raised', channel: 'panel_dispute', ticket_ref: null, claimed_amount: r.order_value, description: null, created_at: r.disputes[0].raised_at, deadline_at: '2026-10-06T14:24:00Z', approved_at: null, raised_at: r.disputes[0].raised_at }));
// Phase 3c: #3379 on Hold (wrong product received), partial COD with Velocity's "Pay on Delivery" dummy line
{ const r = rows.find((x) => x.stage === 'hold' && x.forward_awb);
  Object.assign(r, { order_no: '3379', order_value: 3100, payment_mode: 'partial', amount_collected: 806, carrier_name: 'DTDC', forward_awb: '7D139900001', rto_delivered_at: new Date(NOW - 3 * DAY).toISOString(), notes: '[06 Oct] Wrong product received' });
  for (let k = rtoItems.length - 1; k >= 0; k--) if (rtoItems[k].rto_id === r.id) rtoItems.splice(k, 1);
  rtoItems.push(
    { id: '00000000-0000-0000-0000-00000000a001', rto_id: r.id, sku: 'Dropy-B0CWJSFYWT', title: 'Dr. Westin Childs T2 Cream Thyroid Support Lotion, 4 oz', qty: 1, is_gift: false, ready_stock_state: 'na', condition: 'pending' },
    { id: '00000000-0000-0000-0000-00000000a002', rto_id: r.id, sku: 'Dropy-B0F67B33PQ', title: 'ROUND LAB Birch Juice Icy Cooling Eye Stick', qty: 1, is_gift: false, ready_stock_state: 'na', condition: 'pending' },
    { id: '00000000-0000-0000-0000-00000000a003', rto_id: r.id, sku: null, title: 'Pay on Delivery', qty: 1, is_gift: false, ready_stock_state: 'na', condition: 'pending' }); }
const rtoMedia = [];
// Phase 3e: Ready Stock RTOs → their items In stock (as 0009 does); some prepaid ones still owe a refund / credit
for (const it of rtoItems) Object.assign(it, { condition: it.condition ?? 'pending', reused_qty: 0, reused_orders: [], ready_stock_at: null });
{ let k = 0;
  for (const r of rows.filter((x) => x.stage === 'ready_stock')) {
    for (const it of rtoItems.filter((i) => i.rto_id === r.id)) Object.assign(it, { ready_stock_state: 'in_stock', ready_stock_at: r.rto_delivered_at ?? new Date(NOW - 5 * DAY).toISOString(), qty: k % 4 === 0 ? 2 : 1 });
    if (r.payment_mode !== 'cod' && k % 2 === 0) r.refund_state = k % 4 === 0 ? 'due' : 'credit_due';
    k++;
  } }
// Phase 6: claims money can be matched to (#3082 lost ₹3,977 / cap ₹2,500; #3315 ₹12,049 ticket → ₹5,000 cap), and #1419 ₹1,728 with no claim
{ const r3082 = rows.find((x) => x.order_no === '3082'); claims.push({ id: '00000000-0000-0000-0000-c00000003082', rto_id: r3082.id, reason: 'lost', status: 'raised', channel: 'support_ticket', ticket_ref: '#105643', claimed_amount: 3977, expected_amount: 2500, description: null, created_at: '2026-09-20T06:00:00Z', deadline_at: null, approved_at: null, raised_at: '2026-09-20T06:00:00Z' });
  const r3315 = rows.find((x) => x.order_no === '3315'); claims.push({ id: '00000000-0000-0000-0000-c00000003315', rto_id: r3315.id, reason: 'lost', status: 'raised', channel: 'support_ticket', ticket_ref: '#106373', claimed_amount: 12049, expected_amount: 2500, description: null, created_at: '2026-10-05T06:00:00Z', deadline_at: null, approved_at: null, raised_at: '2026-10-05T06:00:00Z' });
  const rs = rows.find((x) => x.stage === 'ready_stock' && x.forward_awb); Object.assign(rs, { order_no: '1419', order_value: 1728 }); }
const claimMoney = claims.map((c) => ({ claim_id: c.id, received_amount: 0, outstanding: c.expected_amount ?? rows.find((r) => r.id === c.rto_id).order_value }));
const ledger = [];
const tables = { rtos: rows, claims, claim_money: claimMoney, settings, rto_items: rtoItems, events, rto_media: rtoMedia, ledger };
Object.defineProperty(tables, 'ledger_monthly', { enumerable: true, get() {
	const m = new Map();
	for (const l of ledger) { const k = [l.at.slice(0, 7), l.category, l.txn_type].join('|'); const a = m.get(k) ?? { source: 'velocity_passbook', month: l.at.slice(0, 7), category: l.category, txn_type: l.txn_type, n: 0, amount: 0 }; a.n++; a.amount += Number(l.amount); m.set(k, a); }
	return [...m.values()];
} });
function mockImportLedger({ p_source, p_rows }) {
	if (!Array.isArray(p_rows) || !p_rows.length) return [400, { message: 'DRC_NO_ROWS' }];
	let fresh = 0, claim = 0;
	for (const r of p_rows) {
		const hash = [p_source, r.at, r.type, r.amount, r.awb, r.balance, r.notes].join('|');
		if (ledger.some((l) => l.row_hash === hash)) continue;
		ledger.push({ id: `00000000-0000-0000-0000-${String(700000000000 + ledger.length)}`, row_hash: hash, at: r.at, txn_type: r.type, amount: r.amount, balance: r.balance, awb: r.awb || null, notes: r.notes, category: r.category, credit_id: null, credit: null, label: null, label_note: null });
		fresh++; if (r.category === 'claim_credit') claim++;
	}
	const s = settings.find((x) => x.key === 'ledger_last_import'); const ats = p_rows.map((r) => r.at).sort();
	const v = { at: new Date().toISOString(), read: p_rows.length, new: fresh, from: ats[0], to: ats.at(-1) };
	if (s) s.value = v; else settings.push({ key: 'ledger_last_import', value: v });
	return [200, { read: p_rows.length, new: fresh, already: p_rows.length - fresh, claim_money_new: claim, linked_to_typed: 0 }];
}
function mockLedgerAction({ p_args }) {
	const l = ledger.find((x) => x.id === p_args.ledger_id);
	if (!l) return [400, { message: 'DRC_NOT_FOUND' }];
	if (l.credit_id) return [400, { message: 'DRC_LEDGER_USED' }];
	l.label = p_args.label ?? null; l.label_note = p_args.label ? p_args.note || null : null;
	return [200, { ledger_id: l.id, label: l.label }];
}
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
const COND = { wrong: ['wrong', 'wrong_product'], damaged: ['damaged', 'damaged'], missing: ['missing', 'missing_items'], leak: ['leak', 'damaged'], empty: ['empty', 'missing_items'], near_expiry: ['near_expiry', 'wrong_product'] };
function mockClaim({ p_rto, p_args: a }) {
	const r = rows.find((x) => x.id === p_rto);
	if (!r) return [400, { message: 'DRC_NOT_FOUND' }];
	if (!r.courier) return [400, { message: 'DRC_NO_COURIER' }];
	if (!COND[a.reason]) return [400, { message: 'DRC_BAD_REASON' }];
	if (claims.some((c) => c.rto_id === r.id && !['closed', 'rejected'].includes(c.status))) return [400, { message: 'DRC_CLAIM_EXISTS' }];
	const miss = ['unboxing_video', 'front', 'back', 'label'].filter((k) => !a.media.some((m) => m.kind === k && m.drive_file_id));
	if (miss.length) return [400, { message: `DRC_MEDIA_REQUIRED ${miss}` }];
	const before = { stage: r.stage, scanned_at: r.scanned_at, refund_state: r.refund_state, callback_attempts: r.callback_attempts, reship_state: r.reship_state, notes: r.notes, media_state: r.media_state ?? 'none', media_folder_id: r.media_folder_id ?? null };
	const itemsBefore = rtoItems.filter((i) => a.items.includes(i.id) || a.restock.includes(i.id)).map((i) => ({ id: i.id, condition: i.condition ?? 'pending', ready_stock_state: i.ready_stock_state }));
	for (const i of rtoItems) {
		if (a.items.includes(i.id)) i.condition = COND[a.reason][0];
		if (a.restock.includes(i.id)) Object.assign(i, { condition: 'ok', ready_stock_state: 'in_stock' });
	}
	const cid = `00000000-0000-0000-0000-c${String(++eventId).padStart(11, '0')}`;
	claims.unshift({ id: cid, rto_id: r.id, reason: COND[a.reason][1], status: 'draft', channel: 'panel_dispute', ticket_ref: null, claimed_amount: r.order_value, description: a.description, created_at: new Date().toISOString(), deadline_at: new Date(Date.parse(r.rto_delivered_at ?? new Date().toISOString()) + 7 * DAY).toISOString(), approved_at: null, raised_at: null });
	claimMoney.push({ claim_id: cid, outstanding: r.order_value });
	const mids = a.media.map((m) => { const id = `00000000-0000-0000-0000-m${String(++eventId).padStart(11, '0')}`; rtoMedia.push({ id, rto_id: r.id, uploaded_at: new Date().toISOString(), trashed_at: null, ...m }); return id; });
	const from = r.stage;
	Object.assign(r, { stage: 'claim', media_state: 'complete', media_folder_id: a.folder_id, scanned_at: a.scanned && !r.scanned_at ? new Date().toISOString() : r.scanned_at });
	if (a.note) r.notes = [r.notes, `[06 Oct] ${a.note}`].filter(Boolean).join('\n');
	const id = ++eventId;
	events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: 'claim', from, to: 'claim', before, claim: { op: 'create', id: cid, reason: a.reason, items_before: itemsBefore, media_ids: mids, n_items: a.items.length, n_restock: a.restock.length }, args: { scanned: !!a.scanned, note: a.note || null } } });
	return [200, { event_id: id, claim_id: cid, from, to: 'claim' }];
}
function mockMdnd({ p_rto, p_args = {} }) {
	const r = rows.find((x) => x.id === p_rto);
	if (!r) return [400, { message: 'DRC_NOT_FOUND' }];
	if (r.stage !== 'awaiting_receipt' || r.scanned_at) return [400, { message: 'DRC_NOT_AWAITING' }];
	if (claims.some((c) => c.rto_id === r.id && !['closed', 'rejected'].includes(c.status))) return [400, { message: 'DRC_CLAIM_EXISTS' }];
	const cid = `00000000-0000-0000-0000-c${String(++eventId).padStart(11, '0')}`;
	claims.unshift({ id: cid, rto_id: r.id, reason: 'mdnd', status: 'draft', channel: 'panel_dispute', ticket_ref: null, claimed_amount: r.order_value, description: p_args.description, created_at: new Date().toISOString(), deadline_at: new Date(Date.parse(r.rto_delivered_at) + 7 * DAY).toISOString(), approved_at: null, raised_at: null });
	claimMoney.push({ claim_id: cid, outstanding: r.order_value });
	const before = { stage: r.stage, scanned_at: r.scanned_at, refund_state: r.refund_state, callback_attempts: r.callback_attempts, reship_state: r.reship_state, notes: r.notes ?? null, media_state: 'none', media_folder_id: null };
	r.stage = 'claim';
	const id = ++eventId;
	events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: 'claim', from: 'awaiting_receipt', to: 'claim', before, claim: { op: 'create', id: cid, reason: 'mdnd', items_before: [], media_ids: [], n_items: 0, n_restock: 0 }, args: { scanned: false } } });
	return [200, { event_id: id, claim_id: cid, from: 'awaiting_receipt', to: 'claim' }];
}
function mockStock({ p_action, p_args }) {
	if (p_action === 'reuse') {
		const it = rtoItems.find((i) => i.id === p_args.item_id);
		if (!it || it.ready_stock_state !== 'in_stock' || it.reused_qty >= it.qty) return [400, { message: 'DRC_NOT_IN_STOCK' }];
		const r = rows.find((x) => x.id === it.rto_id);
		const item_before = { id: it.id, reused_qty: it.reused_qty, reused_orders: [...it.reused_orders], ready_stock_state: it.ready_stock_state };
		const o = String(p_args.order_no ?? '').trim().replace(/^#?(dropy-)?/i, '');
		it.reused_qty++; if (o) it.reused_orders.push(o); if (it.reused_qty >= it.qty) it.ready_stock_state = 'reused';
		const id = ++eventId;
		events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: 'stock_reuse', from: r.stage, to: r.stage, before: { stage: r.stage, refund_state: r.refund_state }, item_before, args: { item: it.title, order_no: o || null, unit: it.reused_qty, qty: it.qty } } });
		return [200, { event_id: id, left: it.qty - it.reused_qty }];
	}
	const r = rows.find((x) => x.id === p_args.rto_id);
	const to = { due: 'done', credit_due: 'credit_done' }[r?.refund_state];
	if (!to) return [400, { message: 'DRC_NOTHING_DUE' }];
	const id = ++eventId;
	events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: 'money_done', from: r.stage, to: r.stage, before: { stage: r.stage, refund_state: r.refund_state }, args: { money: to } } });
	r.refund_state = to;
	return [200, { event_id: id, refund_state: to }];
}
const SNAP = ['status', 'raised_at', 'ticket_ref', 'ticket_url', 'description', 'notes', 'approved_at', 'approved_amount', 'closed_at', 'close_result', 'next_follow_up_at', 'follow_ups', 'last_follow_up_at', 'escalated_at'];
const snap = (c) => Object.fromEntries(SNAP.map((k) => [k, c[k] ?? (k === 'follow_ups' ? 0 : null)]));
function mockClaimAction({ p_claim, p_action, p_args = {} }) {
	const c = claims.find((x) => x.id === p_claim);
	if (!c) return [400, { message: 'DRC_NOT_FOUND' }];
	if (p_action === 'save_text') { c.description = p_args.description; return [200, { claim_id: c.id, status: c.status }]; }
	const OPEN5 = ['raised', 'waiting', 'escalated', 'approved'];
	const next = new Date(Date.now() + 48 * 3_600_000).toISOString();
	const ev = (x, action, extra = {}) => { const r = rows.find((y) => y.id === x.rto_id); const id = ++eventId;
		events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action, from: r.stage, to: r.stage, before: { stage: r.stage }, claim: { op: 'update', id: x.id, claim_before: x._before }, args: p_args, ...extra } }); return id; };
	if (p_action === 'follow_up') {
		if (!OPEN5.includes(c.status)) return [400, { message: 'DRC_CLAIM_NOT_OPEN' }];
		const group = c.channel === 'support_ticket' && c.ticket_ref ? claims.filter((x) => x.channel === 'support_ticket' && x.ticket_ref === c.ticket_ref && OPEN5.includes(x.status)) : [c];
		const batch = `fb${++eventId}`; let first = null;
		for (const x of group) { x._before = snap(x); x.follow_ups = (x.follow_ups ?? 0) + 1; x.last_follow_up_at = new Date().toISOString(); x.next_follow_up_at = next; const id = ev(x, 'claim_follow_up', { batch }); first ??= id; }
		return [200, { event_id: first, claim_id: c.id, status: c.status, n: group.length }];
	}
	if (['escalate', 'withdraw', 'approved', 'credited'].includes(p_action)) {
		c._before = snap(c);
		if (p_action === 'escalate') { if (!p_args.ticket_ref) return [400, { message: 'DRC_TICKET_REF_REQUIRED' }]; const ref = String(p_args.ticket_ref).replace(/^#/, ''); Object.assign(c, { status: 'escalated', escalated_at: new Date().toISOString(), ticket_ref: /^\d+$/.test(ref) ? `#${ref}` : ref, next_follow_up_at: next, description: p_args.description ?? c.description }); }
		if (p_action === 'withdraw') Object.assign(c, { status: 'closed', close_result: 'withdrawn', closed_at: new Date().toISOString() });
		if (p_action === 'approved') { if (!OPEN5.slice(0, 3).includes(c.status)) return [400, { message: 'DRC_CLAIM_NOT_OPEN' }]; Object.assign(c, { status: 'approved', approved_at: new Date().toISOString(), approved_amount: Number(p_args.approved_amount ?? c.claimed_amount), next_follow_up_at: next }); }
		if (p_action === 'credited' && p_args.ledger_id) { const l = ledger.find((x) => x.id === p_args.ledger_id); if (!l || l.category !== 'claim_credit') return [400, { message: 'DRC_NOT_CLAIM_MONEY' }]; if (l.credit_id) return [400, { message: 'DRC_LEDGER_USED' }];
			l.credit_id = `cr-${l.id}`; l.credit = { external_ref: p_args.ticket_ref || null, allocs: [{ claim_id: c.id, amount: l.amount }] }; l.label = null; p_args.amount = l.amount; p_args.ticket_ref ||= 'passbook'; }
		if (p_action === 'credited') { if (!p_args.ticket_ref) return [400, { message: 'DRC_CN_REQUIRED' }]; const target = Number(c.approved_amount ?? c.expected_amount ?? c.claimed_amount); Object.assign(c, { status: 'closed', close_result: Number(p_args.amount) >= target ? 'credited_full' : 'short_paid_accepted', closed_at: new Date().toISOString() }); const m = claimMoney.find((x) => x.claim_id === c.id); if (m) m.outstanding = Math.max(0, target - Number(p_args.amount)); }
		const id = ev(c, `claim_${{ escalate: 'escalated', withdraw: 'withdrawn', approved: 'approved', credited: 'credited' }[p_action]}`);
		return [200, { event_id: id, claim_id: c.id, status: c.status }];
	}
	if (c.status !== 'draft') return [400, { message: 'DRC_CLAIM_NOT_DRAFT' }];
	const claim_before = { status: c.status, raised_at: c.raised_at, ticket_ref: c.ticket_ref, description: c.description };
	Object.assign(c, { status: 'raised', raised_at: new Date().toISOString(), ticket_ref: p_args.ticket_ref ?? c.ticket_ref, description: p_args.description ?? c.description });
	const r = rows.find((x) => x.id === c.rto_id);
	const id = ++eventId;
	events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: 'claim_raised', from: r.stage, to: r.stage, before: { stage: r.stage }, claim: { op: 'raise', id: c.id, claim_before }, args: { ticket_ref: p_args.ticket_ref ?? null } } });
	return [200, { event_id: id, claim_id: c.id, status: 'raised' }];
}
function mockTicket({ p_args: a }) {
	const ref0 = String(a.ticket_ref ?? '').trim().replace(/^#\s*/, '');
	if (!ref0) return [400, { message: 'DRC_TICKET_REF_REQUIRED' }];
	const ref = /^\d+$/.test(ref0) ? `#${ref0}` : ref0;
	const list = (a.rto_ids ?? []).map((id) => rows.find((x) => x.id === id));
	if (!list.length) return [400, { message: 'DRC_NO_PARCELS' }];
	if (list.some((r) => !r)) return [400, { message: 'DRC_NOT_FOUND' }];
	if (new Set(list.map((r) => r.courier)).size > 1) return [400, { message: 'DRC_MIXED_COURIER' }];
	const busy = list.find((r) => claims.some((c) => c.rto_id === r.id && !['closed', 'rejected'].includes(c.status)));
	if (busy) return [400, { message: `DRC_HAS_CLAIM ${busy.order_no}` }];
	const at = a.raised_on && a.raised_on < new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10) ? `${a.raised_on}T06:30:00Z` : new Date().toISOString();
	const batch = `b${++eventId}`;
	let first = null;
	for (const r of list) {
		const reason = r.stage === 'awaiting_receipt' ? 'mdnd' : 'lost';
		const cid = `00000000-0000-0000-0000-c${String(++eventId).padStart(11, '0')}`;
		claims.unshift({ id: cid, rto_id: r.id, reason, status: 'raised', channel: 'support_ticket', ticket_ref: ref, ticket_url: /^#\d+$/.test(ref) ? `https://shipfast.freshdesk.com/support/tickets/${ref.slice(1)}` : null, claimed_amount: r.order_value, description: a.description ?? null, created_at: new Date().toISOString(), deadline_at: null, approved_at: null, raised_at: at });
		claimMoney.push({ claim_id: cid, outstanding: r.order_value });
		const id = ++eventId;
		first ??= id;
		events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: 'ticket_raised', from: r.stage, to: r.stage, batch, before: { stage: r.stage }, claim: { op: 'ticket', id: cid, reason }, args: { ticket_ref: ref, reason, parcels: list.length } } });
	}
	return [200, { event_id: first, batch, n: list.length, ticket_ref: ref, courier: list[0].courier }];
}
function mockCn({ p_args: a }) {
	if (!a.cn) return [400, { message: 'DRC_CN_REQUIRED' }];
	if (ledger.some((l) => l.credit?.external_ref === a.cn)) return [400, { message: `DRC_CN_DONE ${a.cn}` }];
	const total = Math.round(a.rows.reduce((t, x) => t + Number(x.amount), 0) * 100) / 100;
	const l = ledger.filter((x) => x.category === 'claim_credit' && !x.credit_id && Math.abs(Number(x.amount) - total) <= 1).sort((x, y) => Math.abs(x.amount - total) - Math.abs(y.amount - total))[0];
	if (!l) return [400, { message: `DRC_NO_PASSBOOK_LINE ${total}` }];
	const plan = [];
	for (const x of a.rows) { const r = rows.find((y) => y.forward_awb === x.awb); if (!r) return [400, { message: `DRC_CN_UNKNOWN_AWB ${x.awb}` }]; plan.push([x, r]); }
	const batch = `cn${++eventId}`; let left = Number(l.amount); let first = null; let made = 0; const out = []; const allocs = []; const aside = [];
	plan.forEach(([x, r], i) => {
		const amt = i === plan.length - 1 ? Math.round(left * 100) / 100 : Math.round(Number(x.amount) * 100) / 100; left -= amt;
		let c = claims.find((y) => y.rto_id === r.id && ['draft', 'raised', 'waiting', 'escalated', 'approved', 'rejected'].includes(y.status)); const created = !c;
		if (created && r.scanned_at) { aside.push(`#${r.order_no} ₹${amt.toLocaleString('en-IN')}`); const id = ++eventId; first ??= id;
			events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: 'cn_set_aside', from: r.stage, to: r.stage, batch, before: { stage: r.stage }, claim: { op: 'cn', id: null, created: false, aside: true, ledger_id: l.id }, args: { ticket_ref: a.cn, amount: amt, status: x.status } } });
			out.push({ order_no: r.order_no, awb: r.forward_awb, amount: amt, result: 'set_aside', created: false }); return; }
		if (created) { made++; const reason = x.status === 'lost' ? 'lost' : x.status === 'rto_delivered' ? 'mdnd' : 'other';
			c = { id: `00000000-0000-0000-0000-c${String(++eventId).padStart(11, '0')}`, rto_id: r.id, reason, status: 'raised', channel: reason === 'mdnd' ? 'panel_dispute' : 'support_ticket', ticket_ref: null, claimed_amount: r.order_value, expected_amount: Math.min(Number(r.order_value), 2500), created_at: new Date().toISOString(), raised_at: new Date().toISOString() };
			claims.unshift(c); claimMoney.push({ claim_id: c.id, received_amount: 0, outstanding: c.expected_amount }); }
		const before = snap(c); const target = Number(c.approved_amount ?? c.expected_amount ?? c.claimed_amount);
		const result = amt >= target - 0.01 ? 'credited_full' : 'short_paid_accepted';
		Object.assign(c, { status: 'closed', close_result: result, closed_at: new Date().toISOString() });
		const m = claimMoney.find((y) => y.claim_id === c.id); if (m) m.outstanding = Math.max(0, target - amt);
		allocs.push({ claim_id: c.id, amount: amt });
		const id = ++eventId; first ??= id;
		events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: 'claim_credited', from: r.stage, to: r.stage, batch, before: { stage: r.stage }, claim: { op: 'cn', id: c.id, created, claim_before: before, ledger_id: l.id }, args: { ticket_ref: a.cn, amount: amt, result, created } } });
		out.push({ order_no: r.order_no, awb: r.forward_awb, amount: amt, result, created });
	});
	l.credit_id = `cr-${l.id}`; l.credit = { external_ref: a.cn, allocs }; l.label = aside.length ? 'received_parcel' : null; l.label_note = aside.length ? `Set aside from ${a.cn}: ${aside.join(', ')} (parcel we got back, Velocity may take it back)` : null;
	return [200, { event_id: first, cn: a.cn, amount: Number(l.amount), credit_date: l.at.slice(0, 10), orders: out, claims_created: made }];
}
function mockNotArrived({ p_rto, p_note }) {
	const r = rows.find((x) => x.id === p_rto);
	if (!r) return [400, { message: 'DRC_NOT_FOUND' }];
	if (!String(p_note ?? '').trim()) return [400, { message: 'DRC_REASON_REQUIRED' }];
	if (!r.courier) return [400, { message: 'DRC_NO_COURIER' }];
	if (['in_flight', 'delayed', 'lost', 'awaiting_receipt', 'unknown_parcel'].includes(r.stage)) return [400, { message: 'DRC_ALREADY_NOT_ARRIVED' }];
	if (claims.some((c) => c.rto_id === r.id && c.status !== 'closed' && !['lost', 'mdnd'].includes(c.reason))) return [400, { message: 'DRC_HAS_CLAIM' }];
	const its = rtoItems.filter((i) => i.rto_id === r.id);
	if (its.some((i) => i.reused_qty > 0)) return [400, { message: 'DRC_STOCK_USED' }];
	const to = r.courier_status === 'rto_delivered' ? 'awaiting_receipt' : ['lost', 'rto_lost'].includes(r.courier_status) ? 'lost' : r.rto_delivered_at ? 'awaiting_receipt' : 'in_flight';
	const before = { stage: r.stage, scanned_at: r.scanned_at, refund_state: r.refund_state, callback_attempts: r.callback_attempts, reship_state: r.reship_state, notes: r.notes ?? null };
	const back = its.filter((i) => i.ready_stock_state === 'in_stock').map((i) => i.id);
	for (const i of its) if (back.includes(i.id)) i.ready_stock_state = 'na';
	Object.assign(r, { stage: to, scanned_at: null, refund_state: ['due', 'credit_due'].includes(r.refund_state) ? 'na' : r.refund_state, notes: [r.notes, `[8 Oct] Not arrived: ${p_note}`].filter(Boolean).join('\n') });
	const id = ++eventId;
	events.unshift({ id, source: 'user', rto_id: r.id, kind: 'stage_change', received_at: new Date().toISOString(), payload: { action: 'not_arrived', from: before.stage, to, before, items_back: back, args: { note: p_note } } });
	return [200, { event_id: id, from: before.stage, to }];
}
function mockUndo({ p_event }) {
	const e = events.find((x) => x.id === p_event && x.kind === 'stage_change');
	if (!e) return [400, { message: 'DRC_NOT_FOUND' }];
	if (e.payload.undone) return [400, { message: 'DRC_ALREADY_UNDONE' }];
	if (e.payload.batch && e.payload.claim?.op === 'ticket') {
		const sib = events.filter((x) => x.kind === 'stage_change' && x.payload.batch === e.payload.batch && !x.payload.undone);
		for (const x of sib) {
			const i = claims.findIndex((c) => c.id === x.payload.claim.id);
			if (i >= 0) claims.splice(i, 1);
			x.payload.undone = true;
			events.unshift({ id: ++eventId, source: 'user', rto_id: x.rto_id, kind: 'undo', received_at: new Date().toISOString(), payload: { undid: x.id, restored_stage: x.payload.before.stage } });
		}
		return [200, { rto_id: e.rto_id, stage: e.payload.before.stage, n: sib.length }];
	}
	if (e.payload.claim?.op === 'cn') {
		const sib = events.filter((x) => x.kind === 'stage_change' && x.payload.batch === e.payload.batch && !x.payload.undone);
		for (const x of sib) { const k = x.payload.claim; const i = claims.findIndex((c) => c.id === k.id);
			if (i >= 0) { if (k.created) claims.splice(i, 1); else Object.assign(claims[i], k.claim_before); }
			const l = ledger.find((y) => y.id === k.ledger_id); if (l) { l.credit_id = null; l.credit = null; if (l.label_note?.startsWith('Set aside from')) { l.label = null; l.label_note = null; } }
			x.payload.undone = true; }
		return [200, { rto_id: e.rto_id, stage: e.payload.before.stage, n: sib.length }];
	}
	const r = rows.find((x) => x.id === e.rto_id);
	const cl = e.payload.claim;
	if (cl?.op === 'create') {
		const c = claims.find((x) => x.id === cl.id);
		if (c && c.status !== 'draft') return [400, { message: 'DRC_CLAIM_NOT_DRAFT' }];
		for (let k = rtoMedia.length - 1; k >= 0; k--) if (cl.media_ids.includes(rtoMedia[k].id)) rtoMedia.splice(k, 1);
		for (const b of cl.items_before) Object.assign(rtoItems.find((i) => i.id === b.id), b);
		claims.splice(claims.indexOf(c), 1);
	}
	if (cl?.op === 'raise') Object.assign(claims.find((x) => x.id === cl.id), cl.claim_before);
	if (cl?.op === 'update') {
		const sib = e.payload.batch ? events.filter((x) => x.payload?.batch === e.payload.batch && !x.payload.undone) : [e];
		for (const x of sib) { Object.assign(claims.find((y) => y.id === x.payload.claim.id), x.payload.claim.claim_before); x.payload.undone = true;
			for (const l of ledger) if (l.credit?.allocs?.[0]?.claim_id === x.payload.claim.id && x.payload.action === 'claim_credited') { l.credit_id = null; l.credit = null; } }
		return [200, { rto_id: e.rto_id, stage: r.stage, n: sib.length }];
	}
	if (e.payload.item_before) Object.assign(rtoItems.find((i) => i.id === e.payload.item_before.id), e.payload.item_before);
	for (const id of e.payload.items_back ?? []) { const i = rtoItems.find((x) => x.id === id); if (i) i.ready_stock_state = 'in_stock'; }
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
const uploads = [];
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
		if (['rto_action', 'undo_rto_action', 'create_rto_claim', 'claim_action', 'create_mdnd_claim', 'stock_action', 'raise_ticket', 'import_ledger', 'ledger_action', 'apply_credit_note', 'mark_not_arrived'].includes(fn)) {
			const [st, out] = { rto_action: mockAction, undo_rto_action: mockUndo, create_rto_claim: mockClaim, claim_action: mockClaimAction, create_mdnd_claim: mockMdnd, stock_action: mockStock, raise_ticket: mockTicket, import_ledger: mockImportLedger, ledger_action: mockLedgerAction, apply_credit_note: mockCn, mark_not_arrived: mockNotArrived }[fn](args);
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
	if (u.pathname.startsWith('/fake-upload/')) {
		const cors = { 'access-control-allow-origin': req.headers.origin ?? '*', 'access-control-allow-methods': 'PUT, OPTIONS', 'access-control-allow-headers': 'content-type' };
		if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
		let size = 0;
		for await (const c of req) size += c.length;
		await new Promise((r) => setTimeout(r, 600));
		const id = `fakeUp${u.pathname.split('/').pop().padStart(8, '0')}x`;
		uploads.push({ id, name: u.searchParams.get('name'), size, type: req.headers['content-type'] });
		res.writeHead(200, { 'content-type': 'application/json', ...cors }).end(JSON.stringify({ id, name: u.searchParams.get('name'), size: String(size), mimeType: req.headers['content-type'] }));
		return;
	}
	if (u.pathname === '/__uploads') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(uploads)); return; }
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
		else if (v === 'is.null') data = data.filter((r) => r[k] == null);
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
