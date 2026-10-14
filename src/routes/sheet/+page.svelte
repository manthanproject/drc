<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import { BUCKETS, bucketOfStage, agoText } from '#lib/dashboard.ts';
	import { rtoHref } from '#lib/scan.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const stageLabel = (s: string) => (s === 'skip' ? 'RTO in transit' : s === 'reshipped' ? 'Re-shipped (done)' : (BUCKETS[bucketOfStage(s)]?.label ?? s));
	const tone = (s: string) => BUCKETS[bucketOfStage(s)]?.tone ?? 'mute';
	const ACT: Record<string, string> = { close: 'Received → Closed', received_call: 'Received → To call', hold: 'Received → Hold', ready_stock: 'Received → Ready Stock' };
	const here = '/sheet';

	let busy = $state('');
	let msg = $state('');
	let bad = $state(false);
	async function post(body: Record<string, unknown>, key: string) {
		if (busy) return;
		busy = key;
		msg = '';
		bad = false;
		try {
			const r = await fetch('/api/sheet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			const b = await r.json().catch(() => ({}));
			if (!r.ok) {
				bad = true;
				msg = b?.message ?? 'Could not save';
			} else if (body.op === 'sync') {
				const d = b.done ?? {};
				msg = `Synced: ${d.received ?? 0} marked received in DRC, ${d.appended ?? 0} rows added to the sheet, ${d.written ?? 0} sheet cells updated.${b.errors?.length ? ` ${b.errors.length} not done: ${b.errors.join(' · ')}` : ''}`;
				bad = !!b.errors?.length;
			} else if (body.op === 'auto') msg = b.auto ? 'Auto sync is on: every 15 minutes.' : 'Auto sync is off: DRC only checks.';
			else msg = b.message ?? 'Saved';
			await invalidateAll();
		} catch {
			bad = true;
			msg = 'No connection. Nothing saved.';
		} finally {
			busy = '';
		}
	}
	const todo = $derived(data.ok ? data.counts.receive + data.counts.append + data.counts.write : 0);
</script>

<svelte:head><title>Sheet check · DRC</title></svelte:head>

<div class="app">
	<header class="topbar mobile-only">
		<a class="back" href="/" aria-label="Back to Home">‹</a>
		<h1>Sheet check</h1>
	</header>

	<main class="content stack">
		<div class="head">
			<h1 class="desk-only">Sheet check</h1>
			<span class="small muted">The <b>Return Orders</b> tab of Dropy Return Orders and DRC, kept in step both ways.
				{#if data.last?.at}Last {data.last.applied ? 'sync' : 'check'} {agoText(data.last.at, data.now)}{#if data.last.ok === false} · <b class="bad">failed: {data.last.error}</b>{/if}.{/if}</span>
		</div>

		<div class="card autobar" class:on={data.auto}>
			<div>
				<b>Auto sync {data.auto ? 'on' : 'off'}</b>
				<span class="small muted">{data.auto ? 'Every 15 minutes DRC does the changes listed under "DRC will do".' : 'DRC only checks. Look through the lists below, then Sync now or turn Auto sync on.'}</span>
			</div>
			<div class="btns">
				<button class="go accb" disabled={!!busy || !data.ok || todo === 0} onclick={() => post({ op: 'sync' }, 'sync')}>{busy === 'sync' ? 'Syncing…' : `Sync now${todo ? ` (${todo})` : ''}`}</button>
				<button class="go" disabled={!!busy} onclick={() => post({ op: 'auto', on: !data.auto }, 'auto')}>{data.auto ? 'Turn auto off' : 'Turn auto on'}</button>
			</div>
		</div>
		{#if msg}<p class="note" class:bad role="status">{msg}</p>{/if}

		{#if !data.ok}
			<div class="card"><b class="bad">Could not read the sheet</b><p class="small muted">{data.error}</p></div>
		{:else}
			{@const p = data.plan}
			<div class="tiles">
				<div class="tile" class:hot={p.decide.length > 0}><span>Your decision</span><b>{p.decide.length}</b></div>
				<div class="tile"><span>DRC will do</span><b>{todo}</b></div>
				<div class="tile"><span>Only in the sheet</span><b>{p.onlySheet.length}</b></div>
				<div class="tile"><span>Same in both</span><b>{p.same.length}</b></div>
			</div>

			{#if p.decide.length}
				<section class="card">
					<h2>Your decision <span class="muted">{p.decide.length}</span></h2>
					<p class="small muted">The sheet and DRC say different things. <b>Use DRC</b> writes DRC's status into the sheet. <b>Keep both</b> leaves both as they are (it comes back only if one changes). If the sheet is right, open the parcel and change it in DRC.</p>
					{#each p.decide as d (d.order)}
						<div class="row">
							<div class="what">
								<b>#{d.order}</b> <span class="small muted">row {d.row} · {d.why}</span>
								<div class="vs"><span class="small">Sheet: <b>"{d.words || '—'}"</b>{#if d.status} · Status "{d.status}"{/if}{#if d.items && /claim/i.test(d.items)} · Items "{d.items.slice(0, 60)}"{/if} <span class="muted">(reads as {stageLabel(d.sheetStage)})</span></span><span class="small">DRC: <span class="pill p-{tone(d.drcStage)}">{stageLabel(d.drcStage)}</span></span></div>
							</div>
							<div class="btns">
								{#if !['in_flight', 'delayed', 'lost', 'awaiting_receipt'].includes(d.drcStage)}<button class="go sm accb" disabled={!!busy} onclick={() => post({ op: 'use_drc', order: d.order }, d.order)}>Use DRC</button>{/if}
								<button class="go sm" disabled={!!busy} onclick={() => post({ op: 'ignore', order: d.order }, d.order)}>Keep both</button>
								<a class="go sm" href={rtoHref(d.rtoId, here)}>Open</a>
							</div>
						</div>
					{/each}
				</section>
			{/if}

			<section class="card">
				<h2>DRC will do <span class="muted">{todo}</span></h2>
				{#if !todo}<p class="small muted">Nothing to change: the sheet and DRC are in step.</p>{/if}
				{#if p.receive.length}
					<h3>Mark received in DRC <span class="muted">{p.receive.length}</span></h3>
					<p class="small muted">In the sheet, but DRC still shows them as not received. The sheet's words go on the parcel's notes.</p>
					{#each p.receive as x (x.order)}
						<div class="row"><div class="what"><a href={rtoHref(x.rtoId, here)}><b>#{x.order}</b></a> <span class="small">Sheet: "{x.words || '—'}"{x.date ? ` · ${x.date}` : ''}</span></div><span class="pill p-acc">{ACT[x.act.action]}</span></div>
					{/each}
				{/if}
				{#if p.append.length}
					<h3>Add to the sheet <span class="muted">{p.append.length}</span></h3>
					<p class="small muted">Received or claimed in DRC, not in the sheet. A new row goes at the bottom (Status column: "DRC").</p>
					{#snippet arow(x: (typeof p.append)[number])}
						<div class="row"><div class="what"><a href={rtoHref(x.rtoId, here)}><b>#{x.order}</b></a> <span class="small muted">{x.day}{x.items ? ` · ${x.items}` : ''}</span></div><span class="pill p-{tone(x.stage)}">{stageLabel(x.stage)}</span></div>
					{/snippet}
					{#each p.append.slice(0, 8) as x (x.order)}{@render arow(x)}{/each}
					{#if p.append.length > 8}
						<details class="more"><summary class="small">Show all {p.append.length}</summary>{#each p.append.slice(8) as x (x.order)}{@render arow(x)}{/each}</details>
					{/if}
				{/if}
				{#if p.write.length}
					<h3>Update the sheet <span class="muted">{p.write.length}</span></h3>
					<p class="small muted">Changed in DRC since the last sync; nobody changed the sheet row. Only the "RTO - Status" cell is rewritten.</p>
					{#each p.write as x (x.order)}
						<div class="row"><div class="what"><a href={rtoHref(x.rtoId, here)}><b>#{x.order}</b></a> <span class="small muted">row {x.row}</span></div><span class="small">"{x.from || '—'}" → <b>"{x.to}"</b></span></div>
					{/each}
				{/if}
			</section>

			{#if p.onlySheet.length}
				<section class="card">
					<h2>Only in the sheet <span class="muted">{p.onlySheet.length}</span></h2>
					<p class="small muted">DRC has no parcel for these orders (often Shiprocket orders, which DRC can't read yet). <b>Add to DRC</b> creates it as a sheet-only parcel. Better to wait for Shiprocket for recent ones, so they don't appear twice.</p>
					{#each p.onlySheet as x (x.order)}
						<div class="row"><div class="what"><b>#{x.order}</b> <span class="small">"{x.words || '—'}"</span> <span class="small muted">row {x.row}{x.date ? ` · ${x.date}` : ''}</span></div>
							<div class="btns"><span class="pill p-{tone(x.stage)}">{stageLabel(x.stage)}</span><button class="go sm" disabled={!!busy} onclick={() => post({ op: 'add', order: x.order }, x.order)}>Add to DRC</button></div></div>
					{/each}
				</section>
			{/if}

			{#if p.unreadable.length}
				<details class="card">
					<summary><b>Rows DRC can't read</b> <span class="muted">{p.unreadable.length}</span></summary>
					<p class="small muted">Fix the Order ID cell in the sheet (one order per row, like Dropy-4915) and they'll be checked next time.</p>
					{#each p.unreadable as x (x.row)}<div class="row"><span class="small">Row {x.row}: "{x.cell || '—'}"</span><span class="small muted">{x.why}</span></div>{/each}
				</details>
			{/if}
		{/if}
	</main>
</div>
<BottomNav active="home" />

<style>
	.stack { display: flex; flex-direction: column; gap: 12px; }
	.head { display: flex; flex-direction: column; gap: 4px; }
	.head h1 { margin: 0; }
	.autobar { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center; }
	.autobar > div:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 260px; }
	.autobar.on { border-color: var(--acc); }
	.btns { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
	.go { min-height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: inherit; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer; display: inline-grid; place-items: center; text-decoration: none; }
	.go.sm { min-height: 40px; padding: 0 12px; font-size: 13px; }
	.go.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.go:disabled { opacity: 0.5; cursor: default; }
	.note { margin: 0; padding: 10px 12px; border-radius: 12px; background: var(--ok-soft); color: var(--ok); font-weight: 600; font-size: 13.5px; }
	.note.bad { background: #fdecea; color: var(--bad); }
	.bad { color: var(--bad); }
	.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
	.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
	.tile span { font-size: 13px; font-weight: 600; color: var(--muted); }
	.tile b { font-size: 26px; }
	.tile.hot { border: 2px solid var(--bad); }
	h2 { margin: 0 0 4px; font-size: 17px; }
	h3 { margin: 14px 0 2px; font-size: 14.5px; }
	section p, details p { margin: 0 0 6px; }
	.row { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 0; border-top: 1px solid var(--line); }
	.what { min-width: 0; flex: 1 1 220px; }
	.what a { color: inherit; }
	.vs { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 4px; align-items: center; }
	details summary { cursor: pointer; }
	.more summary { padding: 8px 0; color: var(--acc); font-weight: 700; }
	@media (min-width: 1024px) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
</style>
