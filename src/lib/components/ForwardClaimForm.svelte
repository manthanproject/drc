<script lang="ts">
	// Delivery claim (migration 0026): log a claim already raised with the courier on a parcel that went OUT to the
	// customer and never came back (delivered damaged / wrong / short, or marked delivered but not received).
	import { FWD_REASONS, FWD_CHANNELS, cleanForwardClaim } from '#lib/forward-claims.ts';

	let { onsaved, oncancel }: { onsaved: (r: { rto_id: string; claim_id: string; order: string }) => void; oncancel: () => void } = $props();

	const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

	let courier = $state<'velocity' | 'shiprocket'>('velocity');
	let orderNo = $state('');
	let awb = $state('');
	let carrier = $state('');
	let reason = $state<string>('damaged');
	let channel = $state<string>('panel_dispute');
	let escalated = $state(false);
	let ticketRef = $state('');
	let raisedOn = $state(todayIst());
	let amount = $state('');
	let description = $state('');
	let note = $state('');
	let busy = $state(false);
	let err = $state('');

	const body = $derived({
		courier, order_no: orderNo, awb, carrier_name: carrier, reason, channel,
		status: escalated ? 'escalated' : 'raised', ticket_ref: ticketRef, raised_on: raisedOn,
		claimed_amount: amount, order_value: amount, description, note
	});
	const check = $derived(cleanForwardClaim(body, todayIst()));

	async function save() {
		if (busy) return;
		if (!check.ok) {
			err = check.error;
			return;
		}
		busy = true;
		err = '';
		try {
			const r = await fetch('/api/forward-claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			const b = await r.json().catch(() => ({}));
			if (!r.ok) {
				err = b?.message ?? `Could not save (${r.status})`;
				return;
			}
			onsaved({ rto_id: b.rto_id, claim_id: b.claim_id, order: check.args.order_name });
		} catch {
			err = 'No connection. Nothing was saved, try again.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="card fc">
	<div class="mh">
		<b>New delivery claim</b>
		<button class="x" onclick={oncancel} aria-label="Close">✕</button>
	</div>
	<p class="small muted lead">For a parcel delivered to the customer that came with a problem, or was marked delivered but never reached them. Raise it with the courier first, then log it here so DRC chases it.</p>

	<div class="grid">
		<label>Courier account
			<select bind:value={courier}><option value="velocity">Velocity</option><option value="shiprocket">Shiprocket</option></select>
		</label>
		<label>Order no.
			<input bind:value={orderNo} placeholder="e.g. 6770" inputmode="text" maxlength="20" />
		</label>
		<label>AWB of the delivered parcel
			<input bind:value={awb} placeholder="e.g. 7D144182713" maxlength="40" class="mono" />
		</label>
		<label>Courier (optional)
			<input bind:value={carrier} placeholder="e.g. DTDC" maxlength="60" />
		</label>
		<label>What went wrong
			<select bind:value={reason}>{#each FWD_REASONS as r (r.key)}<option value={r.key}>{r.label}</option>{/each}</select>
		</label>
		<label>Claim amount (₹)
			<input bind:value={amount} placeholder="Order value" inputmode="decimal" maxlength="12" />
		</label>
		<label>Raised as
			<select bind:value={channel}>{#each FWD_CHANNELS as c (c.key)}<option value={c.key}>{c.label}</option>{/each}</select>
		</label>
		<label>Ticket / dispute no.{channel === 'support_ticket' ? '' : ' (optional)'}
			<input bind:value={ticketRef} placeholder="e.g. 124093" maxlength="40" />
		</label>
		<label>Raised on
			<input type="date" bind:value={raisedOn} max={todayIst()} />
		</label>
		<label class="chk"><input type="checkbox" bind:checked={escalated} /> Already rejected once, this is a second review</label>
	</div>

	<label class="full">What was sent to the courier (optional)
		<textarea rows="3" bind:value={description} maxlength="4000" placeholder="Paste the dispute / ticket text, with the packing and unboxing video links"></textarea>
	</label>
	<label class="full">Note for the team (optional)
		<input bind:value={note} maxlength="300" placeholder="e.g. first dispute rejected 17 Nov: packing video missing" />
	</label>

	{#if err}<p class="err" role="alert">{err}</p>{/if}
	<div class="row">
		<button class="go" onclick={oncancel} disabled={busy}>Cancel</button>
		<button class="go accb" onclick={save} disabled={busy}>{busy ? 'Saving…' : 'Save claim'}</button>
	</div>
</div>

<style>
	.fc { border-color: var(--acc); margin-bottom: 14px; }
	.fc :global(*) { box-sizing: border-box; }
	.mh { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 16px; }
	.x { border: 0; background: none; font-size: 16px; cursor: pointer; color: var(--muted); padding: 4px 8px; }
	.lead { margin: 4px 0 12px; line-height: 1.45; }
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px 12px; }
	label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; font-weight: 700; color: var(--muted); min-width: 0; }
	label.full { margin-top: 10px; }
	label.chk { flex-direction: row; align-items: center; gap: 8px; font-weight: 600; color: var(--ink); align-self: end; min-height: 42px; }
	label.chk input { width: 18px; height: 18px; accent-color: var(--acc); }
	input:not([type='checkbox']), select { height: 42px; width: 100%; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 0 12px; font-size: 14px; color: var(--ink); font-weight: 500; }
	textarea { width: 100%; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 10px 12px; font-size: 13px; line-height: 1.5; resize: vertical; color: var(--ink); font-weight: 500; }
	.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	.row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
	.go { min-height: 42px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 13.5px; cursor: pointer; }
	.go:disabled { opacity: 0.55; cursor: default; }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.err { color: var(--bad); font-weight: 600; font-size: 13px; margin: 10px 0 0; }
</style>
