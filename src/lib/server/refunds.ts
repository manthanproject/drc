import { error } from '@sveltejs/kit';
import { RETURN_ORDERS_ID } from '$app/env/private';
import { db } from './supabase.ts';
import { fail, UUID } from './actions.ts';
import { sheetsReadonly } from './google.ts';
import {
	STATUSES, VIA, TO, cleanColumns, cleanValue, parseRefundSheet,
	type ColumnsSetting, type Refund, type SheetCell
} from '#lib/refunds.ts';

const SHEET_TAB = 'Dropy Refund';

async function columns(): Promise<ColumnsSetting> {
	const { data } = await db().from('settings').select('value').eq('key', 'refund_columns').maybeSingle();
	try {
		return cleanColumns(data?.value ?? {});
	} catch {
		return { custom: [], hidden: [] };
	}
}

/** Everything the Refunds page shows. */
export async function loadRefunds() {
	const [list, cols, imp] = await Promise.all([
		db().from('refunds').select('id, order_no, rto_id, reason, via, refund_to, amount, status, done_at, done_ref, extra, source, created_at, updated_at')
			.is('deleted_at', null).order('created_at', { ascending: false }).limit(2000),
		columns(),
		db().from('settings').select('value').eq('key', 'refund_sheet_import').maybeSingle()
	]);
	if (list.error) throw new Error(`refunds: ${list.error.message}`);
	return { refunds: (list.data ?? []) as Refund[], columns: cols, imported: (imp.data?.value ?? null) as { at?: string; new?: number } | null, now: Date.now() };
}

/** Refunds of one RTO (RTO page). */
export async function refundsForRto(rtoId: string) {
	const { data } = await db().from('refunds').select('id, order_no, rto_id, reason, via, refund_to, amount, status, done_at, done_ref, extra, source, created_at, updated_at')
		.eq('rto_id', rtoId).is('deleted_at', null).order('created_at', { ascending: false });
	return (data ?? []) as Refund[];
}

const MESSAGES: Record<string, [number, string]> = {
	DRC_ORDER_REQUIRED: [400, 'Type the order number'],
	DRC_REFUND_NOT_FOUND: [409, 'This refund was changed or deleted. Refresh the page'],
	DRC_ALREADY_UNDONE: [409, 'Already undone'],
	DRC_UNDO_EXPIRED: [409, 'Too late to undo (10 minutes)'],
	DRC_NOT_LATEST: [409, 'A newer change exists; undo that first'],
	DRC_NOT_FOUND: [404, 'Not found']
};
function refundFail(m: string): never {
	const code = Object.keys(MESSAGES).find((k) => m.includes(k));
	if (code) error(MESSAGES[code][0], MESSAGES[code][1]);
	fail(m);
}

/** POST body → refund_action(). Every field re-checked here. */
export async function refundAction(raw: unknown) {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const action = String(b.action ?? '');
	if (!['create', 'update', 'delete', 'undo'].includes(action)) error(400, 'Unknown action');
	const args: Record<string, unknown> = {};
	if (action === 'undo') {
		const id = Number(b.log_id);
		if (!Number.isInteger(id) || id <= 0) error(400, 'Bad undo');
		args.log_id = id;
	} else {
		if (action !== 'create') {
			if (typeof b.id !== 'string' || !UUID.test(b.id)) error(400, 'Bad refund');
			args.id = b.id;
		}
		if (action !== 'delete') {
			const cols = await columns();
			const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
			if (has('order_no')) args.order_no = String(b.order_no ?? '').trim().slice(0, 40);
			if (has('reason')) args.reason = String(b.reason ?? '').trim().slice(0, 500);
			if (has('via')) {
				if (b.via && !(String(b.via) in VIA)) error(400, 'Pick Bank, PayU or Razorpay');
				args.via = b.via ? String(b.via) : '';
			}
			if (has('refund_to')) {
				if (b.refund_to && !(String(b.refund_to) in TO)) error(400, 'Pick Original method or Store credit');
				args.refund_to = b.refund_to ? String(b.refund_to) : '';
			}
			if (has('amount')) {
				const s = String(b.amount ?? '').replace(/[₹,\s]/g, '');
				const n = Number(s);
				if (s && (!Number.isFinite(n) || n < 0 || n > 1000000)) error(400, 'Type a valid amount');
				args.amount = s ? n.toFixed(2) : '';
			}
			if (has('status')) {
				if (!(STATUSES as readonly string[]).includes(String(b.status))) error(400, 'Pick a status');
				args.status = String(b.status);
			}
			if (has('done_ref')) args.done_ref = String(b.done_ref ?? '').trim().slice(0, 120);
			if (has('done_at')) {
				const d = String(b.done_at ?? '');
				if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) error(400, 'Bad date');
				if (d && d > new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)) error(400, 'Done date must be today or earlier');
				args.done_at = d ? `${d}T12:00:00+05:30` : '';
			}
			if (b.extra && typeof b.extra === 'object') {
				const extra: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(b.extra as Record<string, unknown>)) {
					const col = cols.custom.find((c) => c.key === k);
					if (!col) continue;
					try {
						extra[k] = cleanValue(col, v);
					} catch (e) {
						error(400, (e as Error).message);
					}
				}
				args.extra = extra;
			}
		}
	}
	const { data, error: e } = await db().rpc('refund_action', { p_action: action, p_args: args });
	if (e) refundFail(e.message);
	return data as { refund_id: string; log_id?: number; status?: string };
}

