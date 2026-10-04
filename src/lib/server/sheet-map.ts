/** Maps rows of the old "Dropy Return Orders → Return Orders" tab to backfill entries. Pure, no I/O. */

export type BackfillEntry = { order_no: string; stage: string; note: string; received_on: string | null };

/**
 * Approved 4 Oct 2026, refined after the dry run of the real sheet.
 * 'skip' = sheet says the RTO was still in transit, so it is NOT marked received (Velocity sync keeps tracking it).
 * Anything unmatched → closed (received, nothing pending).
 */
export function stageFor(rtoStatus: string, items: string, claimStatus: string): string {
	const t = rtoStatus.toLowerCase();
	if (/dispute|claim/.test(t) || /claim/.test(claimStatus.toLowerCase()) || /rto\s*claim/.test(items.toLowerCase())) return 'claim';
	if (/rto\s*in\s*transit/.test(t)) return 'skip';
	if (/star|ready\s*stock|doesn'?t\s*want|don'?t\s*want|didn'?t\s*want|not\s*want|no\s*need|cancel|by\s*mistake|again\s*placed/.test(t)) return 'ready_stock';
	if (/\bpick\s*up\b/.test(t)) return 'reship';
	if (/call|pick|busy|voice|talk\s*to|back\s*later|not\s*reachable|switch(ed)?\s*off/.test(t)) return 'to_call';
	if (/store\s*credit/.test(t)) return 'store_credit';
	if (/hold|admin\s*pending|expir/.test(t)) return 'hold';
	if (/deliver|dispatch|re-?ship|\bwants?\b|resend|address\s*update/.test(t)) return 'reship';
	return 'closed';
}

/** 'Dropy-1093, 1094' → ['1093','1094'];  'Dropy-1381-1' → ['1381-1']. */
export function orderNos(cell: string): string[] {
	const out: string[] = [];
	for (const m of cell.matchAll(/(?:dropy-?)?(\d{2,6}(?:-\d{1,2})?)/gi)) out.push(m[1]);
	return [...new Set(out)];
}

/** Sheets serial date (days since 1899-12-30) or dd/mm/yyyy text → ISO date, else null. */
export function sheetDate(v: unknown): string | null {
	if (typeof v === 'number' && v > 30000 && v < 80000) {
		return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
	}
	const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
	if (!m) return null;
	const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
	const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
	return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function mapSheet(values: unknown[][]) {
	const [header = [], ...rows] = values;
	const h = header.map((x) => String(x ?? '').trim().toLowerCase());
	const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
	const c = {
		date: col('date'),
		order: col('order id'),
		items: col('iteams', 'items'),
		rto: col('rto - status', 'rto status'),
		status: col('status'),
		redelivery: col('re delivery initiated', 're-delivery initiated')
	};
	if (c.order < 0 || c.rto < 0) throw new Error(`Sheet headers not recognised: ${header.join(' | ')}`);

	const cell = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
	const entries: BackfillEntry[] = [];
	const report = { rows: rows.length, blankOrder: 0, skippedInTransit: [] as string[], multiOrderCells: [] as string[], stages: {} as Record<string, number>, defaultedToClosed: {} as Record<string, number> };

	for (const row of rows) {
		const nos = orderNos(cell(row, c.order));
		if (!nos.length) {
			report.blankOrder++;
			continue;
		}
		if (nos.length > 1) report.multiOrderCells.push(cell(row, c.order));
		const rto = cell(row, c.rto), items = cell(row, c.items), claim = cell(row, c.status);
		const stage = stageFor(rto, items, claim);
		if (stage === 'skip') {
			report.skippedInTransit.push(`${nos.join('+')}: ${rto}`);
			continue;
		}
		if (stage === 'closed') report.defaultedToClosed[rto || '(blank)'] = (report.defaultedToClosed[rto || '(blank)'] ?? 0) + 1;
		const note = [`items=${items}`, `rto=${rto}`, claim && `claim=${claim}`, cell(row, c.redelivery) && `redelivery=${cell(row, c.redelivery)}`]
			.filter(Boolean)
			.join('; ');
		const received_on = sheetDate(c.date >= 0 ? row[c.date] : null);
		for (const order_no of nos) {
			entries.push({ order_no, stage, note, received_on });
			report.stages[stage] = (report.stages[stage] ?? 0) + 1;
		}
	}
	return { entries, report };
}
