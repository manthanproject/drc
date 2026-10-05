<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { inr, windowText, ageText, type ActionItem } from '#lib/dashboard.ts';
	let { item }: { item: ActionItem } = $props();
	const win = $derived(windowText(item));
	const winTone = $derived(item.daysLeft !== null ? (item.daysLeft <= 2 ? 'p-bad' : 'p-warn') : 'p-mute');
	const isReship = $derived(item.kind === 'reship_found');

	let busy = $state(false);
	let err = $state('');
	async function decide(action: 'reship_confirm' | 'reship_reject') {
		if (!item.rto || busy) return;
		busy = true;
		err = '';
		try {
			const r = await fetch(`/api/rto/${item.rto.id}/action`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action })
			});
			if (!r.ok) err = (await r.json().catch(() => null))?.message ?? `Failed (${r.status})`;
			else await invalidateAll();
		} catch {
			err = 'No connection, try again';
		} finally {
			busy = false;
		}
	}
</script>

{#snippet body()}
	<span class="dot" style="background: var(--{item.tone === 'mute' ? 'muted' : item.tone})"></span>
	<div class="main">
		<div class="t">
			{item.title}
			{#if item.nonDropy}<span class="pill p-mute">non-Dropy</span>{/if}
		</div>
		<div class="d">{item.detail}</div>
		<div class="d">{ageText(item)}</div>
	</div>
	<div class="side">
		<div class="money">{inr(item.amount)}</div>
		{#if win}<span class="pill {winTone}">{win}</span>{/if}
	</div>
{/snippet}

{#if isReship}
	<div class="row col">
		<div class="line">{@render body()}</div>
		<div class="acts">
			<button class="yes" disabled={busy} onclick={() => decide('reship_confirm')}>Confirm received</button>
			<button class="no" disabled={busy} onclick={() => decide('reship_reject')}>No, sent new stock</button>
			{#if item.rto}<a class="trk" href="/rto/{item.rto.id}">Open</a>{/if}
		</div>
		{#if err}<div class="err" role="alert">{err}</div>{/if}
	</div>
{:else if item.rto}
	<a class="row" href="/rto/{item.rto.id}">{@render body()}</a>
{:else}
	<div class="row">{@render body()}</div>
{/if}

<style>
	.row { display: flex; gap: 10px; padding: 11px 0; border-top: 1px solid var(--line); }
	.row:first-child { border-top: 0; padding-top: 2px; }
	.col { flex-direction: column; gap: 8px; }
	.line { display: flex; gap: 10px; }
	.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 7px; flex: none; }
	.main { flex: 1; min-width: 0; }
	.t { font-weight: 600; font-size: 14px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
	.d { font-size: 12.5px; color: var(--muted); }
	.side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; }
	.side .money { font-size: 14px; }
	.acts { display: flex; gap: 8px; flex-wrap: wrap; padding-left: 18px; align-items: center; }
	.acts button { height: 40px; padding: 0 12px; border-radius: 11px; font-weight: 700; font-size: 13px; cursor: pointer; }
	.yes { background: var(--ok); color: #fff; border: 0; }
	.no { background: var(--surface); color: var(--ink); border: 1px solid var(--line); }
	.acts button:disabled { opacity: 0.6; cursor: wait; }
	.trk { font-size: 13px; font-weight: 600; color: var(--acc); padding: 0 4px; }
	.err { color: var(--bad); font-size: 12.5px; font-weight: 600; padding-left: 18px; }
</style>
