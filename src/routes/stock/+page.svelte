<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import UndoBar from '#lib/components/UndoBar.svelte';
	import { inr, dateShort, agoText } from '#lib/dashboard.ts';
	import { asinOf, amazonUrl, searchUrl } from '#lib/products.ts';
	import { rtoHref } from '#lib/scan.ts';
	import { matchStock, type StockRow } from '#lib/stock.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const s = $derived(data.stock);

	let tab = $state<'in' | 'used' | 'money'>('in');
	let q = $state('');
	let openId = $state<string | null>(null);
	let newOrder = $state('');
	let busy = $state(false);
	let err = $state('');
	let undo = $state<{ text: string; eventId: number } | null>(null);
	let syncing = $state(false);
	let syncMsg = $state('');
	let syncOk = $state(true);

	const inRows = $derived(s.inStock.filter((r) => matchStock(r, q)));
	const usedRows = $derived(s.reused.filter((r) => matchStock(r, q)));
	const moneyRows = $derived(s.money.filter((m) => !q.trim() || m.order.includes(q.trim().replace(/^#?(dropy-)?/i, '')) || (m.customer ?? '').toLowerCase().includes(q.trim().toLowerCase())));
	const owed = $derived(s.money.reduce((t, m) => t + m.amount, 0));

	async function post(body: Record<string, unknown>) {
		busy = true;
		err = '';
		try {
			const r = await fetch('/api/stock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			const b = await r.json().catch(() => ({}));
			if (!r.ok) {
				err = b?.message ?? `Could not save (${r.status})`;
				return null;
			}
			return b;
		} catch {
			err = 'No connection. Nothing saved.';
			return null;
		} finally {
			busy = false;
		}
	}

	async function reuse(row: StockRow) {
		const b = await post({ action: 'reuse', item_id: row.item.id, order_no: newOrder });
		if (!b) return;
		const o = newOrder.trim().replace(/^#?(dropy-)?/i, '');
		undo = { text: `1 × ${short(row.item.title)} re-used${o ? ` in #${o}` : ''} · ${b.left} left`, eventId: b.event_id };
		openId = b.left > 0 ? openId : null;
		newOrder = '';
		await invalidateAll();
	}
	async function moneyDone(rtoId: string, order: string, kind: string) {
		const b = await post({ action: 'money_done', rto_id: rtoId });
		if (!b) return;
		undo = { text: `${order}: ${kind === 'refund' ? 'refund marked done' : 'store credit marked given'}`, eventId: b.event_id };
		await invalidateAll();
	}
	async function syncNow() {
		syncing = true;
		syncMsg = '';
		try {
			const r = await fetch('/api/sync/ready-stock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
			const b = await r.json().catch(() => ({}));
			syncOk = r.ok;
			syncMsg = r.ok ? `Sheet updated: ${b.rows} rows` : (b?.message ?? `Sync failed (${r.status})`);
			if (r.ok) await invalidateAll();
		} catch {
			syncOk = false;
			syncMsg = 'No connection. Try again.';
		} finally {
			syncing = false;
		}
	}
	async function undoDone() {
		undo = null;
		await invalidateAll();
	}
	const short = (t: string) => (t.length > 40 ? t.slice(0, 38) + '…' : t);
</script>

<svelte:head><title>Ready Stock · DRC</title></svelte:head>

<div class="app">
	<header class="topbar mobile-only">
		<span class="mark">D</span>
		<h1>Ready Stock</h1>
	</header>

	<main class="content">
		<div class="head">
			<h1 class="desk-only">Ready Stock</h1>
			<span class="pill p-ok">{s.units} unit{s.units === 1 ? '' : 's'} in stock</span>
			<span class="sync small muted">
				{#if data.sheetSync?.at}Sheet tab synced {agoText(data.sheetSync.at, data.now)}{:else}Sheet tab not synced yet{/if}
				<button class="link" onclick={syncNow} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
			</span>
		</div>
		<p class="lead muted">Returned products you can sell again. Tap <b>Re-used</b> when one goes into a new order.</p>
		{#if syncMsg}<p class="small msg" class:bad={!syncOk}>{syncMsg}</p>{/if}
		{#if undo}<div class="undo">{#key undo.eventId}<UndoBar text={undo.text} eventId={undo.eventId} ondone={undoDone} />{/key}</div>{/if}

		<div class="bar">
			<label class="sr" for="sq">Search Ready Stock</label>
			<input id="sq" bind:value={q} placeholder="Search product, ASIN or order no." autocomplete="off" />
			<div class="tabs" role="tablist">
				<button role="tab" aria-selected={tab === 'in'} class:on={tab === 'in'} onclick={() => (tab = 'in')}>In stock {s.inStock.length}</button>
				<button role="tab" aria-selected={tab === 'used'} class:on={tab === 'used'} onclick={() => (tab = 'used')}>Re-used {s.reused.length}</button>
				<button role="tab" aria-selected={tab === 'money'} class:on={tab === 'money'} onclick={() => (tab = 'money')}>Refund / credit due {s.money.length}</button>
			</div>
		</div>
		{#if err}<p class="err" role="alert">{err}</p>{/if}

		{#if tab === 'in'}
			<div class="card list">
				{#each inRows as r (r.item.id)}
					{@const asin = asinOf(r.item.sku)}
					<div class="rs">
						<div class="main">
							<a class="nm" href={r.item.sku ? searchUrl(r.item.sku) : undefined} target="_blank" rel="noopener noreferrer" title={r.item.title}>{r.item.title}</a>
							<div class="mt">
								{#if asin}<a class="mono asin" href={amazonUrl(asin)} target="_blank" rel="noopener noreferrer">{asin}</a>{:else if r.item.sku}<span class="mono">{r.item.sku}</span>{/if}
								<span>From <a href={rtoHref(r.rtoId, '/stock')}>{r.order}</a>{r.added ? `, added ${dateShort(r.added)}` : ''}</span>
								{#if r.item.is_gift}<span class="pill p-acc">Gift</span>{/if}
							</div>
						</div>
						<div class="side">
							<span class="pill p-ok">{r.left} of {r.item.qty} left</span>
							<button class="go" class:sel={openId === r.item.id} onclick={() => { openId = openId === r.item.id ? null : r.item.id; newOrder = ''; err = ''; }}>Re-used</button>
						</div>
						{#if openId === r.item.id}
							<div class="reuse">
								<label class="small muted" for="no-{r.item.id}">New order no. (optional)</label>
								<input id="no-{r.item.id}" bind:value={newOrder} placeholder="e.g. 5123" inputmode="numeric" maxlength="40" />
								<button class="go accb" disabled={busy} onclick={() => reuse(r)}>{busy ? 'Saving…' : 'Mark 1 re-used'}</button>
							</div>
						{/if}
					</div>
				{:else}
					<p class="small muted empty">{q ? 'Nothing matches.' : 'Nothing in stock yet. Items arrive here when an RTO is saved as Ready Stock.'}</p>
				{/each}
			</div>
			{#if s.noItems && !q}
				<a class="small more" href="/rtos?f=ready_stock">{s.noItems} Ready Stock order{s.noItems > 1 ? 's' : ''} from the old sheet have no item list → All RTOs</a>
			{/if}
		{:else if tab === 'used'}
			<div class="card list">
				{#each usedRows as r (r.item.id)}
					<div class="rs">
						<div class="main">
							<span class="nm" title={r.item.title}>{r.item.title}</span>
							<div class="mt">
								<span>From <a href={rtoHref(r.rtoId, '/stock')}>{r.order}</a></span>
								{#if r.item.reused_orders?.length}<span>in {r.item.reused_orders.map((o) => `#${o}`).join(', ')}</span>{/if}
							</div>
						</div>
						<div class="side"><span class="pill p-mute">{r.item.reused_qty} of {r.item.qty} re-used</span></div>
					</div>
				{:else}
					<p class="small muted empty">{q ? 'Nothing matches.' : 'Nothing re-used yet.'}</p>
				{/each}
			</div>
		{:else}
			<p class="small muted owed">Customers still owed money: <b class="money">{inr(owed)}</b></p>
			<div class="card list">
				{#each moneyRows as m (m.rtoId)}
					<div class="rs">
						<div class="main">
							<a class="nm" href={rtoHref(m.rtoId, '/stock')}>{m.order}</a>
							<div class="mt"><span>{m.customer ?? '—'}</span></div>
						</div>
						<div class="side">
							<span class="pill {m.kind === 'refund' ? 'p-bad' : 'p-warn'}">{m.kind === 'refund' ? 'Refund' : 'Store credit'} {inr(m.amount)}</span>
							<button class="go" disabled={busy} onclick={() => moneyDone(m.rtoId, m.order, m.kind)}>{m.kind === 'refund' ? 'Refunded' : 'Credit given'}</button>
						</div>
					</div>
				{:else}
					<p class="small muted empty">Nobody is owed money.</p>
				{/each}
			</div>
		{/if}
		<p class="small muted foot">The same rows are written to the "DRC Ready Stock" tab in Dropy Return Orders every 15 minutes. Old tabs are never changed.</p>
	</main>
</div>
<BottomNav active="stock" />

<style>
	.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
	.head h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
	.sync { margin-left: auto; display: flex; gap: 8px; align-items: baseline; }
	.link { background: none; border: 0; padding: 0; color: var(--acc); font-weight: 700; cursor: pointer; font-size: 12.5px; }
	.link:disabled { opacity: 0.6; }
	.lead { margin: 4px 0 12px; font-size: 14px; }
	.msg { margin: 0 0 8px; color: var(--ok); font-weight: 600; }
	.msg.bad { color: var(--bad); }
	.undo { margin-bottom: 12px; }
	.bar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
	.bar input, .reuse input { height: 46px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); padding: 0 12px; font-size: 15px; }
	.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
	.tabs button { height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); font-size: 13px; font-weight: 600; cursor: pointer; }
	.tabs button.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
	.list { padding: 4px 14px; }
	.rs { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line); }
	.rs:first-child { border-top: 0; }
	.main { flex: 1; min-width: 0; }
	.nm { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	a.nm { color: var(--acc); text-decoration: underline; text-underline-offset: 2px; }
	.mt { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12.5px; color: var(--muted); margin-top: 2px; }
	.mt a { color: var(--acc); font-weight: 600; }
	.mt .asin { color: var(--ink); text-decoration: underline; text-decoration-color: var(--muted); }
	.side { display: flex; align-items: center; gap: 8px; }
	.go { height: 38px; padding: 0 12px; border-radius: 11px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 13px; cursor: pointer; }
	.go.sel { border: 2px solid var(--acc); }
	.go:disabled { opacity: 0.6; cursor: wait; }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.reuse { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px; border-radius: 12px; background: var(--acc-soft); }
	.reuse label { flex-basis: 100%; }
	.reuse input { flex: 1; min-width: 140px; height: 42px; }
	.empty { margin: 12px 0; }
	.more { display: block; margin: 10px 2px; color: var(--acc); font-weight: 600; }
	.owed { margin: 0 2px 8px; }
	.foot { margin: 14px 2px 0; }
	.err { color: var(--bad); font-weight: 600; margin: 0 0 8px; }
	.sr { position: absolute; left: -9999px; }
	@media (min-width: 1024px) {
		.content { max-width: 960px; margin: 0 auto; }
		.bar { flex-direction: row; align-items: center; }
		.bar input { flex: 1; }
	}
</style>
