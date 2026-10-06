<script lang="ts">
	import { goto } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import { rtoHref } from '#lib/scan.ts';
	import { inr } from '#lib/dashboard.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const here = $derived(`/scan/log?d=${data.day}`);
</script>

<div class="app">
	<header class="topbar">
		<a class="back" href="/scan" aria-label="Back to Scan">‹</a>
		<h1>Scan log</h1>
		<a class="csv desk-only" href="/scan/log/csv?d={data.day}" download>Download CSV</a>
	</header>

	<main class="content stack">
		<div class="daybar">
			<a class="nav" href="/scan/log?d={data.prev}" aria-label="Previous day">‹</a>
			<label class="sr" for="day">Day</label>
			<input id="day" type="date" value={data.day} max={data.today} onchange={(e) => e.currentTarget.value && goto(`/scan/log?d=${e.currentTarget.value}`)} />
			<b class="lbl">{data.label}{#if data.day === data.today} <span class="pill p-acc">Today</span>{/if}</b>
			{#if data.next}<a class="nav" href="/scan/log?d={data.next}" aria-label="Next day">›</a>{:else}<span class="nav off" aria-hidden="true">›</span>{/if}
		</div>

		<div class="card sum">
			<b>{data.sum.total} scanned</b>{#if data.sum.total}<span class="muted"> · {inr(data.sum.value)}</span>{/if}
			{#each data.sum.parts as p (p.label)}<span class="pill p-mute">{p.label} {p.n}</span>{/each}
			<a class="csv mobile-only" href="/scan/log/csv?d={data.day}" download>Download CSV</a>
		</div>

		{#if data.rows.length === 0}
			<p class="muted small empty">No parcels were scanned on this day.</p>
		{:else}
			<div class="tbl" role="table" aria-label="Scans on {data.label}">
				<div class="tr th desk-only" role="row"><span>Time</span><span>Order</span><span>Courier · AWB</span><span>Scanned as</span><span>Now</span><span class="r">Value</span></div>
				{#each data.rows as r (r.eventId)}
					<svelte:element this={r.rtoId ? 'a' : 'div'} class="tr" class:undone={r.undone} role="row" href={r.rtoId ? rtoHref(r.rtoId, here) : undefined}>
						<span class="time mono">{r.time}</span>
						<span class="ord">{r.order}{#if r.undone} <span class="pill p-mute">undone</span>{/if}</span>
						<span class="small cour">{r.courier}<span class="mono muted blk">{r.awb}</span></span>
						<span><span class="pill p-{r.scannedTone}">{r.scannedAs}</span></span>
						<span class="nowc">{#if r.changed}<span class="small muted mobile-only">now </span><span class="pill p-{r.nowTone}">{r.now}</span>{:else}<span class="muted small desk-only">same</span>{/if}</span>
						<span class="money r">{r.value ? inr(r.value) : ''}</span>
					</svelte:element>
				{/each}
			</div>
		{/if}
		<p class="small muted note">Every scan is kept permanently in DRC's history. "Now" shows the status today if it changed after the scan.</p>
	</main>
</div>
<BottomNav active="scan" />

<style>
	.stack { display: flex; flex-direction: column; gap: 12px; }
	.back { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-size: 22px; }
	.csv { font-size: 13.5px; font-weight: 700; color: var(--acc); }
	.daybar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.daybar .nav { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-size: 20px; }
	.daybar .off { opacity: 0.35; }
	.daybar input { height: 40px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); padding: 0 10px; }
	.lbl { flex: 1; font-size: 15px; }
	.sum { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
	.sum .csv { margin-left: auto; }
	.empty { text-align: center; padding: 24px 0; }
	.tbl { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
	.tr { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; grid-template-areas: 'time ord val' 'time cour cour' 'time as now'; gap: 2px 10px; padding: 11px 14px; border-top: 1px solid var(--line); align-items: center; }
	.tr:first-child, .th + .tr { border-top: 0; }
	.time { grid-area: time; align-self: start; font-weight: 700; padding-top: 2px; }
	.ord { grid-area: ord; font-weight: 800; }
	.cour { grid-area: cour; }
	.tr > span:nth-child(4) { grid-area: as; }
	.nowc { grid-area: now; justify-self: end; }
	.r { grid-area: val; text-align: right; }
	.blk { display: block; }
	.undone { opacity: 0.5; }
	a.tr:hover { background: color-mix(in srgb, var(--sunk) 55%, transparent); }
	.note { text-align: center; }
	.sr { position: absolute; left: -9999px; }
	@media (min-width: 1024px) {
		.tr { grid-template-columns: 70px 160px minmax(0, 1.4fr) 150px 150px 100px; grid-template-areas: none; gap: 12px; }
		.tr > span { grid-area: auto !important; }
		.th { background: var(--sunk); font-size: 11.5px; font-weight: 700; color: var(--muted); padding: 8px 14px; }
		.cour .blk { display: inline; margin-left: 6px; }
		.nowc { justify-self: start; }
	}
</style>
