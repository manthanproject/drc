<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import ActionRow from '#lib/components/ActionRow.svelte';
	import ActionTable from '#lib/components/ActionTable.svelte';
	import { rtoHref } from '#lib/scan.ts';
	import { inr } from '#lib/dashboard.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const d = $derived(data.d);
	const top5 = $derived(d.action.slice(0, 5));
	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
	const flow = $derived(d.coming.n ? [d.coming.started, d.coming.moving, d.coming.ofd] : [0, 0, 0]);
</script>

<div class="app">
	<header class="topbar mobile-only">
		<div class="mark">D</div>
		<h1>Returns</h1>
		<button class="sync" class:bad={!data.sync.ok} onclick={refresh} disabled={refreshing} title="Tap to refresh">
			{#if refreshing}Refreshing…{:else}Synced <b>{data.sync.text}</b>{/if}
		</button>
	</header>

	<main class="content home">
		<div class="act">
			<section class="card urgent mobile-only" aria-labelledby="na">
				<div class="urg-head">
					<b id="na">Needs action today</b>
					<span class="pill {d.action.length ? 'p-bad' : 'p-ok'}">{d.action.length}</span>
				</div>
				{#if d.action.length === 0}
					<p class="muted small" style="margin:0">Nothing late. Every parcel the courier delivered back has been scanned.</p>
				{:else}
					<div>
						{#each top5 as item (item.key)}<ActionRow {item} />{/each}
					</div>
					{#if d.action.length > top5.length}
						<a class="more" href="/rtos?f=action">See all {d.action.length} →</a>
					{/if}
				{/if}
			</section>
			<div class="desk-only"><ActionTable items={d.action} limit={15} /></div>
		</div>

		<div class="kpi">
		<div class="sec">Where every RTO is <span>tap a box to see the list</span></div>
		<div class="buckets">
			<a class="bucket wide" href="/rtos?f=coming">
				<div class="n">{d.coming.n}</div>
				<div style="flex:1">
					<div class="l" style="margin:0">Coming back</div>
					<div class="s" style="padding:0">
						{d.coming.started} started, {d.coming.moving} moving, {d.coming.ofd} out for delivery{#if d.coming.noDate}<br />{d.coming.noDate} with no tracking date{/if}
					</div>
					<div class="flow">
						<div style="background:var(--muted);flex:{flow[0]}"></div>
						<div style="background:var(--acc);flex:{flow[1]}"></div>
						<div style="background:var(--ok);flex:{flow[2]}"></div>
					</div>
				</div>
			</a>
			<a class="bucket hot" href="/rtos?f=awaiting">
				<div class="n">{d.awaiting.n}</div>
				<div class="l">Arrived, not scanned</div>
				<div class="s"><span class="money">{inr(d.awaiting.value)}</span> · claim flags at {data.rules.mdndHours} h</div>
			</a>
			<a class="bucket" href="/rtos?f=delayed">
				<div class="n">{d.delayed.n}</div>
				<div class="l">Delayed</div>
				<div class="s">No movement for {data.rules.delayedDays}+ days</div>
			</a>
			<a class="bucket" href="/rtos?f=inspect">
				<div class="n">{d.inspect.n}</div>
				<div class="l">To inspect</div>
				<div class="s">Scanned in, not checked</div>
			</a>
			<a class="bucket" href="/rtos?f=call">
				<div class="n">{d.call.n}</div>
				<div class="l">To call</div>
				<div class="s">Items OK, customer not reached</div>
			</a>
			<a class="bucket" href="/rtos?f=claims">
				<div class="n">{d.claims.n}</div>
				<div class="l">Claims open</div>
				<div class="s money" style="font-weight:600">{inr(d.claims.atStake)} at stake</div>
			</a>
			<a class="bucket" href="/rtos?f=credit">
				<div class="n">{d.creditDue.n}</div>
				<div class="l">Credit note due</div>
				<div class="s">{d.creditDue.n ? `${inr(d.creditDue.value)} approved, not in` : 'Approved, money not in'}</div>
			</a>
		</div>
		</div>

		<aside class="side">
			<div class="card desk-only">
				<div class="todayhead"><b>Scanned today</b><span class="muted small">{data.today.length}</span></div>
				{#each data.today.slice(0, 8) as t (t.id)}
					<a class="todayrow" href={rtoHref(t.id, '/')}><span><b>{t.order}</b> <span class="muted small">{t.carrier ?? ''}</span></span><span class="pill p-{t.tone}">{t.stage}</span></a>
				{:else}
					<p class="muted small">Nothing scanned yet today.</p>
				{/each}
				<a class="openscan" href="/scan">Open Scan →</a>
			</div>
			{#if d.parked.length}
				<div class="sec">Parked / done</div>
				<div class="parked">
					{#each d.parked as p (p.key)}
						<a href="/rtos?f={p.key}"><b>{p.n}</b> {p.label}</a>
					{/each}
				</div>
			{/if}
			<p class="small muted total">{d.total} RTOs in DRC</p>
		</aside>
	</main>
</div>
<BottomNav active="home" />

<style>
	.sync { background: none; border: 0; padding: 4px 0; font-size: 12px; color: var(--muted); cursor: pointer; }
	.sync b { color: var(--ok); font-weight: 600; }
	.sync.bad b { color: var(--bad); }
	.urgent { border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); }
	.urg-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
	.urg-head b { font-size: 15px; }
	.more { display: block; text-align: center; margin-top: 4px; padding: 10px 0 0; border-top: 1px solid var(--line);
		font-size: 13.5px; font-weight: 700; color: var(--acc); }
	.buckets { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.bucket { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 12px 13px 11px;
		min-height: 96px; display: flex; flex-direction: column; }
	.bucket:active { transform: scale(0.985); }
	.n { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
	.l { font-size: 13.5px; font-weight: 600; margin-top: 6px; }
	.s { font-size: 12px; color: var(--muted); margin-top: auto; padding-top: 4px; }
	.hot { border-color: var(--acc); background: var(--acc-soft); }
	.hot .n { color: var(--acc); }
	.wide { grid-column: 1 / -1; flex-direction: row; align-items: center; gap: 14px; min-height: 0; }
	.flow { display: flex; gap: 4px; margin-top: 8px; }
	.flow div { height: 6px; border-radius: 3px; background: var(--sunk); min-width: 0; }
	.parked { display: flex; flex-wrap: wrap; gap: 8px; }
	.parked a { font-size: 13px; padding: 7px 11px; border-radius: 11px; background: var(--surface); border: 1px solid var(--line); }
	.parked b { font-variant-numeric: tabular-nums; }
	.total { text-align: center; margin-top: 18px; }
	.todayhead { display: flex; justify-content: space-between; margin-bottom: 4px; }
	.todayrow { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 0; border-top: 1px solid var(--line); }
	.openscan { display: block; margin-top: 8px; font-size: 13.5px; font-weight: 700; color: var(--acc); }

	/* PC: stage boxes in one row on top, Needs action table left, Scanned today + Parked right */
	@media (min-width: 1024px) {
		.home { display: grid; grid-template-columns: minmax(0, 1fr) 320px; grid-template-areas: 'kpi kpi' 'act side'; gap: 18px; align-items: start; }
		.act { grid-area: act; min-width: 0; }
		.kpi { grid-area: kpi; }
		.side { grid-area: side; display: flex; flex-direction: column; }
		.kpi .sec { margin-top: 0; }
		.buckets { grid-template-columns: repeat(7, minmax(0, 1fr)); }
		.wide { grid-column: auto; flex-direction: column; align-items: stretch; gap: 0; min-height: 96px; }
		.wide .l { margin-top: 6px !important; }
		.wide .s { margin-top: auto; padding-top: 4px !important; }
		.side .sec { margin-top: 18px; }
		.parked { flex-direction: column; gap: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 4px 14px; }
		.parked a { display: flex; flex-direction: row-reverse; justify-content: space-between; border: 0; border-top: 1px solid var(--line); border-radius: 0; padding: 9px 0; background: none; font-size: 13.5px; }
		.parked a:first-child { border-top: 0; }
	}
</style>
