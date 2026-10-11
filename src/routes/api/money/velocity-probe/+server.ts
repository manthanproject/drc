import { json } from '@sveltejs/kit';
import { requireUser, SESSION_COOKIE } from '#lib/server/session.ts';
import { velocityPost, VelocityKeyError } from '#lib/server/velocity-api.ts';
import { db } from '#lib/server/supabase.ts';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 30 };

/**
 * TEMPORARY probe: does Velocity's Finance API (POST /shipping-charges, read-only, 5 calls/min) show claim money
 * (lost / MDND credits) per AWB? If yes, DRC can match credit notes without passbook / credit-note uploads.
 * ONE Velocity call: the AWBs of RTOs that have a claim or a set-aside credit (max 100). No customer details returned.
 */
const n = (v: unknown) => {
	const x = Number(v);
	return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
};

export const GET: RequestHandler = async ({ request, cookies }) => {
	await requireUser(request, cookies.get(SESSION_COOKIE));
	const [claims, aside] = await Promise.all([
		db().from('claims').select('rto_id, status, reason, claimed_amount').limit(500),
		db().from('events').select('rto_id, payload').eq('kind', 'stage_change').eq('payload->>action', 'cn_set_aside').limit(200)
	]);
	if (claims.error || aside.error) return json({ ok: false, step: 'drc', message: (claims.error ?? aside.error)!.message }, { status: 500 });

	const drc = new Map<string, { claim?: string; aside?: number }>();
	for (const c of claims.data ?? []) drc.set(c.rto_id as string, { ...drc.get(c.rto_id as string), claim: `${c.reason} · ${c.status}` });
	for (const e of aside.data ?? []) {
		const p = e.payload as { args?: { amount?: number } } | null;
		drc.set(e.rto_id as string, { ...drc.get(e.rto_id as string), aside: n(p?.args?.amount) });
	}
	const ids = [...drc.keys()];
	if (!ids.length) return json({ ok: false, step: 'drc', message: 'No claims in DRC to check' });
	const rtos = await db().from('rtos').select('id, order_no, forward_awb, courier').in('id', ids.slice(0, 300));
	if (rtos.error) return json({ ok: false, step: 'drc', message: rtos.error.message }, { status: 500 });
	const list = (rtos.data ?? []).filter((r) => r.courier === 'velocity' && r.forward_awb).slice(0, 100);
	const byAwb = new Map(list.map((r) => [String(r.forward_awb), r]));

	let res: { status: number; body: any };
	try {
		res = await velocityPost('/shipping-charges', { awbs: [...byAwb.keys()] }, { timeoutMs: 20_000 });
	} catch (e) {
		const key = e instanceof VelocityKeyError;
		return json({ ok: false, step: 'velocity', keyRejected: key, message: e instanceof Error ? e.message : String(e) });
	}
	if (res.status === 429) return json({ ok: false, step: 'velocity', http: 429, message: 'Velocity allows 5 calls a minute: wait 1 minute and reload' });
	if (res.status !== 200) return json({ ok: false, step: 'velocity', http: res.status, body: typeof res.body === 'string' ? res.body.slice(0, 300) : res.body?.message ?? null });

	const types: Record<string, { debit: number; credit: number; credit_total: number }> = {};
	const orders: unknown[] = [];
	let notFound = 0;
	for (const row of Array.isArray(res.body?.data) ? res.body.data : []) {
		const r = byAwb.get(String(row?.tracking_number ?? ''));
		if (row?.error) {
			notFound++;
			continue;
		}
		const charges: any[] = Array.isArray(row?.charges) ? row.charges : [];
		for (const c of charges) {
			const t = String(c?.event_type ?? '?');
			const k = (types[t] ??= { debit: 0, credit: 0, credit_total: 0 });
			if (String(c?.transaction_type) === 'credit') {
				k.credit++;
				k.credit_total = n(k.credit_total + n(c?.amount_with_gst));
			} else k.debit++;
		}
		const credits = charges.filter((c) => String(c?.transaction_type) === 'credit');
		const d = r ? drc.get(r.id as string) : undefined;
		orders.push({
			order: r?.order_no ?? null,
			awb: row?.tracking_number ?? null,
			drc: d ?? null,
			credits: credits.map((c) => ({ type: c?.event_type ?? null, with_gst: n(c?.amount_with_gst), without_gst: n(c?.amount_without_gst), keys: Object.keys(c ?? {}) })),
			debits: charges.length - credits.length,
			debit_total: n(charges.filter((c) => String(c?.transaction_type) !== 'credit').reduce((t, c) => t + n(c?.amount_with_gst), 0))
		});
	}
	// orders with a credit first: those answer the question
	orders.sort((a: any, b: any) => b.credits.length - a.credits.length);
	return json({ ok: true, awbs_sent: byAwb.size, not_found: notFound, event_types: types, orders });
};
