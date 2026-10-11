<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import { inr, num, dateShort, agoText } from '#lib/dashboard.ts';
	import { rtoHref } from '#lib/scan.ts';
	import { groupReturns, RET_TABS, arrivedLate, pickupFailing, retStatusText, type RetTab } from '#lib/returns.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const g = $derived(groupReturns(data.list, data.now));
	const tab = $derived((RET_TABS.find((t) => t.key === page.url.searchParams.get('t'))?.key ?? (g.tabs.arrived.length ? 'arrived' : 'coming')) as RetTab);
	const rows = $derived(g.tabs[tab]);
	const REFUND: Record<string, [string, string]> = {
		to_refund: ['Refund to do', 'p-bad'], waiting: ['Refund waiting', 'p-warn'], needs_check: ['Refund: check', 'p-warn'],
		on_hold: ['Refund on hold', 'p-warn'], done: ['Refunded', 'p-ok'], no_refund: ['No refund', 'p-mute']
	};
	let syncing = $state(false);
	let syncMsg = $state('');
	async function syncNow() {
		syncing = true;
		syncMsg = '';
		try {
			const r = await fetch('/api/sync/returns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
			const b = await r.json().catch(() => ({}));
			syncMsg = b?.ok ? `Synced: ${b.inserted} new, ${b.updated} updated` : `Sync failed: ${b?.error ?? r.status}`;
			await invalidateAll();
		} catch {
			syncMsg = 'No connection. Try again.';
		} finally {
			syncing = false;
		}
	}
	const pick = (t: RetTab) => goto(`?t=${t}`, { replaceState: true });
	const itemLine = (r: (typeof data.list)[number]) => r.items.map((i) => `${i.title}${i.qty > 1 ? ` × ${i.qty}` : ''}`).join(', ') || 'Items not listed';
</script>

<svelte:head><title>Customer returns · DRC</title></svelte:head>

<div class="app">
	<header class="topbar mobile-only">
		<a class="back" href="/" aria-label="Back to Home">‹</a>
		<h1>Customer returns</h1>
	</header>

	<main class="content">
		<div class="head">
			<h1 class="desk-only">Customer returns</h1>
			<span class="small muted">Reverse pickups you create in Velocity. Scan them on the normal Scan screen.
				{#if data.lastSync?.at}Synced {agoText(data.lastSync.at, data.now)}{#if data.lastSync.ok === false} · <b class="bad">last sync failed</b>{/if}.{:else}Not synced yet.{/if}</span>
			<button class="sbtn" onclick={syncNow} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
		</div>
		{#if syncMsg}<p class="small msg" role="status">{syncMsg}</p>{/if}

		<div class="tiles">
			<a class="tile" class:hot={g.late > 0} href="?t=arrived"><span>Arrived, scan it</span><b>{g.tabs.arrived.length}</b><small class:bad={g.late > 0}>{g.late ? `${g.late} waiting 2+ days` : 'at the warehouse'}</small></a>
			<a class="tile" href="?t=coming"><span>Coming back</span><b>{g.tabs.coming.length}</b><small class:bad={g.failing > 0}>{g.failing ? `${g.failing} pickup failing` : 'pickup or in transit'}</small></a>
			<a class="tile" href="?t=hold"><span>On hold</span><b>{g.tabs.hold.length}</b><small>problem found</small></a>
			<a class="tile" href="/refunds"><span>Refunds to do</span><b>{g.refundToDo}</b><small>PayU or bank, in Refunds</small></a>
		</div>

		{#each g.velocityPaid as v (v.id)}
			<a class="warn" href={rtoHref(v.id, '/returns')}><b>Velocity shows refund "{v.vref}" for #{v.order_no}.</b> We refund by PayU or bank only: check Velocity did not pay this customer too.</a>
		{/each}

		<div class="tabs" role="tablist" aria-label="Returns lists">
			{#each RET_TABS as t (t.key)}
				<button role="tab" aria-selected={tab === t.key} class:on={tab === t.key} onclick={() => pick(t.key)}>{t.label} <span>{g.tabs[t.key].length}</span></button>
			{/each}
		</div>

		<div class="card list">
			{#each rows as r (r.id)}
				<a class="row" href={rtoHref(r.id, '/returns')}>
					<span class="o"><b>#{r.order_no}</b><small class="muted">{r.return_id ?? ''}</small></span>
					<span class="what"><span class="it">{itemLine(r)}</span><small class="muted">{r.return_reason ?? 'No reason given'}</small></span>
					<span class="awb small"><span>{r.carrier_name ?? '—'}</span><span class="mono muted">{r.forward_awb}</span></span>
					<span class="st">
						{#if tab === 'arrived'}<span class="pill" class:p-bad={arrivedLate(r, data.now)} class:p-warn={!arrivedLate(r, data.now)}>Arrived {r.rto_delivered_at ? dateShort(r.rto_delivered_at) : ''}</span>
						{:else if tab === 'coming'}<span class="pill" class:p-bad={pickupFailing(r)} class:p-mute={!pickupFailing(r)}>{retStatusText(r.courier_status)}</span>{#if r.last_event_at}<small class="muted">{dateShort(r.last_event_at)}</small>{/if}
						{:else if r.refund}<span class="pill {REFUND[r.refund.status]?.[1] ?? 'p-mute'}">{REFUND[r.refund.status]?.[0] ?? r.refund.status}</span>
						{:else}<span class="pill p-mute">{r.stage === 'closed' ? 'Closed' : r.stage.replace('_', ' ')}</span>{/if}
					</span>
					<b class="money">{inr(num(r.order_value))}</b>
				</a>
			{:else}
				<p class="muted small empty">Nothing here.</p>
			{/each}
		</div>
	</main>
</div>
<BottomNav active="home" />

<style>
	.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; }
	.head h1 { margin: 0; }
	.sbtn { margin-left: auto; min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; cursor: pointer; }
	.msg { margin: 0; }
	.bad { color: var(--bad); }
	.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
	.tile { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border-radius: 22px; background: var(--surface); border: 1px solid #eceef1; box-shadow: var(--shadow); }
	.tile.hot { border: 2px solid var(--acc); }
	.tile span { font-size: 13px; font-weight: 600; color: #4b5059; }
	.tile b { font-size: 28px; }
	.tile small { font-size: 12px; color: var(--muted); }
	.tile small.bad { color: var(--bad); font-weight: 700; }
	.warn { display: block; margin: 0 0 10px; padding: 11px 14px; border-radius: 14px; background: #fff5e0; color: #7a5300; font-size: 13px; }
	.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 12px; }
	.tabs button { min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 13.5px; cursor: pointer; }
	.tabs button.on { background: var(--acc); border-color: var(--acc); color: var(--acc-ink); }
	.tabs button span { opacity: 0.75; margin-left: 4px; }
	.list { padding: 4px 16px; }
	.row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 0; border-top: 1px solid var(--line); align-items: center; }
	.row:first-child { border-top: 0; }
	.o, .what, .awb, .st { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.o small, .what small { font-size: 12px; }
	.it { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.awb { display: none; }
	.st { align-items: flex-start; }
	.money { text-align: right; font-variant-numeric: tabular-nums; }
	.empty { padding: 14px 0; margin: 0; }
	@media (max-width: 1023px) {
		.row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'o money' 'what what' 'st st'; }
		.o { grid-area: o; } .what { grid-area: what; } .st { grid-area: st; } .money { grid-area: money; }
	}
	@media (min-width: 1024px) {
		.tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
		.row { grid-template-columns: 150px minmax(0, 1.6fr) 190px 190px 100px; }
		.awb { display: flex; }
	}
</style>
