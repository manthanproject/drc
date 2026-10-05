<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import StatusPicker from '#lib/components/StatusPicker.svelte';
	import UndoBar from '#lib/components/UndoBar.svelte';
	import { BUCKETS, bucketOf, DEFAULT_RULES, inr, num, orderLabel, dateShort, trackingUrl, isSheetOnly } from '#lib/dashboard.ts';
	import { describe } from '#lib/history.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.rto);
	const bucket = $derived(BUCKETS[bucketOf(r, Date.now(), DEFAULT_RULES)]);
	let undo = $state<{ text: string; eventId: number } | null>(null);
	let packing = $state<{ state: string; url?: string } | null>(null);
	let busy = $state(false);
	let err = $state('');

	const MONEY: Record<string, [string, string]> = {
		due: ['Refund due', 'p-bad'], done: ['Refunded', 'p-ok'], credit_due: ['Store credit to give', 'p-warn'], credit_done: ['Store credit given', 'p-ok']
	};
	const phone = $derived(r.customer_phone10 ? `+91${r.customer_phone10}` : null);
	const paid = $derived(r.payment_mode === 'partial' ? num(r.amount_collected) : num(r.order_value));

	onMount(() => {
		if (r.forward_awb) fetch(`/api/rto/${r.id}/packing`).then((x) => x.json()).then((x) => (packing = x)).catch(() => (packing = { state: 'error' }));
	});

	async function act(action: string) {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const res = await fetch(`/api/rto/${r.id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
			const b = await res.json().catch(() => ({}));
			if (!res.ok) err = b?.message ?? 'Could not save';
			else {
				undo = { text: action === 'call_no_answer' ? `No answer logged${b.to === 'hold' ? ', moved to Hold' : ''}` : 'Saved', eventId: b.event_id };
				await invalidateAll();
			}
		} catch {
			err = 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}

	async function saved(res: { event_id: number; label: string }) {
		undo = { text: `Saved as ${res.label}`, eventId: res.event_id };
		await invalidateAll();
	}
	async function undoDone() {
		undo = null;
		await invalidateAll();
	}
</script>

<div class="app">
	<header class="topbar">
		<a class="back" href="/rtos" aria-label="Back to All RTOs">‹</a>
		<h1>{orderLabel(r)}</h1>
		<span class="pill p-{bucket.tone}">{bucket.label}</span>
	</header>

	<main class="content stack">
		{#if undo}{#key undo.eventId}<UndoBar text={undo.text} eventId={undo.eventId} ondone={undoDone} />{/key}{/if}

		<div class="card">
			<dl>
				<dt>Customer</dt><dd>{r.customer_name ?? '—'}</dd>
				<dt>Payment</dt><dd>{(r.payment_mode ?? '—').toUpperCase()} · {inr(num(r.order_value))}</dd>
				{#if MONEY[r.refund_state]}<dt>Money</dt><dd><span class="pill {MONEY[r.refund_state][1]}">{MONEY[r.refund_state][0]} {inr(paid)}</span></dd>{/if}
				<dt>Courier</dt><dd>{#if isSheetOnly(r)}From old sheet, no AWB{:else}{r.carrier_name ?? ''} <span class="mono">{r.forward_awb}</span>{/if}</dd>
				{#if r.rto_delivered_at}<dt>Delivered back</dt><dd>{dateShort(r.rto_delivered_at)}</dd>{/if}
				{#if r.last_event_text}<dt>Last courier event</dt><dd>{r.last_event_text}{r.last_event_at ? `, ${dateShort(r.last_event_at)}` : ''}</dd>{/if}
				{#if r.reship_date}<dt>Re-ship date</dt><dd>{dateShort(r.reship_date + 'T12:00:00Z')}</dd>{/if}
			</dl>
			{#if data.items.length}
				<ul class="items">
					{#each data.items as it (it.id)}
						<li>{it.title || it.sku || "Item"}{#if it.qty > 1} ×{it.qty}{/if}{#if it.is_gift} <span class="pill p-acc">free gift</span>{/if}{#if it.ready_stock_state === 'in_stock'} <span class="pill p-ok">in Ready Stock</span>{/if}</li>
					{/each}
				</ul>
			{/if}
			<div class="links">
				{#if packing?.state === 'found'}<a href={packing.url} target="_blank" rel="noopener noreferrer">▶ Packing video</a>
				{:else if packing?.state === 'purged'}<span class="muted small">Packing video deleted (PC archive)</span>
				{:else if packing?.state === 'missing'}<span class="muted small">No packing video</span>
				{:else if r.forward_awb}<span class="muted small">Looking for packing video…</span>{/if}
				{#if trackingUrl(r)}<a href={trackingUrl(r)} target="_blank" rel="noopener noreferrer">Track</a>{/if}
			</div>
		</div>

		{#if r.reship_state === 'pending'}
			<div class="card okcard">
				<b>Re-shipped as #{r.reship_order_no}?</b>
				<p class="small muted">Velocity shows a re-ship created {dateShort(r.reship_created_at)}, after this parcel came back.</p>
				<div class="two">
					<button class="go okb" disabled={busy} onclick={() => act('reship_confirm')}>Confirm received</button>
					<button class="go" disabled={busy} onclick={() => act('reship_reject')}>No, sent new stock</button>
				</div>
			</div>
		{/if}

		{#if phone && (r.stage === 'to_call' || r.stage === 'hold')}
			<div class="card">
				<div class="callhead"><b>Customer call</b><span class="pill p-warn">Attempt {Math.min(r.callback_attempts + 1, data.maxCalls)} of {data.maxCalls}</span></div>
				<p class="small muted">After {data.maxCalls} unanswered calls it moves to Hold.</p>
				<div class="three">
					<a class="go okb" href="tel:{phone}">Call</a>
					<a class="go" href="https://wa.me/91{r.customer_phone10}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
					{#if r.stage === 'to_call'}<button class="go" disabled={busy} onclick={() => act('call_no_answer')}>No answer</button>{/if}
				</div>
			</div>
		{/if}

		{#if err}<p class="err" role="alert">{err}</p>{/if}

		{#if r.stage !== 'unknown_parcel'}
			<div class="card"><StatusPicker rto={r} title={r.stage === 'to_call' ? 'Call outcome / change status' : 'Change status'} onsaved={saved} /></div>
		{/if}

		{#if r.notes}<div class="card"><b>Notes</b><p class="notes">{r.notes}</p></div>{/if}

		<div class="card">
			<b>History</b>
			{#each data.events as e (e.id)}
				{@const d = describe(e)}
				<div class="ev" class:muted={d.muted}><span class="dot"></span><span><span class="et">{d.text}</span><small>{dateShort(e.received_at)} {new Date(e.received_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · {d.who}</small></span></div>
			{:else}
				<p class="small muted">No history yet.</p>
			{/each}
		</div>
	</main>
</div>
<BottomNav active="all" />

<style>
	.stack { display: flex; flex-direction: column; gap: 12px; }
	.back { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-size: 22px; }
	dl { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; font-size: 13.5px; }
	dt { color: var(--muted); }
	dd { margin: 0; font-weight: 600; text-align: right; }
	.items { margin: 10px 0 0; padding-left: 18px; font-size: 13.5px; }
	.links { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
	.links a { color: var(--acc); font-weight: 600; font-size: 13.5px; }
	.okcard { background: var(--ok-soft); border-color: transparent; }
	.okcard p { margin: 4px 0 10px; }
	.callhead { display: flex; justify-content: space-between; align-items: center; }
	.callhead + p { margin: 4px 0 10px; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
	.go { min-height: 48px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 14px; cursor: pointer; text-align: center; }
	.okb { background: var(--ok); border-color: var(--ok); color: #fff; }
	.err { color: var(--bad); font-weight: 600; margin: 0; }
	.notes { white-space: pre-line; font-size: 13.5px; margin: 6px 0 0; }
	.ev { display: flex; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); }
	.ev:first-of-type { border-top: 0; }
	.ev.muted { opacity: 0.55; }
	.ev .dot { width: 8px; height: 8px; margin-top: 7px; flex: none; border-radius: 50%; background: var(--acc); }
	.et { display: block; font-size: 13.5px; font-weight: 600; }
	.ev small { font-size: 12px; color: var(--muted); }
</style>
