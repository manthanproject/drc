<script lang="ts">
	import BottomNav from '#lib/components/BottomNav.svelte';
	import ActionRow from '#lib/components/ActionRow.svelte';
	import { page } from '$app/state';
	import { rtoHref } from '#lib/scan.ts';
	import { BUCKETS, FILTERS, inr, orderLabel, type ListRow } from '#lib/dashboard.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const count = $derived(data.filter === 'action' ? data.action.length : data.rows.length);
	const total = $derived(
		data.filter === 'action' ? data.action.reduce((s, i) => s + i.amount, 0) : data.rows.reduce((s, r) => s + r.value, 0)
	);
	const pay = (r: ListRow) => (r.rto.payment_mode ? r.rto.payment_mode.toUpperCase() : '');
	let chips: HTMLDivElement | undefined = $state();
	$effect(() => {
		data.filter; // re-run when the filter changes
		chips?.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
	});
	const hrefFor = (f: string) => `/rtos?f=${f}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`;
</script>

<div class="app">
	<header class="topbar">
		<div class="mark">D</div>
		<h1>All RTOs</h1>
	</header>

	<div class="content">
		<form method="GET" class="search" role="search">
			<input type="hidden" name="f" value={data.filter} />
			<span aria-hidden="true">⌕</span>
			<input name="q" value={data.q} placeholder="Order no., AWB, phone or name" autocomplete="off" enterkeyhint="search" />
			{#if data.q}<a href="/rtos?f={data.filter}" class="clear" aria-label="Clear search">✕</a>{/if}
		</form>

		<div class="chips" role="tablist" bind:this={chips}>
			{#each FILTERS as f (f.key)}
				<a href={hrefFor(f.key)} class="chip" class:on={f.key === data.filter} role="tab" aria-selected={f.key === data.filter}>{f.label}</a>
			{/each}
		</div>

		<div class="sec">{data.label} <span>{count} · {inr(total)}</span></div>

		{#if data.filter === 'action'}
			{#if data.action.length}
				<div class="card">{#each data.action as item (item.key)}<ActionRow {item} />{/each}</div>
			{:else}
				<p class="muted small">Nothing here.</p>
			{/if}
		{:else if data.rows.length}
			<div class="list">
				{#each data.rows as r (r.rto.id)}
					{#snippet body()}
						<div class="top">
							<span class="ord">{orderLabel(r.rto)}</span>
							{#if r.nonDropy}<span class="pill p-mute">non-Dropy</span>{/if}
							{#if r.sheetOnly}<span class="pill p-mute">sheet only</span>{/if}
							<span class="money val">{inr(r.value)}</span>
						</div>
						<div class="who">{r.rto.customer_name ?? '—'}{#if pay(r)}{' · '}{pay(r)}{/if}</div>
						<div class="bot">
							<span class="where">
								{#if r.rto.forward_awb}{r.rto.carrier_name ?? 'Courier'} <span class="mono">{r.rto.forward_awb}</span><br />{/if}{r.ageText}
							</span>
							<span class="pill p-{BUCKETS[r.bucket].tone}">{BUCKETS[r.bucket].label}</span>
						</div>
					{/snippet}
					<a class="row card" class:flat={r.sheetOnly} href={rtoHref(r.rto.id, page.url.pathname + page.url.search)}>{@render body()}</a>
				{/each}
			</div>
		{:else}
			<p class="muted small">{data.q ? `No RTO matches “${data.q}”.` : 'Nothing here.'}</p>
		{/if}
	</div>
</div>
<BottomNav active="all" />

<style>
	.search { display: flex; align-items: center; gap: 8px; height: 48px; border: 1px solid var(--line); border-radius: 14px;
		background: var(--surface); padding: 0 14px; color: var(--muted); }
	.search input[name='q'] { flex: 1; min-width: 0; border: 0; background: none; outline: none; font-size: 15px; color: var(--ink); }
	.clear { font-size: 14px; padding: 6px; }
	.chips { display: flex; gap: 6px; overflow-x: auto; margin: 12px -16px 0; padding: 0 16px 2px; scrollbar-width: none; }
	.chips::-webkit-scrollbar { display: none; }
	.chip { flex: none; font-size: 12.5px; font-weight: 600; padding: 7px 11px; border-radius: 10px;
		border: 1px solid var(--line); background: var(--surface); }
	.chip.on { background: var(--acc); border-color: var(--acc); color: var(--acc-ink); }
	.list { display: flex; flex-direction: column; gap: 8px; }
	.row { display: block; padding: 12px 13px; }
	a.row:active { transform: scale(0.99); }
	.flat { background: var(--bg); border-style: dashed; }
	.top { display: flex; align-items: center; gap: 6px; }
	.ord { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; }
	.val { margin-left: auto; font-size: 15px; }
	.who { font-size: 13px; margin-top: 2px; }
	.bot { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; margin-top: 6px; }
	.where { font-size: 12.5px; color: var(--muted); }
</style>
