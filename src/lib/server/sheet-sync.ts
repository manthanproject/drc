import { RETURN_ORDERS_ID } from '$app/env/private';
import { sheetsWriter } from './google.ts';
import { db } from './supabase.ts';
import { TAB, parseSheet, parseOrders, compare, planCounts, sheetText, drcCell, colLetter, COURIER_STAGES, type Plan, type Baseline, type DrcRto } from '#lib/sheet-sync.ts';
import { istDate, shiftDay } from '#lib/scanlog.ts';

/**
 * Sheet ↔ DRC for the "Return Orders" tab of Dropy Return Orders. Every range below is prefixed with that exact tab
 * title; no other tab is read or written. Rows are never deleted or reordered: DRC appends new rows and rewrites only
 * the "RTO - Status" cell of a row, after re-reading the Order ID column to make sure the row did not move.
 */
const R = `'${TAB}'`;
// dev: dev/fake-google.mjs can stand in for Google (FAKE_RETURN_SHEET)
const sheetsApi = () => ((globalThis as { __drcSheetsFake?: ReturnType<typeof sheetsWriter> }).__drcSheetsFake ?? sheetsWriter()).spreadsheets;
const istDay = (iso: string) => istDate(Date.parse(iso));

async function readTab() {
	if (!RETURN_ORDERS_ID) throw new Error('RETURN_ORDERS_ID missing');
	const api = sheetsApi();
	const meta = await api.get({ spreadsheetId: RETURN_ORDERS_ID, fields: 'sheets.properties(title)' });
	if (!meta.data.sheets?.some((s) => s.properties?.title === TAB)) throw new Error(`The sheet has no "${TAB}" tab`);
	const { data } = await api.values.get({ spreadsheetId: RETURN_ORDERS_ID, range: `${R}!A1:Z` });
	return parseSheet((data.values ?? []) as unknown[][]);
}

async function loadDrc(): Promise<DrcRto[]> {
	const out: DrcRto[] = [];
	for (let from = 0; ; from += 1000) {
		const { data, error } = await db()
			.from('rtos')
			.select('id, order_no, kind, stage, payment_mode, scanned_at, received_on, reship_date, legacy_source, rto_delivered_at, created_at, updated_at, items:rto_items(title, sku, qty)')
			.not('order_no', 'is', null)
			.order('created_at', { ascending: true })
			.range(from, from + 999);
		if (error) throw new Error(`rtos: ${error.message}`);
		out.push(...((data ?? []) as unknown as DrcRto[]));
		if ((data ?? []).length < 1000) break;
	}
	return out;
}

async function loadBaselines(): Promise<Baseline[]> {
	const { data, error } = await db().from('sheet_sync').select('order_no, sheet_text, drc_stage, state');
	if (error) throw new Error(`sheet_sync: ${error.message}`);
	return (data ?? []) as Baseline[];
}

async function saveBaselines(rows: Baseline[]) {
	if (!rows.length) return;
	const at = new Date().toISOString();
	const { error } = await db().from('sheet_sync').upsert(rows.map((r) => ({ ...r, updated_at: at })));
	if (error) throw new Error(`sheet_sync save: ${error.message}`);
}

export async function sheetPlan(now = Date.now()) {
	const [sheet, rtos, baselines] = await Promise.all([readTab(), loadDrc(), loadBaselines()]);
	return { sheet, plan: compare(sheet, rtos, baselines, now, istDay), rtos };
}

export async function getAuto(): Promise<boolean> {
	const { data } = await db().from('settings').select('value').eq('key', 'sheet_sync_auto').maybeSingle();
	return data?.value === true;
}
export async function setAuto(on: boolean) {
	const { error } = await db().from('settings').upsert({ key: 'sheet_sync_auto', value: on, note: 'Sheet ↔ DRC: true = the cron applies changes; false = it only checks' });
	if (error) throw new Error(error.message);
}

