// Scan log (pure, tested): which parcels were scanned on a given IST day, from the permanent events history.
import { BUCKETS, bucketOfStage, inr, num, orderLabel, type Rto } from './dashboard.ts';

const IST = 5.5 * 3_600_000;

/** 'YYYY-MM-DD' for the IST calendar day of `now`. */
export function istDate(now: number): string {
	return new Date(now + IST).toISOString().slice(0, 10);
}

/** A valid 'YYYY-MM-DD' (not in the future), else today in IST. */
export function parseDay(v: string | null, now: number): string {
	const today = istDate(now);
	if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return today;
	return v > today ? today : v;
}

/** UTC instants for the start of that IST day and the next one. */
export function dayRange(day: string): { from: string; to: string } {
	const start = Date.parse(`${day}T00:00:00+05:30`);
	return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000).toISOString() };
}

export function shiftDay(day: string, by: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
}

/** 'Tue 6 Oct 2026' */
export function dayLabel(day: string): string {
	const d = new Date(`${day}T00:00:00Z`);
	const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
	const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
	return `${wd} ${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}`;
}

/** '10:05' in IST */
export function istTime(iso: string): string {
	const d = new Date(Date.parse(iso) + IST);
	return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export interface LogEvent {
	id: number;
	rto_id: string | null;
	kind: string | null;
	payload: any;
	received_at: string;
}

export interface LogRow {
	eventId: number;
	rtoId: string | null;
	time: string;
	at: string;
	order: string;
	courier: string;
	awb: string;
	scannedAs: string;
	scannedTone: string;
	now: string;
	nowTone: string;
	changed: boolean;
	value: number;
	undone: boolean;
}

const label = (stage: string | null | undefined) => (stage ? BUCKETS[bucketOfStage(stage)]?.label ?? stage : '—');
const tone = (stage: string | null | undefined) => (stage ? BUCKETS[bucketOfStage(stage)]?.tone ?? 'mute' : 'mute');

/** One row per scan (a staff change made from the Scan screen) or unknown-parcel save, oldest first. */
export function buildScanLog(events: LogEvent[], rtos: Map<string, Rto>): LogRow[] {
	const rows: LogRow[] = [];
	for (const e of events) {
		const p = e.payload ?? {};
		const isScan = e.kind === 'stage_change' && p.args?.scanned === true;
		const isUnknown = e.kind === 'unknown_parcel';
		if (!isScan && !isUnknown) continue;
		const r = e.rto_id ? rtos.get(e.rto_id) : undefined;
		const scannedStage = isUnknown ? 'unknown_parcel' : p.to;
		rows.push({
			eventId: e.id,
			rtoId: e.rto_id,
			time: istTime(e.received_at),
			at: e.received_at,
			order: isUnknown ? `Unknown ${p.code ?? ''}`.trim() : r ? orderLabel(r) : '—',
			courier: r?.carrier_name ?? '',
			awb: r?.forward_awb ?? (isUnknown ? String(p.code ?? '') : ''),
			scannedAs: label(scannedStage),
			scannedTone: tone(scannedStage),
			now: label(r?.stage),
			nowTone: tone(r?.stage),
			changed: !!r && r.stage !== scannedStage,
			value: r ? num(r.order_value) : 0,
			undone: !!p.undone
		});
	}
	return rows.sort((a, b) => a.at.localeCompare(b.at) || a.eventId - b.eventId);
}

/** "To call 4 · Hold 4 · …" counts of what parcels were scanned as (undone scans left out). */
export function summarise(rows: LogRow[]): { total: number; parts: { label: string; n: number }[]; value: number } {
	const live = rows.filter((r) => !r.undone);
	const m = new Map<string, number>();
	for (const r of live) m.set(r.scannedAs, (m.get(r.scannedAs) ?? 0) + 1);
	return {
		total: live.length,
		parts: [...m].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
		value: live.reduce((s, r) => s + r.value, 0)
	};
}

const csvCell = (v: unknown) => {
	const s = String(v ?? '');
	// leading = + - @ would be run as a formula by Excel / Sheets
	const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
	return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function scanLogCsv(day: string, rows: LogRow[]): string {
	const head = ['Date', 'Time (IST)', 'Order', 'Courier', 'AWB', 'Scanned as', 'Status now', 'Value (INR)', 'Undone'];
	const lines = rows.map((r) => [day, r.time, r.order, r.courier, r.awb, r.scannedAs, r.now, Math.round(r.value), r.undone ? 'yes' : ''].map(csvCell).join(','));
	return '﻿' + [head.join(','), ...lines].join('\r\n') + '\r\n'; // BOM so Excel reads ₹/UTF-8 correctly
}

export const fmtValue = (n: number) => inr(n);
