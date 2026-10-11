// "Arrived on" (pure, tested): parcels scanned the day after they reached the warehouse. The Scan screen keeps the
// chosen day in a cookie for the rest of that IST day only, so tomorrow it is back to "Today" by itself.
import { istDate, shiftDay } from './scanlog.ts';

export const ARRIVED_COOKIE = 'drc_arrived';
export const MAX_BACK_DAYS = 30;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const valid = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** Cookie value: '<day it was set>|<arrived day>'. */
export function arrivedCookie(day: string, now: number): string {
	return `${istDate(now)}|${day}`;
}

/** The arrived day to use for scans now, or null = today. Ignores a cookie from an earlier day or a bad value. */
export function parseArrived(v: string | null | undefined, now: number): string | null {
	if (!v) return null;
	const [setOn, day] = v.split('|');
	const today = istDate(now);
	if (setOn !== today || !day || !valid(day)) return null;
	if (day >= today || day < shiftDay(today, -MAX_BACK_DAYS)) return null;
	return day;
}

/** A 'YYYY-MM-DD' typed by staff for a scanned parcel: allowed up to 30 days before the scan day, not after it. */
export function validArrived(day: unknown, scanDay: string): string | null {
	if (typeof day !== 'string' || !valid(day)) return null;
	if (day > scanDay || day < shiftDay(scanDay, -MAX_BACK_DAYS)) return null;
	return day;
}

/** The day a parcel arrived: received_on when set, else the scan day (IST). */
export function arrivedDay(r: { received_on?: string | null; scanned_at?: string | null }): string | null {
	if (r.received_on) return r.received_on;
	return r.scanned_at ? istDate(Date.parse(r.scanned_at)) : null;
}

/** 'Sat 10 Oct' */
export function shortDay(day: string): string {
	const d = new Date(`${day}T00:00:00Z`);
	const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
	const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
	return `${wd} ${d.getUTCDate()} ${mo}`;
}