export async function saveColumns(raw: unknown) {
	let value: ColumnsSetting;
	try {
		value = cleanColumns(raw);
	} catch (e) {
		error(400, (e as Error).message);
	}
	const { error: e } = await db().from('settings').upsert({ key: 'refund_columns', value, note: 'Refunds page: columns staff added (custom) and columns hidden' });
	if (e) fail(e.message);
	return value;
}

/** The "Dropy Refund" tab, values + fill of each cell. Read only. (Local dev only: dev/fake-google.mjs can hand in rows.) */
async function readSheet(): Promise<SheetCell[][]> {
	const fake = (globalThis as { __drcRefundSheet?: SheetCell[][] }).__drcRefundSheet;
	if (import.meta.env.DEV && fake) return fake;
	if (!RETURN_ORDERS_ID) throw new Error('RETURN_ORDERS_ID missing');
	const r = await sheetsReadonly().spreadsheets.get({
		spreadsheetId: RETURN_ORDERS_ID,
		ranges: [`'${SHEET_TAB}'!A1:E2000`],
		includeGridData: true,
		fields: 'sheets(properties.title,data.rowData.values(formattedValue,effectiveFormat.backgroundColor))'
	});
	const rows = r.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
	return rows.map((row) => (row.values ?? []).map((v) => {
		const c = v.effectiveFormat?.backgroundColor;
		return { text: String(v.formattedValue ?? ''), bg: c ? { red: c.red ?? 0, green: c.green ?? 0, blue: c.blue ?? 0 } : null };
	}));
}

/** One-time copy of the sheet tab. dry = report only. */
export async function importSheet(dry: boolean) {
	let cells: SheetCell[][];
	try {
		cells = await readSheet();
	} catch (e) {
		console.error('refund sheet read failed:', e);
		error(502, `Could not read the "${SHEET_TAB}" tab. Nothing imported`);
	}
	const parsed = parseRefundSheet(cells);
	const seen = new Map<string, number>();
	for (const r of parsed.rows) seen.set(r.order_no, (seen.get(r.order_no) ?? 0) + 1);
	const twice = [...seen].filter(([, n]) => n > 1).map(([o]) => o);
	if (!parsed.rows.length) error(400, `No orders found in the "${SHEET_TAB}" tab`);
	const { data, error: e } = await db().rpc('import_refunds', { p_rows: parsed.rows, p_dry_run: dry });
	if (e) {
		const m = e.message.match(/DRC_DRY_RUN (\{.*\})/);
		if (m) return { ...JSON.parse(m[1]), rows: parsed.rows.length, skipped: parsed.skipped, twice };
		if (e.message.includes('DRC_ALREADY_IMPORTED')) error(409, 'The sheet was already imported');
		fail(e.message);
	}
	return { ...(data as object), rows: parsed.rows.length, skipped: parsed.skipped, twice };
}
