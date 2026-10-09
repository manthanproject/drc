<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import UndoBar from '#lib/components/UndoBar.svelte';
	import RefundForm from '#lib/components/RefundForm.svelte';
	import RefundColumns from '#lib/components/RefundColumns.svelte';
	import { dateShort } from '#lib/dashboard.ts';
	import { rupees } from '#lib/money.ts';
	import { rtoHref } from '#lib/scan.ts';
	import { STATUS, STATUSES, OPEN_STATUSES, VIA, TO, BUILTIN, counts, matches, type Refund, type ColumnsSetting, type RefundStatus } from '#lib/refunds.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Tab = 'open' | RefundStatus | 'all';
	let tab = $state<Tab>('open');
	let q = $state(page.url.searchParams.get('order') ?? '');
	let editing = $state<string | null>(null); // refund id, or 'new'
	let doneFor = $state<string | null>(null);
	let doneAmt = $state('');
	let doneRef = $state('');
	let doneDay = $state(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10));
	let showCols = $state(false);
	let cols = $state<ColumnsSetting>(untrack(() => data.columns));
	let undo = $state<{ text: string; logId: number } | null>(null);
	let busy = $state(false);
	let err = $state('');
	let imp = $state<null | { new: number; already: number; already_orders?: string[]; twice?: string[]; by_status: Record<string, number>; rows: number; skipped: number[]; dry_run?: boolean }>(null);
	let impMsg = $state('');

	const n = $derived(counts(data.refunds));
	const nOpen = $derived(OPEN_STATUSES.reduce((t, s) => t + n[s], 0));
	const list = $derived(
		data.refunds.filter((r) => (tab === 'all' ? true : tab === 'open' ? OPEN_STATUSES.includes(r.status) : r.status === tab) && matches(r, q))
	);
	const show = (k: string) => !cols.hidden.includes(k);
	const myCols = $derived(cols.custom.filter((c) => show(c.key)));
	const TABS: [Tab, string][] = [['open', 'Open'], ...STATUSES.map((s) => [s, STATUS[s].label] as [Tab, string]), ['all', 'All']];
	const tabCount = (t: Tab) => (t === 'all' ? data.refunds.length : t === 'open' ? nOpen : n[t]);
	const extraText = (r: Refund, k: string) => {
		const v = r.extra?.[k];
		if (v == null || v === '') return '';
		const c = cols.custom.find((x) => x.key === k);
		return c?.type === 'date' ? dateShort(`${v}T12:00:00+05:30`) : c?.type === 'number' ? Number(v).toLocaleString('en-IN') : String(v);
	};
	const money = (r: Refund) => (r.amount == null ? '—' : rupees(Number(r.amount)));
	const how = (r: Refund) => [r.via ? VIA[r.via] : '', r.refund_to ? TO[r.refund_to] : ''].filter(Boolean).join(' → ');

	async function post(url: string, body: unknown) {
		const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const b = await r.json().catch(() => ({}));
		if (!r.ok) throw new Error(b?.message ?? `Could not save (${r.status})`);
		return b;
	}

	async function saved(res: { log_id: number; text: string }) {
		editing = null;
		undo = { text: res.text, logId: res.log_id };
		await invalidateAll();
	}

	function openDone(r: Refund) {
		doneFor = doneFor === r.id ? null : r.id;
		editing = null;
		doneAmt = r.amount == null ? '' : String(Number(r.amount));
		doneRef = r.done_ref ?? '';
		err = '';
	}
	async function markDone(r: Refund) {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const b = await post('/api/refunds', { action: 'update', id: r.id, status: 'done', amount: doneAmt, done_ref: doneRef, done_at: doneDay });
			doneFor = null;
			undo = { text: `#${r.order_no} marked done`, logId: b.log_id };
			await invalidateAll();
		} catch (e) {
			err = (e as Error).message || 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}

	async function importSheet(dry: boolean) {
		if (busy) return;
		busy = true;
		impMsg = dry ? 'Reading the sheet…' : 'Importing…';
		try {
			imp = await post('/api/refunds/import', { dry });
			impMsg = '';
			if (!dry) await invalidateAll();
		} catch (e) {
			impMsg = (e as Error).message || 'No connection. Nothing imported.';
		} finally {
			busy = false;
		}
	}

	async function undoDone() {
		undo = null;
		await invalidateAll();
	}
