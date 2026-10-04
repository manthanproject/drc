<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import ActionRow from '#lib/components/ActionRow.svelte';
	import { inr } from '#lib/dashboard.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const d = $derived(data.d);
	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
	const flow = $derived(d.coming.n ? [d.coming.started, d.coming.moving, d.coming.ofd] : [0, 0, 0]);
</script>

<div class="app">
	<header class="topbar">
		<div class="mark">D</div>
		<h1>Returns</h1>
		<button class="sync" class:bad={!data.sync.ok} onclick={refresh} disabled={refreshing} title="Tap to refresh">
			{#if refreshing}Refreshing…{:else}Synced <b>{data.sync.text}</b>{/if}
		</button>
	</header>

	<main class="content">
		<section class="card urgent" aria-labelledby="na">
			<div class="urg-head">
				<b id="na">Needs action today</b>
				<span class="pill {data.actionTotal ? 'p-bad' : 'p-ok'}">{data.actionTotal}</span>
			</div>
			{#if d.action.length === 0}
				<p class="muted small" style="margin:0">Nothing late. Every parcel the courier delivered back has been scanned.</p>
			{:else}
				<div>
					{#each d.action as item (item.key)}<ActionRow {item} />{/each}
				</div>
				{#if data.actionTotal > d.action.length}
					<a class="more" href="/rtos?f=action">See all {data.actionTotal} →</a>
				{/if}
			{/if}
		</section>

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

		{#if d.parked.length}
			<div class="sec">Parked / done</div>
			<div class="parked">
				{#each d.parked as p (p.key)}
					<a href="/rtos?f={p.key}"><b>{p.n}</b> {p.label}</a>
				{/each}
			</div>
		{/if}
		<p class="small muted total">{d.total} RTOs in DRC</p>
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
</style>
