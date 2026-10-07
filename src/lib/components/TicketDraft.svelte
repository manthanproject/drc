<script lang="ts">
	import { inr } from '#lib/dashboard.ts';
	import { ticketText, cleanTicketRef, COURIER_NAME, FRESHDESK_NEW, type TicketRow } from '#lib/tickets.ts';

	let {
		rows,
		stuckDays,
		onraised
	}: { rows: TicketRow[]; stuckDays: number; onraised: (eventId: number, n: number, ref: string) => void } = $props();

	const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

	let subject = $state('');
	let body = $state('');
	let ref = $state('');
	let raisedOn = $state(todayIst());
	let busy = $state(false);
	let err = $state('');
	let copied = $state<'' | 'subject' | 'body'>('');

	// a new tick list rewrites the text (edits are for the final paste)
	const key = $derived(rows.map((r) => r.rtoId).join(','));
	$effect.pre(() => {
		void key;
		const t = ticketText(rows, stuckDays);
		subject = t.subject;
		body = t.body;
		err = '';
	});

	const courier = $derived(rows[0]?.courier ?? 'velocity');
	const total = $derived(rows.reduce((s, r) => s + r.amount, 0));
	const cleanRef = $derived(cleanTicketRef(ref));

	async function copy(value: string, what: 'subject' | 'body') {
		try {
			await navigator.clipboard.writeText(value);
			copied = what;
			setTimeout(() => copied === what && (copied = ''), 2500);
		} catch {
			err = 'Copy blocked by the browser: select the text and copy it by hand.';
		}
	}

	async function markRaised() {
		if (busy || !cleanRef || !rows.length) return;
		busy = true;
		err = '';
		try {
			const r = await fetch('/api/ticket', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rto_ids: rows.map((x) => x.rtoId), ticket_ref: cleanRef, raised_on: raisedOn, description: `${subject}\n\n${body}` })
			});
			const b = await r.json().catch(() => ({}));
			if (!r.ok) {
				err = b?.message ?? `Could not save (${r.status})`;
				return;
			}
			ref = '';
			onraised(b.event_id, b.n, b.ticket_ref);
		} catch {
			err = 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="card tk">
	<div class="mh">
		<b>{COURIER_NAME[courier] ?? courier} ticket · {rows.length} parcel{rows.length > 1 ? 's' : ''}</b>
		<b class="money">{inr(total)}</b>
	</div>
	<ol class="steps">
		<li>
			<span class="n">1</span>
			<div class="sb">
				<b>Open a new support ticket</b>
				{#if courier === 'velocity'}
					<div class="row"><a class="go dark" href={FRESHDESK_NEW} target="_blank" rel="noopener noreferrer">Open Velocity support ↗</a><span class="small muted">or Help in the Velocity panel</span></div>
				{:else}
					<span class="small muted">Shiprocket → Help &amp; Support → new ticket</span>
				{/if}
			</div>
		</li>
		<li>
			<span class="n">2</span>
			<div class="sb">
				<label for="tk-sub"><b>Subject</b></label>
				<input id="tk-sub" bind:value={subject} maxlength="250" />
				<div class="row"><button class="go" onclick={() => copy(subject, 'subject')}>{copied === 'subject' ? 'Copied ✓' : 'Copy subject'}</button></div>
			</div>
		</li>
		<li>
			<span class="n">3</span>
			<div class="sb">
				<label for="tk-body"><b>Description</b></label>
				<textarea id="tk-body" rows="14" bind:value={body}></textarea>
				<div class="row">
					<button class="go accb" disabled={!body.trim()} onclick={() => copy(body, 'body')}>{copied === 'body' ? 'Copied ✓' : 'Copy description'}</button>
					<span class="small muted">Editable before copying</span>
				</div>
			</div>
		</li>
		<li>
			<span class="n">4</span>
			<div class="sb">
				<b>Mark raised</b>
				<div class="row">
					<label class="sr" for="tk-ref">Ticket number</label>
					<input id="tk-ref" bind:value={ref} maxlength="40" inputmode="text" placeholder="Ticket no., e.g. 106373" />
					<label class="sr" for="tk-on">Raised on</label>
					<input id="tk-on" class="date" type="date" bind:value={raisedOn} max={todayIst()} />
				</div>
				<button class="go accb wide" disabled={busy || !cleanRef} onclick={markRaised}>
					{busy ? 'Saving…' : `✓ Mark raised on ${rows.length} parcel${rows.length > 1 ? 's' : ''}`}
				</button>
				<span class="small muted">Raised before DRC (like #106373)? Tick those parcels, type that ticket no. and the day it was raised.</span>
			</div>
		</li>
	</ol>
	{#if err}<p class="err" role="alert">{err}</p>{/if}
</div>

<style>
	.tk { border-color: var(--acc); }
	.tk :global(*) { box-sizing: border-box; }
	.mh { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
	.steps { list-style: none; margin: 6px 0 0; padding: 0; }
	.steps li { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
	.n { width: 26px; height: 26px; flex: none; border-radius: 50%; background: var(--ink); color: var(--bg); display: grid; place-items: center; font-size: 12.5px; font-weight: 700; }
	.sb { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
	.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.go { min-height: 42px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 13.5px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
	.go:disabled { opacity: 0.55; cursor: default; }
	.dark { background: var(--ink); border-color: var(--ink); color: var(--bg); }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.wide { width: 100%; min-height: 48px; font-size: 15px; }
	textarea { width: 100%; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 10px 12px; font-size: 13px; line-height: 1.5; resize: vertical; }
	input { height: 42px; width: 100%; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 0 12px; font-size: 14px; }
	.row input { flex: 1; min-width: 150px; width: auto; }
	.row input.date { flex: 0 0 auto; min-width: 0; width: 160px; }
	.sr { position: absolute; left: -9999px; }
	.err { color: var(--bad); font-weight: 600; font-size: 13px; margin: 6px 0 0; }
</style>