</script>

<svelte:head><title>Refunds · DRC</title></svelte:head>

<div class="app">
	<header class="topbar mobile-only">
		<span class="mark">D</span>
		<h1>Refunds</h1>
		<button class="new" onclick={() => { editing = editing === 'new' ? null : 'new'; doneFor = null; }}>+ New</button>
	</header>

	<main class="content">
		<div class="head">
			<h1 class="desk-only">Refunds</h1>
			{#if n.to_refund}<span class="pill p-acc">{n.to_refund} to refund</span>{/if}
			{#if n.waiting}<span class="pill p-info">{n.waiting} waiting</span>{/if}
			{#if n.needs_check}<span class="pill p-bad">{n.needs_check} need a check</span>{/if}
			{#if n.on_hold}<span class="pill p-warn">{n.on_hold} on hold</span>{/if}
			{#if !nOpen}<span class="pill p-ok">Nothing open</span>{/if}
			<span class="sp"></span>
			<label class="sr" for="rf-find">Find</label>
			<input id="rf-find" class="find" bind:value={q} placeholder="Find order, reason, ref…" />
			<button class="tool" onclick={() => { showCols = !showCols; }}>Columns</button>
			<button class="tool accb desk-only" onclick={() => { editing = editing === 'new' ? null : 'new'; doneFor = null; }}>+ New refund</button>
		</div>
		<p class="lead muted">Every refund decision in one list. Prepaid RTOs sent to Ready Stock appear here by themselves; marking done here also marks the RTO.</p>

		{#if undo}<div class="undo">{#key undo.logId}<UndoBar text={undo.text} eventId={undo.logId} url="/api/refunds" body={{ action: 'undo', log_id: undo.logId }} ondone={undoDone} />{/key}</div>{/if}

		{#if !data.imported}
			<section class="card imp">
				<b>Bring in your "Dropy Refund" sheet (one time)</b>
				<span class="small muted">DRC reads the tab once (it never edits it). Row colours become statuses: green Done · cyan Waiting · yellow On hold · red Needs check · grey No refund.</span>
				{#if imp?.dry_run}
					<p class="small">Found <b>{imp.rows}</b> rows: <b>{imp.new}</b> to add{imp.already ? `, ${imp.already} skipped (already in DRC: ${(imp.already_orders ?? []).map((o) => `#${o}`).join(', ')})` : ''}.
						{#if imp.twice?.length}<br />Listed more than once in the sheet, every row kept: {imp.twice.map((o) => `#${o}`).join(', ')}.{/if}<br />
						{Object.entries(imp.by_status).map(([k, v]) => `${v} ${STATUS[k as RefundStatus]?.label ?? k}`).join(' · ')}{imp.skipped.length ? ` · ${imp.skipped.length} lines without an order skipped` : ''}</p>
					<div class="row"><button class="tool accb" disabled={busy} onclick={() => importSheet(false)}>Import {imp.new} refunds</button><button class="tool" disabled={busy} onclick={() => (imp = null)}>Cancel</button></div>
				{:else}
					<div class="row"><button class="tool" disabled={busy} onclick={() => importSheet(true)}>Preview the import</button></div>
				{/if}
				{#if impMsg}<p class="small err" role="status">{impMsg}</p>{/if}
			</section>
		{/if}

		{#if showCols}
			<section class="card"><RefundColumns columns={cols} onsaved={(c) => { cols = c; showCols = false; }} onclose={() => (showCols = false)} /></section>
		{/if}

		{#if editing === 'new'}
			<section class="card form"><b class="ft">New refund</b><RefundForm columns={cols} order={q.replace(/\D/g, '') && list.length === 0 ? q : ''} onsaved={saved} oncancel={() => (editing = null)} /></section>
		{/if}

		<div class="tabs" role="tablist">
			{#each TABS as [t, label] (t)}
				<button role="tab" aria-selected={tab === t} class:on={tab === t} onclick={() => (tab = t)}>{label} <span>{tabCount(t)}</span></button>
			{/each}
		</div>
		{#if err}<p class="err" role="alert">{err}</p>{/if}

		<!-- PC: table -->
		<div class="card tbl desk-only">
			<table>
				<thead>
					<tr>
						<th>Order</th>
						{#if show('reason')}<th>Reason</th>{/if}
						{#if show('via')}<th>Via</th>{/if}
						{#if show('to')}<th>Refund to</th>{/if}
						{#if show('amount')}<th class="num">Amount</th>{/if}
						<th>Status</th>
						{#if show('added')}<th>Added</th>{/if}
						{#if show('done')}<th>Done on</th>{/if}
						{#each myCols as c (c.key)}<th>{c.label}</th>{/each}
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each list as r (r.id)}
						<tr class:sel={editing === r.id || doneFor === r.id}>
							<td>{#if r.rto_id}<a class="ord" href={rtoHref(r.rto_id, '/refunds')}>#{r.order_no}</a>{:else}<b>#{r.order_no}</b>{/if}</td>
							{#if show('reason')}<td class="reason">{r.reason ?? ''}{#if r.done_ref}<br /><span class="small muted">{r.done_ref}</span>{/if}</td>{/if}
							{#if show('via')}<td>{r.via ? VIA[r.via] : ''}</td>{/if}
							{#if show('to')}<td>{r.refund_to ? TO[r.refund_to] : ''}</td>{/if}
							{#if show('amount')}<td class="num money">{money(r)}</td>{/if}
							<td><span class="pill {STATUS[r.status].pill}">{STATUS[r.status].label}</span></td>
							{#if show('added')}<td class="small muted">{dateShort(r.created_at)}</td>{/if}
							{#if show('done')}<td class="small">{r.done_at ? dateShort(r.done_at) : ''}</td>{/if}
							{#each myCols as c (c.key)}<td>{extraText(r, c.key)}</td>{/each}
							<td class="acts">
								{#if r.status !== 'done' && r.status !== 'no_refund'}<button class="mini ok" onclick={() => openDone(r)}>Mark done</button>{/if}
								<button class="mini" onclick={() => { editing = editing === r.id ? null : r.id; doneFor = null; }}>Edit</button>
							</td>
						</tr>
						{#if doneFor === r.id}
							<tr class="sub"><td colspan="99">
								<div class="done">
									<b>Mark done · #{r.order_no}{how(r) ? ` · ${how(r)}` : ''}</b>
									<label class="fld">Amount refunded (₹)<input bind:value={doneAmt} inputmode="decimal" /></label>
									<label class="fld">Refund ref (UTR / PayU id), optional<input bind:value={doneRef} maxlength="120" /></label>
									<label class="fld">Date<input type="date" bind:value={doneDay} /></label>
									<button class="tool okb" disabled={busy} onclick={() => markDone(r)}>Save as done</button>
									<button class="tool" disabled={busy} onclick={() => (doneFor = null)}>Cancel</button>
								</div>
							</td></tr>
						{/if}
						{#if editing === r.id}
							<tr class="sub"><td colspan="99"><RefundForm refund={r} columns={cols} onsaved={saved} oncancel={() => (editing = null)} /></td></tr>
						{/if}
					{:else}
						<tr><td colspan="99" class="muted empty">{data.refunds.length ? 'Nothing here.' : 'No refunds yet. Add one, or import your sheet above.'}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Phone: cards -->
		<div class="cards mobile-only">
			{#each list as r (r.id)}
				<section class="card rc">
					<div class="rh">
						{#if r.rto_id}<a class="ord" href={rtoHref(r.rto_id, '/refunds')}>#{r.order_no}</a>{:else}<b>#{r.order_no}</b>{/if}
						<span class="pill {STATUS[r.status].pill}">{STATUS[r.status].label}</span>
						<span class="sp"></span>
						{#if show('amount')}<b class="money">{money(r)}</b>{/if}
					</div>
					{#if show('reason') && r.reason}<span>{r.reason}</span>{/if}
					<span class="small muted">{[show('via') || show('to') ? how(r) : '', show('added') ? `added ${dateShort(r.created_at)}` : '', show('done') && r.done_at ? `done ${dateShort(r.done_at)}` : '', r.done_ref ?? ''].filter(Boolean).join(' · ')}</span>
					{#each myCols as c (c.key)}{#if extraText(r, c.key)}<span class="small"><span class="muted">{c.label}:</span> {extraText(r, c.key)}</span>{/if}{/each}
					<div class="rb">
						{#if r.status !== 'done' && r.status !== 'no_refund'}<button class="mini ok" onclick={() => openDone(r)}>Mark done</button>{/if}
						<button class="mini" onclick={() => { editing = editing === r.id ? null : r.id; doneFor = null; }}>Edit</button>
					</div>
					{#if doneFor === r.id}
						<div class="done">
							<label class="fld">Amount refunded (₹)<input bind:value={doneAmt} inputmode="decimal" /></label>
							<label class="fld">Refund ref (UTR / PayU id), optional<input bind:value={doneRef} maxlength="120" /></label>
							<label class="fld">Date<input type="date" bind:value={doneDay} /></label>
							<button class="tool okb" disabled={busy} onclick={() => markDone(r)}>Save as done</button>
						</div>
					{/if}
					{#if editing === r.id}<RefundForm refund={r} columns={cols} onsaved={saved} oncancel={() => (editing = null)} />{/if}
				</section>
			{:else}
				<p class="muted empty">{data.refunds.length ? 'Nothing here.' : 'No refunds yet. Add one, or import your sheet above.'}</p>
			{/each}
		</div>
	</main>
</div>
<BottomNav active="refunds" />

<style>
	.head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
	.head h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
	.sp { flex: 1; }
	.lead { margin: 6px 0 12px; font-size: 14px; }
	.find { height: 42px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); padding: 0 12px; font-size: 14px; min-width: 0; flex: 1 1 180px; max-width: 280px; }
	.tool { min-height: 42px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 14px; cursor: pointer; }
	.tool:disabled { opacity: 0.55; }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.okb { background: var(--ok); border-color: var(--ok); color: #fff; }
	.new { height: 40px; padding: 0 14px; border-radius: 12px; border: 0; background: var(--acc); color: #fff; font-weight: 700; }
	.undo { margin-bottom: 12px; }
	.card { margin-bottom: 12px; }
	.imp { display: flex; flex-direction: column; gap: 8px; border-color: var(--acc); }
	.imp p { margin: 0; }
	.row { display: flex; flex-wrap: wrap; gap: 8px; }
	.form { display: flex; flex-direction: column; gap: 10px; }
	.ft { font-size: 16px; }
	.tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 10px; }
	.tabs button { flex: none; min-height: 38px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-weight: 600; font-size: 13.5px; cursor: pointer; }
	.tabs button.on { border: 2px solid var(--acc); background: var(--acc-soft); font-weight: 700; }
	.tabs span { color: var(--muted); font-weight: 600; margin-left: 2px; }
	.err { color: var(--bad); font-weight: 600; }
	.tbl { padding: 0; overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: 14px; }
	th, td { text-align: left; padding: 10px 12px; border-top: 1px solid var(--line); vertical-align: top; }
	th { border-top: 0; font-size: 12.5px; color: var(--muted); font-weight: 600; white-space: nowrap; }
	th + th, td + td { border-left: 1px solid var(--line); }
	thead th { background: var(--sunk); }
	tr.sub > td { border-left: 0; }
	td.num, th.num { text-align: right; white-space: nowrap; }
	td.reason { min-width: 220px; max-width: 420px; }
	tr.sel > td { background: var(--sunk); }
	tr.sub > td { background: var(--sunk); border-top: 0; padding: 14px 16px; }
	.acts { white-space: nowrap; text-align: right; }
	.ord { color: var(--acc); font-weight: 700; }
	.mini { min-height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 13px; cursor: pointer; margin-left: 4px; }
	.mini.ok { background: var(--ok); border-color: var(--ok); color: #fff; }
	.done { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
	.done b { flex-basis: 100%; }
	.fld { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--muted); }
	.fld input { height: 42px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); padding: 0 10px; font-size: 14px; color: var(--ink); }
	.cards { display: flex; flex-direction: column; gap: 10px; }
	.rc { display: flex; flex-direction: column; gap: 6px; margin: 0; }
	.rh { display: flex; align-items: center; gap: 8px; }
	.rh .ord, .rh b:first-child { font-size: 16px; }
	.rb { display: flex; justify-content: flex-end; gap: 6px; }
	.rc .done .fld { flex: 1 1 140px; }
	.empty { padding: 18px 12px; }
	.sr { position: absolute; left: -9999px; }
	@media (min-width: 1024px) { .content { max-width: 1240px; margin: 0 auto; } }
	@media (max-width: 1023.98px) { .head .sp { display: none; } .find { max-width: none; } }
</style>
