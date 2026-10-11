<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import { rtoHref } from '#lib/scan.ts';
	import { inr } from '#lib/dashboard.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const here = $derived(`/scan/log?d=${data.day}`);

	// Clear today's scans (scanned by mistake / wrong status): each parcel goes back as it was before the scan
	const clearable = $derived.by(() => {
		if (data.day !== data.today) return [];
		const seen = new Map<string, { rtoId: string; order: string; time: string; scannedAs: string }>();
		for (const r of data.rows) if (r.rtoId && !r.undone && !seen.has(r.rtoId)) seen.set(r.rtoId, { rtoId: r.rtoId, order: r.order, time: r.time, scannedAs: r.scannedAs });
		return [...seen.values()];
	});
	let clearing = $state(false);
	let picked = $state<string[]>([]);
	let busy = $state(false);
	let result = $state<{ ok: string[]; bad: string[] } | null>(null);
	async function clearPicked() {
		if (busy || !picked.length) return;
		busy = true;
		const ok: string[] = [];
		const bad: string[] = [];
		for (const id of picked) {
			const row = clearable.find((c) => c.rtoId === id);
			try {
				const res = await fetch(`/api/rto/${id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'clear_scan' }) });
				const b = await res.json().catch(() => ({}));
				if (res.ok) ok.push(row?.order ?? id);
				else bad.push(`${row?.order ?? id}: ${b?.message ?? 'could not clear'}`);
			} catch {
				bad.push(`${row?.order ?? id}: no connection`);
			}
		}
		result = { ok, bad };
		picked = [];
		clearing = false;
		busy = false;
		await invalidateAll();
	}
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

		{#if result}
			<div class="card res" role="status">
				{#if result.ok.length}<p class="okl">Cleared {result.ok.join(', ')}. Scan {result.ok.length === 1 ? 'it' : 'them'} again on the Scan screen.</p>{/if}
				{#each result.bad as b}<p class="badl small">{b}</p>{/each}
			</div>
		{/if}
		{#if clearable.length}
			{#if !clearing}
				<button class="lnkb" onclick={() => { clearing = true; result = null; }}>Scanned something by mistake? Clear today's scans</button>
			{:else}
				<div class="card clr">
					<b>Clear today's scans</b>
					<p class="small muted">Tick the parcels to clear. Each goes back exactly as it was before today's scan (status, Ready Stock, refund row and a draft claim are undone), so you can scan it again. Not possible if its claim is already raised or its refund is marked Done.</p>
					{#each clearable as c (c.rtoId)}
						<label class="pick"><input type="checkbox" value={c.rtoId} bind:group={picked} /><span class="mono">{c.time}</span><b>{c.order}</b><span class="small muted">{c.scannedAs}</span></label>
					{/each}
					<div class="crow">
						<button class="go warnb" disabled={busy || !picked.length} onclick={clearPicked}>{busy ? 'Clearing…' : `Clear ${picked.length || ''} scan${picked.length === 1 ? '' : 's'}`}</button>
						<button class="go" disabled={busy} onclick={() => { clearing = false; picked = []; }}>Cancel</button>
					</div>
				</div>
			{/if}
		{/if}

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
	.lnkb { align-self: flex-start; border: 0; background: none; color: var(--muted); font: inherit; font-weight: 600; font-size: 13.5px; cursor: pointer; padding: 2px 0; text-decoration: underline; }
	.clr { display: flex; flex-direction: column; gap: 8px; }
	.clr p, .res p { margin: 0; }
	.pick { display: grid; grid-template-columns: 24px 52px minmax(0, 1fr) auto; gap: 8px; align-items: center; min-height: 44px; border-top: 1px solid var(--line); cursor: pointer; }
	.pick input { width: 20px; height: 20px; }
	.crow { display: flex; gap: 8px; flex-wrap: wrap; }
	.go { min-height: 48px; padding: 0 18px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: inherit; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer; }
	.warnb { background: var(--warn, #b7791f); border-color: var(--warn, #b7791f); color: #fff; }
	.go:disabled { opacity: 0.5; cursor: default; }
	.res { display: flex; flex-direction: column; gap: 4px; }
	.okl { color: var(--ok); font-weight: 600; }
	.badl { color: var(--bad); }
	.sr { position: absolute; left: -9999px; }
	@media (min-width: 1024px) {
		.tr { grid-template-columns: 70px 160px minmax(0, 1.4fr) 150px 150px 100px; grid-template-areas: none; gap: 12px; }
		.tr > span { grid-area: auto !important; }
		.th { background: var(--sunk); font-size: 11.5px; font-weight: 700; color: var(--muted); padding: 8px 14px; }
		.cour .blk { display: inline; margin-left: 6px; }
		.nowc { justify-self: start; }
	}
</style>
