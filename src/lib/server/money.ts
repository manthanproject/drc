import { error } from '@sveltejs/kit';
import { db } from './supabase.ts';
import { fail, UUID } from './actions.ts';
import { allRtos } from './rto-data.ts';
import { categoryOf, monthly, type LedgerRow, type MonthlyRow } from '#lib/money.ts';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/;
const MAX_ROWS = 2000; // per request; the page sends a big file in parts

/** Import one part of a passbook the browser already parsed. Every row re-checked here; category recomputed. */
export async function importRows(raw: unknown) {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const list = Array.isArray(b.rows) ? b.rows : [];
	if (!list.length) error(400, 'No passbook lines to import');
	if (list.length > MAX_ROWS) error(400, `Up to ${MAX_ROWS} lines per part`);
	const rows: LedgerRow[] = [];
	for (const x of list as Record<string, unknown>[]) {
		const type = x?.type === 'credit' || x?.type === 'debit' ? x.type : null;
		const amount = Number(x?.amount);
		const at = typeof x?.at === 'string' && ISO.test(x.at) ? x.at : null;
		if (!type || !Number.isFinite(amount) || amount < 0 || !at) error(400, 'A passbook line is malformed. Re-download the file and try again');
		const notes = String(x.notes ?? '').slice(0, 300);
		const bal = Number(x.balance);
		rows.push({ at, type, amount: amount.toFixed(2), balance: x.balance === '' || !Number.isFinite(bal) ? '' : bal.toFixed(2),
			awb: String(x.awb ?? '').trim().slice(0, 40), notes, category: categoryOf(notes, type) });
	}
	const { data, error: e } = await db().rpc('import_ledger', { p_source: 'velocity_passbook', p_rows: rows });
	if (e) fail(e.message);
	return data as { read: number; new: number; already: number; claim_money_new: number; linked_to_typed: number };
}

/** Mark claim money that is not a claim: 'received_parcel' | 'not_claim', or null to clear. */
export async function labelLine(raw: unknown) {
	const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	if (typeof b.ledger_id !== 'string' || !UUID.test(b.ledger_id)) error(400, 'Bad line');
	const label = b.label === 'received_parcel' || b.label === 'not_claim' ? b.label : null;
	const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) : '';
	const { data, error: e } = await db().rpc('ledger_action', { p_action: 'label', p_args: { ledger_id: b.ledger_id, label, note } });
	if (e) fail(e.message);
	return data;
}

export interface MoneyLine {
	id: string;
	at: string;
	amount: number | string;
	notes: string | null;
	label: string | null;
	label_note: string | null;
	credit_id: string | null;
	credit: { external_ref: string | null; allocs: { claim_id: string; amount: number | string }[] } | null;
}
export interface MoneyClaim {
	id: string;
	rto_id: string;
	status: string;
	reason: string;
	channel: string | null;
	ticket_ref: string | null;
	claimed_amount: number | string;
	expected_amount: number | string | null;
	approved_amount: number | string | null;
	approved_at: string | null;
	raised_at: string | null;
	close_result: string | null;
}

/** Everything the Money screen shows. Read only. */
export async function loadMoney() {
	const [lines, claims, money, months, last, rtos] = await Promise.all([
		db().from('ledger').select('id, at, amount, notes, label, label_note, credit_id, credit:credits(external_ref, allocs:credit_allocations(claim_id, amount))')
			.eq('category', 'claim_credit').order('at', { ascending: false }).limit(300),
		db().from('claims').select('id, rto_id, status, reason, channel, ticket_ref, claimed_amount, expected_amount, approved_amount, approved_at, raised_at, close_result'),
		db().from('claim_money').select('claim_id, received_amount, outstanding'),
		db().from('ledger_monthly').select('source, month, category, txn_type, n, amount').eq('source', 'velocity_passbook'),
		db().from('settings').select('value').eq('key', 'ledger_last_import').maybeSingle(),
		allRtos()
	]);
	for (const [n, r] of [['ledger', lines], ['claims', claims], ['claim_money', money], ['ledger_monthly', months]] as const)
		if (r.error) throw new Error(`${n}: ${r.error.message}`);
	const owed = new Map((money.data ?? []).map((m) => [m.claim_id as string, m]));
	const allClaims = (claims.data ?? []) as MoneyClaim[];
	const want = new Set(allClaims.map((c) => c.rto_id));
	return {
		lines: (lines.data ?? []) as unknown as MoneyLine[],
		claims: allClaims.map((c) => ({ ...c, outstanding: owed.get(c.id)?.outstanding ?? null, received: owed.get(c.id)?.received_amount ?? 0 })),
		// every RTO, light: order value matching finds money for parcels with no claim (e.g. "lost" but received)
		rtos: rtos.map((r) => ({ id: r.id, order_no: r.order_no, order_value: r.order_value, forward_awb: r.forward_awb, stage: r.stage, carrier_name: r.carrier_name, claimed: want.has(r.id) })),
		months: monthly((months.data ?? []) as MonthlyRow[]),
		lastImport: (last.data?.value ?? null) as { at?: string; read?: number; new?: number; from?: string; to?: string } | null,
		now: Date.now()
	};
}