/** Re-read the Order ID column; keep only writes whose row still holds the same order. */
async function stillThere(cols: { order: number }, rows: { row: number; order: string }[]) {
	if (!rows.length) return new Set<number>();
	const col = colLetter(cols.order);
	const { data } = await sheetsApi().values.get({ spreadsheetId: RETURN_ORDERS_ID!, range: `${R}!${col}1:${col}` });
	const vals = (data.values ?? []).map((v) => String(v?.[0] ?? ''));
	const ok = new Set<number>();
	for (const r of rows) {
		if (parseOrders(vals[r.row - 1] ?? '').includes(r.order)) ok.add(r.row);
	}
	return ok;
}

async function writeCells(cols: { order: number }, items: { row: number; order: string; col: number; value: string }[]) {
	const ok = await stillThere(cols, items);
	const go = items.filter((i) => ok.has(i.row));
	if (go.length)
		await sheetsApi().values.batchUpdate({
			spreadsheetId: RETURN_ORDERS_ID!,
			requestBody: { valueInputOption: 'RAW', data: go.map((i) => ({ range: `${R}!${colLetter(i.col)}${i.row}`, values: [[i.value]] })) }
		});
	return { written: go, moved: items.filter((i) => !ok.has(i.row)) };
}

async function lock(): Promise<boolean> {
	const { data } = await db().from('settings').select('value').eq('key', 'sheet_sync_lock').maybeSingle();
	const at = Date.parse((data?.value as { at?: string } | null)?.at ?? '');
	if (Number.isFinite(at) && Date.now() - at < 120_000) return false;
	await db().from('settings').upsert({ key: 'sheet_sync_lock', value: { at: new Date().toISOString() }, note: 'Sheet ↔ DRC run in progress' });
	return true;
}
const unlock = () => db().from('settings').upsert({ key: 'sheet_sync_lock', value: { at: null }, note: 'Sheet ↔ DRC run in progress' });

export interface RunResult {
	ok: boolean;
	at: string;
	applied: boolean;
	counts: ReturnType<typeof planCounts>;
	done?: { received: number; appended: number; written: number };
	errors: string[];
	error?: string;
}

async function saveRun(r: RunResult) {
	await db().from('settings').upsert({ key: 'sheet_sync_last', value: r, note: 'Written by Sheet ↔ DRC' });
}

/** Check (apply = false) or check and apply. The cron applies only when Auto sync is on. */
export async function runSheetSync(apply: boolean): Promise<RunResult> {
	const at = new Date().toISOString();
	if (apply && !(await lock())) return { ok: false, at, applied: false, counts: planCounts(emptyPlan()), errors: [], error: 'Another sync is running. Try again in a minute.' };
	try {
		const { sheet, plan } = await sheetPlan();
		const counts = planCounts(plan);
		if (!apply) {
			const r: RunResult = { ok: true, at, applied: false, counts, errors: [] };
			await saveRun(r);
			return r;
		}
		const errors: string[] = [];
		const base: Baseline[] = [...plan.baseline];
		const today = istDate(Date.now());

		// 1. sheet → DRC: rows for parcels DRC still shows as not received
		let received = 0;
		for (const x of plan.receive) {
			const { data, error } = await db().rpc('rto_action', { p_rto: x.rtoId, p_action: x.act.action, p_args: { ...x.act.args, scanned: true } });
			if (error) {
				errors.push(`#${x.order}: ${error.message}`);
				continue;
			}
			received++;
			if (x.date && x.date < today && x.date >= shiftDay(today, -30)) await db().rpc('set_received_on', { p_rto: x.rtoId, p_day: x.date, p_today_scan_only: false });
			const s = sheet.rows.find((r) => r.row === x.row)!;
			base.push({ order_no: x.order, sheet_text: sheetText(s), drc_stage: (data as { to: string }).to, state: 'ok' });
		}

		// 2. DRC → sheet: status changed in DRC only
		const w = await writeCells(sheet.cols, plan.write.map((x) => ({ row: x.row, order: x.order, col: x.col, value: x.to })));
		for (const x of w.written) {
			const p = plan.write.find((y) => y.row === x.row)!;
			const s = sheet.rows.find((r) => r.row === x.row)!;
			base.push({ order_no: p.order, sheet_text: sheetText({ rtoStatus: p.to, status: s.status }), drc_stage: p.stage, state: 'ok' });
		}
		for (const x of w.moved) errors.push(`#${x.order}: the row moved while syncing; it will be done next time`);

		// 3. DRC → sheet: new rows
		if (plan.append.length) {
			await sheetsApi().values.append({
				spreadsheetId: RETURN_ORDERS_ID!,
				range: `${R}!A1`,
				valueInputOption: 'RAW',
				insertDataOption: 'INSERT_ROWS',
				requestBody: { values: plan.append.map((a) => a.values) }
			});
			for (const a of plan.append)
				base.push({ order_no: a.order, sheet_text: sheetText({ rtoStatus: a.values[sheet.cols.rtoStatus] ?? '', status: a.values[sheet.cols.status] ?? '' }), drc_stage: a.stage, state: 'ok' });
		}

		await saveBaselines(base);
		const r: RunResult = { ok: true, at, applied: true, counts, done: { received, appended: plan.append.length, written: w.written.length }, errors };
		await saveRun(r);
		return r;
	} catch (e) {
		const r: RunResult = { ok: false, at, applied: apply, counts: planCounts(emptyPlan()), errors: [], error: e instanceof Error ? e.message : String(e) };
		await saveRun(r).catch(() => {});
		return r;
	} finally {
		if (apply) await unlock();
	}
}

