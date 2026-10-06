<script lang="ts">
	import BottomNav from '#lib/components/BottomNav.svelte';
	import ActionRow from '#lib/components/ActionRow.svelte';
	import ActionTable from '#lib/components/ActionTable.svelte';
	import { page } from '$app/state';
	import { rtoHref } from '#lib/scan.ts';
	import { BUCKETS, FILTERS, PARKED, inr, orderLabel, paymentBreakdown, type ListRow } from '#lib/dashboard.ts';
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
	const hrefFor = (f: string) => `/rtos?f=${f}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}${data.sort === 'old' ? '&s=old' : ''}`;
	const VIEWS = FILTERS.filter((f) => !(PARKED as string[]).includes(f.key));
	const PARKED_VIEWS = FILTERS.filter((f) => (PARKED as string[]).includes(f.key));
	const here = $derived(page.url.pathname + page.url.search);
</script>

<div class="app">
	<header class="topbar">
		<div class="mark">D</div>
		<h1>All RTOs</h1>
	</header>

	<div class="content lay">
		<aside class="views desk-only" aria-label="Views">
			<span class="vh">View</span>
			{#each VIEWS as f (f.key)}
				<a href={hrefFor(f.key)} class:on={f.key === data.filter} aria-current={f.key === data.filter ? 'page' : undefined}><span>{f.label}</span><span class="vn">{data.counts[f.key]}</span></a>
			{/each}
			<span class="vh">Parked / done</span>
			{#each PARKED_VIEWS as f (f.key)}
				{#if data.counts[f.key] || f.key === data.filter}
					<a href={hrefFor(f.key)} class:on={f.key === data.filter} aria-current={f.key === data.filter ? 'page' : undefined}><span>{f.label}</span><span class="vn">{data.counts[f.key]}</span></a>
				{/if}
			{/each}
		</aside>
		<div class="main">
		<form method="GET" class="search" role="search">
			<input type="hidden" name="f" value={data.filter} />
			{#if data.sort === 'old'}<input type="hidden" name="s" value="old" />{/if}
			<span aria-hidden="true">⌕</span>
			<input name="q" value={data.q} placeholder="Order no., AWB, phone or name" autocomplete="off" enterkeyhint="search" />
			{#if data.q}<a href="/rtos?f={data.filter}" class="clear" aria-label="Clear search">✕</a>{/if}
		</form>

		<div class="chips mobile-only" role="tablist" bind:this={chips}>
			{#each FILTERS as f (f.key)}
				<a href={hrefFor(f.key)} class="chip" class:on={f.key === data.filter} role="tab" aria-selected={f.key === data.filter}>{f.label}</a>
			{/each}
		</div>

		<div class="sechead">
			<div class="sec">{data.label} <span>{count} · {inr(total)}</span></div>
			{#if data.filter !== 'action' && data.rows.length > 1}
				<form method="GET" class="sort">
					<input type="hidden" name="f" value={data.filter} />
					{#if data.q}<input type="hidden" name="q" value={data.q} />{/if}
					<label for="sort" class="small muted">Sort</label>
					<select id="sort" name="s" value={data.sort} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
						<option value="value">Value, high → low</option>
						<option value="old">Oldest first</option>
					</select>
					<noscript><button>Go</button></noscript>
				</form>
			{/if}
		</div>

		{#if data.filter === 'action'}
			{#if data.action.length}
				<div class="card mobile-only">{#each data.action as item (item.key)}<ActionRow {item} />{/each}</div>
				<div class="desk-only"><ActionTable items={data.action} title="Needs action" /></div>
			{:else}
				<p class="muted small">Nothing here.</p>
			{/if}
		{:else if data.rows.length}
			<div class="tbl desk-only" role="table" aria-label={data.label}>
				<div class="tr th" role="row"><span role="columnheader">Order</span><span role="columnheader">Customer</span><span role="columnheader">Courier · AWB</span><span role="columnheader">Payment</span><span role="columnheader">Stage</span><span role="columnheader">{data.filter === 'coming' || data.filter === 'delayed' ? 'Last move' : 'Delivered back'}</span><span role="columnheader" class="r">Value</span></div>
				{#each data.rows as r (r.rto.id)}
					{@const p = paymentBreakdown(r.rto)}
					<a class="tr" class:flat={r.sheetOnly} role="row" href={rtoHref(r.rto.id, here)}>
						<span class="ord">{orderLabel(r.rto)}{#if r.nonDropy} <span class="pill p-mute">non-Dropy</span>{/if}{#if r.sheetOnly} <span class="pill p-mute">sheet</span>{/if}{#if r.rto.reship_state === 'pending'} <span class="pill p-ok">re-ship?</span>{/if}</span>
						<span class="ell">{r.rto.customer_name ?? '—'}</span>
						<span class="small">{#if r.rto.forward_awb}{r.rto.carrier_name ?? 'Courier'}<span class="mono muted blk">{r.rto.forward_awb}</span>{:else}<span class="muted">no AWB</span>{/if}</span>
						<span class="small"><b>{p.label.split(' · ')[0]}</b>{#if p.detail}<span class="muted blk">{p.detail}</span>{/if}</span>
						<span><span class="pill p-{BUCKETS[r.bucket].tone}">{BUCKETS[r.bucket].label}</span></span>
						<span class="small muted">{r.ageText}</span>
						<span class="money r">{inr(r.value)}</span>
					</a>
				{/each}
			</div>
			<div class="list mobile-only">
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
	.sechead { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
	.sort { display: flex; align-items: center; gap: 6px; }
	.sort select { height: 36px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); padding: 0 8px; font-size: 13px; }

	/* PC: views sidebar + table */
	@media (min-width: 1024px) {
		.lay { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 18px; align-items: start; }
		.main { min-width: 0; }
		.views { display: flex; flex-direction: column; gap: 2px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 10px; position: sticky; top: 84px; }
		.vh { font-size: 11.5px; font-weight: 700; color: var(--muted); padding: 8px 12px 4px; }
		.views a { display: flex; justify-content: space-between; padding: 8px 12px; border-radius: 10px; font-size: 13.5px; }
		.views a:hover { background: var(--sunk); }
		.views a.on { background: var(--acc-soft); color: var(--acc); font-weight: 700; }
		.vn { color: var(--muted); font-variant-numeric: tabular-nums; }
		.views a.on .vn { color: var(--acc); }
		.search { height: 44px; }
		.sec { margin-top: 16px; }
		.tbl { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
		.tr { display: grid; grid-template-columns: 150px minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, 1.1fr) 140px minmax(0, 1.2fr) 92px; gap: 12px; align-items: center; padding: 11px 16px; border-top: 1px solid var(--line); }
		.th { border-top: 0; background: var(--sunk); font-size: 11.5px; font-weight: 700; color: var(--muted); padding: 8px 16px; }
		a.tr:hover { background: color-mix(in srgb, var(--sunk) 55%, transparent); }
		a.tr.flat { background: var(--bg); }
		.tr .ord { font-size: 14.5px; }
		.ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.blk { display: block; }
		.r { text-align: right; }
	}
</style>
