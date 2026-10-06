<script lang="ts">
	import { inr, num, BUCKETS, bucketOfStage } from '#lib/dashboard.ts';
	import { istTomorrow } from '#lib/scan.ts';

	interface PickerRto {
		id: string;
		payment_mode: 'cod' | 'prepaid' | 'partial' | null;
		order_value: number | string | null;
		amount_collected?: number | string | null;
	}
	type Saved = { event_id: number; to: string; label: string };
	let {
		rto,
		scanned = false,
		title = 'What happened to this parcel?',
		claimHref,
		onsaved
	}: { rto: PickerRto; scanned?: boolean; title?: string; claimHref?: string | null; onsaved: (r: Saved) => void } = $props();

	let open = $state<null | 'received' | 'ready_stock' | 'reship' | 'hold'>(null);
	let reshipDate = $state(istTomorrow(Date.now()));
	let note = $state('');
	let busy = $state(false);
	let err = $state('');
	let claimInfo = $state(false);

	const paidUpfront = $derived(rto.payment_mode === 'partial' ? num(rto.amount_collected) : num(rto.order_value));
	const needsMoney = $derived(rto.payment_mode === 'prepaid' || rto.payment_mode === 'partial');

	function toggle(p: typeof open) {
		err = '';
		claimInfo = false;
		open = open === p ? null : p;
	}

	async function save(action: string, args: Record<string, unknown> = {}) {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const r = await fetch(`/api/rto/${rto.id}/action`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action, scanned, ...args })
			});
			const body = await r.json().catch(() => ({}));
			if (!r.ok) {
				err = body?.message ?? `Could not save (${r.status})`;
				return;
			}
			open = null;
			note = '';
			onsaved({ event_id: body.event_id, to: body.to, label: BUCKETS[bucketOfStage(body.to)]?.label ?? body.to });
		} catch {
			err = 'No connection. Nothing was saved, try again.';
		} finally {
			busy = false;
		}
	}

	function readyStock() {
		if (needsMoney) open = 'ready_stock';
		else save('ready_stock');
	}
</script>

