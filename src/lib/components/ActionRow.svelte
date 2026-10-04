<script lang="ts">
	import { inr, windowText, ageText, type ActionItem } from '#lib/dashboard.ts';
	let { item }: { item: ActionItem } = $props();
	const win = $derived(windowText(item));
	const winTone = $derived(item.daysLeft !== null ? (item.daysLeft <= 2 ? 'p-bad' : 'p-warn') : 'p-mute');
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

{#if item.href}
	<a class="row" href={item.href} target="_blank" rel="noopener noreferrer">{@render body()}</a>
{:else}
	<div class="row">{@render body()}</div>
{/if}

<style>
	.row { display: flex; gap: 10px; padding: 11px 0; border-top: 1px solid var(--line); }
	.row:first-child { border-top: 0; padding-top: 2px; }
	.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 7px; flex: none; }
	.main { flex: 1; min-width: 0; }
	.t { font-weight: 600; font-size: 14px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
	.d { font-size: 12.5px; color: var(--muted); }
	.side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; }
	.side .money { font-size: 14px; }
</style>
