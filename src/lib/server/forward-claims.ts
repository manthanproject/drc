import { error } from '@sveltejs/kit';
import { db } from './supabase.ts';
import { fail } from './actions.ts';
import { cleanForwardClaim } from '#lib/forward-claims.ts';
import { istDate } from '#lib/scanlog.ts';

/** Log a delivery claim (parcel delivered damaged / wrong / short, or forward MDND) already raised with the courier. */
export async function createForwardClaim(raw: unknown) {
	const c = cleanForwardClaim(raw, istDate(Date.now()));
	if (!c.ok) error(400, c.error);
	const { data, error: e } = await db().rpc('create_forward_claim', { p_args: c.args });
	if (e) fail(e.message);
	return data as { rto_id: string; claim_id: string; event_id: number };
}
