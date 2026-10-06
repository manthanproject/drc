import { db } from './supabase.ts';
import { DEFAULT_RULES, num, type Claim, type Rto, type Rules } from '#lib/dashboard.ts';

const RTO_COLS =
	'id, courier, carrier_name, order_no, order_name, forward_awb, rto_awb, scanned_code, payment_mode, order_value, amount_collected, ' +
	'customer_name, customer_phone10, stage, courier_status, rto_delivered_at, last_movement_at, last_event_at, legacy_source, ' +
	'reship_order_no, reship_awb, reship_created_at, reship_courier_status, reship_state, ' +
	'disputes:courier_raw->shipment_disputes';

const PAGE = 1000; // PostgREST max rows per request

export async function allRtos(): Promise<Rto[]> {
	const out: Rto[] = [];
	for (let from = 0; ; from += PAGE) {
		const { data, error } = await db().from('rtos').select(RTO_COLS).order('id').range(from, from + PAGE - 1);
		if (error) throw new Error(`rtos: ${error.message}`);
		out.push(...((data ?? []) as unknown as Rto[]));
		if (!data || data.length < PAGE) return out;
	}
}

async function allClaims(): Promise<Claim[]> {
	const [c, m] = await Promise.all([
		db().from('claims').select('id, rto_id, reason, status, deadline_at, approved_at, raised_at'),
		db().from('claim_money').select('claim_id, outstanding')
	]);
	if (c.error) throw new Error(`claims: ${c.error.message}`);
	if (m.error) throw new Error(`claim_money: ${m.error.message}`);
	const owed = new Map((m.data ?? []).map((x) => [x.claim_id as string, x.outstanding]));
	return (c.data ?? []).map((x) => ({ ...(x as Omit<Claim, 'outstanding'>), outstanding: owed.get(x.id as string) ?? 0 }));
}

export type LastSync = { ok?: boolean; at?: string; error?: string } | null;

async function settings(): Promise<{ rules: Rules; lastSync: LastSync }> {
	const { data, error } = await db()
		.from('settings')
		.select('key, value')
		.in('key', ['mdnd_hours', 'delayed_days', 'dispute_window_days', 'velocity_last_sync']);
	if (error) throw new Error(`settings: ${error.message}`);
	const get = (k: string) => data?.find((s) => s.key === k)?.value;
	const pos = (v: unknown, d: number) => (num(v) > 0 ? num(v) : d);
	return {
		rules: {
			mdndHours: pos(get('mdnd_hours'), DEFAULT_RULES.mdndHours),
			delayedDays: pos(get('delayed_days'), DEFAULT_RULES.delayedDays),
			windowDays: pos(get('dispute_window_days'), DEFAULT_RULES.windowDays)
		},
		lastSync: (get('velocity_last_sync') as LastSync) ?? null
	};
}

/** Read-only snapshot for Dashboard and All RTOs. No writes anywhere. */
export async function loadSnapshot() {
	const [rtos, claims, s] = await Promise.all([allRtos(), allClaims(), settings()]);
	return { rtos, claims, rules: s.rules, lastSync: s.lastSync, now: Date.now() };
}