<section class="picker" aria-label={title}>
	<div class="ttl">{title}</div>
	<div class="grid">
		<button class="opt" class:sel={open === 'received'} disabled={busy} onclick={() => toggle('received')}>
			<span class="ic ok">✓</span><span><b>Received OK</b><small>Call or Ready Stock</small></span>
		</button>
		{#if claimHref}
			<a class="opt" href={claimHref} aria-disabled={busy}>
				<span class="ic bad">!</span><span><b>RTO claim</b><small>Reason, items, media</small></span>
			</a>
		{:else}
			<button class="opt" disabled={busy} onclick={() => { open = null; claimInfo = !claimInfo; }}>
				<span class="ic bad">!</span><span><b>RTO claim</b><small>Reason, items, media</small></span>
			</button>
		{/if}
		<button class="opt" class:sel={open === 'ready_stock'} disabled={busy} onclick={() => { claimInfo = false; err = ''; readyStock(); }}>
			<span class="ic acc">▤</span><span><b>Ready Stock</b><small>Customer doesn't want</small></span>
		</button>
		<button class="opt" class:sel={open === 'reship'} disabled={busy} onclick={() => toggle('reship')}>
			<span class="ic ok">⇢</span><span><b>Re-ship</b><small>Customer wants it</small></span>
		</button>
		<button class="opt" class:sel={open === 'hold'} disabled={busy} onclick={() => toggle('hold')}>
			<span class="ic warn">❚❚</span><span><b>Hold</b><small>Decide later</small></span>
		</button>
		<button class="opt" disabled={busy} onclick={() => save('close')}>
			<span class="ic mute">✔</span><span><b>Close</b><small>Nothing left to do</small></span>
		</button>
	</div>

	{#if claimInfo}
		<div class="panel note">This RTO already has an open claim, or has no courier to claim against. See the claim card on the RTO page.</div>
	{/if}

	{#if open === 'received'}
		<div class="panel ok">
			<div class="ptitle">Received OK. What next?</div>
			<div class="two">
				<button class="go okb" disabled={busy} onclick={() => save('received_call')}>Call customer</button>
				<button class="go" disabled={busy} onclick={readyStock}>Straight to Ready Stock</button>
			</div>
		</div>
	{/if}

	{#if open === 'ready_stock'}
		<div class="panel acc">
			<div class="ptitle">{rto.payment_mode === 'partial' ? 'Partly prepaid' : 'Prepaid'}: customer paid {inr(paidUpfront)}. Give back as…</div>
			<div class="two">
				<button class="go accb" disabled={busy} onclick={() => save('ready_stock', { money: 'refund' })}>Refund {inr(paidUpfront)}</button>
				<button class="go" disabled={busy} onclick={() => save('ready_stock', { money: 'credit' })}>Store credit {inr(paidUpfront)}</button>
			</div>
		</div>
	{/if}

	{#if open === 'reship'}
		<div class="panel ok">
			<label class="ptitle" for="rdate-{rto.id}">Re-ship date</label>
			<input id="rdate-{rto.id}" type="date" bind:value={reshipDate} />
			<button class="go okb full" disabled={busy || !reshipDate} onclick={() => save('reship', { reship_date: reshipDate })}>Save re-ship</button>
		</div>
	{/if}

	{#if open === 'hold'}
		<div class="panel warn">
			<label class="ptitle" for="hnote-{rto.id}">Why on hold? (optional)</label>
			<textarea id="hnote-{rto.id}" rows="2" bind:value={note} maxlength="500" placeholder="e.g. customer asked to call Monday"></textarea>
			<button class="go warnb full" disabled={busy} onclick={() => save('hold', note.trim() ? { note: note.trim() } : {})}>Save hold</button>
		</div>
	{/if}

	{#if busy}<div class="small muted">Saving…</div>{/if}
	{#if err}<div class="err" role="alert">{err}</div>{/if}
</section>

<style>
	.picker { display: flex; flex-direction: column; gap: 10px; }
	.ttl { font-size: 14px; font-weight: 700; }
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(136px, 1fr)); gap: 8px; }
	.opt { color: inherit; display: flex; align-items: center; gap: 10px; min-height: 58px; padding: 9px 11px; border-radius: 14px; border: 1px solid var(--line);
		background: var(--surface); text-align: left; cursor: pointer; }
	.opt.sel { border: 2px solid var(--acc); padding: 8px 10px; }
	.opt:disabled { opacity: 0.6; cursor: wait; }
	.opt b { display: block; font-size: 14px; }
	.opt small { display: block; font-size: 12px; color: var(--muted); }
	.ic { width: 34px; height: 34px; flex: none; border-radius: 10px; display: grid; place-items: center; font-weight: 800; font-size: 15px; }
	.ic.ok { background: var(--ok-soft); color: var(--ok); }
	.ic.bad { background: var(--bad-soft); color: var(--bad); }
	.ic.acc { background: var(--acc-soft); color: var(--acc); }
	.ic.warn { background: var(--warn-soft); color: var(--warn); font-size: 11px; }
	.ic.mute { background: var(--sunk); color: var(--muted); }
	.panel { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 14px; }
	.panel.ok { background: var(--ok-soft); }
	.panel.acc { background: var(--acc-soft); }
	.panel.warn { background: var(--warn-soft); }
	.panel.note { background: var(--sunk); font-size: 13px; color: var(--muted); }
	.ptitle { font-size: 13.5px; font-weight: 700; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	.go { min-height: 48px; padding: 0 10px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 14px; cursor: pointer; }
	.go:disabled { opacity: 0.6; cursor: wait; }
	.okb { background: var(--ok); border-color: var(--ok); color: #fff; }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.warnb { background: var(--warn); border-color: var(--warn); color: #fff; }
	.full { width: 100%; }
	input[type='date'], textarea { width: 100%; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); padding: 10px 12px; font-size: 15px; }
	input[type='date'] { height: 46px; }
	.err { color: var(--bad); font-size: 13px; font-weight: 600; }
</style>