function emptyPlan(): Plan {
	return { same: [], receive: [], append: [], write: [], decide: [], onlySheet: [], unreadable: [], baseline: [] };
}

/** One decision from the Sheet check page. */
export async function decide(op: 'use_drc' | 'ignore' | 'add', order: string): Promise<string> {
	const { sheet, plan, rtos } = await sheetPlan();
	if (op === 'add') {
		const x = plan.onlySheet.find((o) => o.order === order);
		if (!x) return 'Already done. Refresh the page.';
		const s = sheet.rows.find((r) => r.row === x.row)!;
		const stage = x.stage === 'skip' ? 'hold' : x.stage;
		const { error } = await db().rpc('add_sheet_only_rto', {
			p_order: order,
			p_stage: stage,
			p_note: `items=${s.items}; rto=${s.rtoStatus}${s.status ? `; status=${s.status}` : ''}`,
			p_received_on: x.date
		});
		if (error) throw new Error(error.message.includes('DRC_SHEET_ORDER_EXISTS') ? 'DRC already has this order. Refresh the page.' : error.message);
		await saveBaselines([{ order_no: order, sheet_text: sheetText(s), drc_stage: stage, state: 'ok' }]);
		return `#${order} added to DRC`;
	}
	const x = plan.decide.find((d) => d.order === order);
	if (!x) return 'Already done. Refresh the page.';
	const s = sheet.rows.find((r) => r.row === x.row)!;
	if (op === 'ignore') {
		await saveBaselines([{ order_no: order, sheet_text: sheetText(s), drc_stage: x.drcStage, state: 'ignored' }]);
		return `#${order}: kept both as they are`;
	}
	if (COURIER_STAGES.has(x.drcStage)) throw new Error('DRC says this parcel was not received, so there is no DRC status to write. Use Keep both, or open the parcel.');
	const r = rtos.find((y) => y.id === x.rtoId);
	const label = drcCell(x.drcStage, r?.reship_date, s.rtoStatus);
	const w = await writeCells(sheet.cols, [{ row: x.row, order, col: sheet.cols.rtoStatus, value: label }]);
	if (!w.written.length) throw new Error('The row moved in the sheet. Refresh the page and try again.');
	await saveBaselines([{ order_no: order, sheet_text: sheetText({ rtoStatus: label, status: s.status }), drc_stage: x.drcStage, state: 'ok' }]);
	return `#${order}: sheet now says "${label}"`;
}
