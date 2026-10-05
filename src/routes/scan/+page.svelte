<script lang="ts">
	import { invalidate } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import Scanner from '#lib/components/Scanner.svelte';
	import StatusPicker from '#lib/components/StatusPicker.svelte';
	import UndoBar from '#lib/components/UndoBar.svelte';
	import ItemList from '#lib/components/ItemList.svelte';
	import { addressLines } from '#lib/products.ts';
	import { BUCKETS, bucketOf, DEFAULT_RULES, inr, num, orderLabel, dateShort, trackingUrl, paymentBreakdown } from '#lib/dashboard.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Slim = { id: string; label: string; value: string; carrier: string | null; awb: string | null; customer: string | null; stage: string; tone: string; sheetOnly: boolean; nonDropy: boolean };
	let scanner = $state<ReturnType<typeof Scanner>>();
	let code = $state('');
	let finding = $state(false);
	let findErr = $state('');
	let matches = $state<Slim[] | null>(null);
	let detail = $state<any>(null);
	let packing = $state<{ state: string; url?: string } | null>(null);
	let undo = $state<{ text: string; eventId: number } | null>(null);
	let unknownNote = $state('');
	let savingUnknown = $state(false);
	let flash = $state('');

	const STAFF = new Set(['scanned', 'inspected', 'to_call', 'reship', 'ready_stock', 'store_credit', 'hold', 'claim', 'closed']);

	async function onCode(c: string) {
		code = c;
		matches = null;
		detail = null;
		packing = null;
		findErr = '';
		flash = '';
		finding = true;
		try {
			const r = await fetch(`/api/scan?code=${encodeURIComponent(c)}`);
			if (!r.ok) throw new Error(String(r.status));
			const body = await r.json();
			matches = body.matches;
			if (body.matches.length === 1) await open(body.matches[0].id);
		} catch {
			findErr = 'Could not search. Check the connection and scan again.';
		} finally {
			finding = false;
		}
	}

	async function open(id: string) {
		packing = null;
		const r = await fetch(`/api/rto/${id}/detail`);
		if (!r.ok) {
			findErr = 'Could not open this RTO.';
			return;
		}
		detail = await r.json();
		fetch(`/api/rto/${id}/packing`).then((p) => p.json()).then((p) => (packing = p)).catch(() => (packing = { state: 'error' }));
	}

	function saved(res: { event_id: number; label: string }) {
		undo = { text: `${orderLabel(detail.rto)} saved as ${res.label}`, eventId: res.event_id };
		detail = null;
		matches = null;
		code = '';
		invalidate('drc:today');
		scanner?.focusInput();
	}

	function undoDone(undone: boolean) {
		if (undone) flash = 'Undone. The parcel is back as it was.';
		undo = null;
		invalidate('drc:today');
	}

	async function saveUnknown() {
		savingUnknown = true;
		try {
			const r = await fetch('/api/unknown-parcel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, note: unknownNote }) });
			if (!r.ok) throw new Error();
			const b = await r.json();
			flash = b.existing ? `Already saved as unknown parcel (${code}).` : `Saved as unknown parcel (${code}). Match it to an order later.`;
			matches = null;
			code = '';
			unknownNote = '';
			invalidate('drc:today');
			scanner?.focusInput();
		} catch {
			findErr = 'Could not save the unknown parcel. Try again.';
		} finally {
			savingUnknown = false;
		}
	}

	const r = $derived(detail?.rto);
	const bucket = $derived(r ? BUCKETS[bucketOf(r, Date.now(), DEFAULT_RULES)] : null);
	const already = $derived(r && STAFF.has(r.stage));
	const pay = $derived(r ? paymentBreakdown(r) : { label: '', detail: null });
	const addr = $derived(r ? addressLines(r.ship) : []);
</script>

<div class="app">
	<header class="topbar">
		<a class="back" href="/" aria-label="Back to Home">‹</a>
		<h1>Scan a return</h1>
	</header>

	<main class="content stack">
		<Scanner bind:this={scanner} oncode={onCode} />

		{#if undo}
			{#key undo.eventId}<UndoBar text={undo.text} eventId={undo.eventId} ondone={undoDone} />{/key}
		{/if}
		{#if flash}<div class="flash" role="status">{flash}</div>{/if}
		{#if finding}<p class="muted small">Looking up {code}…</p>{/if}
		{#if findErr}<p class="err" role="alert">{findErr}</p>{/if}

		{#if matches && matches.length > 1 && !detail}
			<div class="sec">{matches.length} RTOs match “{code}”. Which one is in your hand?</div>
			<div class="picklist">
				{#each matches as m (m.id)}
					<button class="pick card" onclick={() => open(m.id)}>
						<span class="pl"><b>{m.label}</b>{#if m.nonDropy}<span class="pill p-mute">non-Dropy</span>{/if}<small>{m.customer ?? '—'} · {m.carrier ?? 'sheet only'} {m.awb ?? ''}</small></span>
						<span class="pr"><b class="money">{m.value}</b><span class="pill p-{m.tone}">{m.stage}</span></span>
					</button>
				{/each}
			</div>
		{/if}

		{#if matches && matches.length === 0}
			<div class="card unknown">
				<b>No RTO matches “{code}”</b>
				<p class="muted small">Check the code, or try the order no. or phone. If it's a real return nobody can match, save it so it isn't lost.</p>
				<label for="unote" class="small">Note (optional)</label>
				<input id="unote" bind:value={unknownNote} placeholder="e.g. Delhivery box, 2 creams inside" maxlength="500" />
				<button class="btn" onclick={saveUnknown} disabled={savingUnknown}>{savingUnknown ? 'Saving…' : 'Save as unknown parcel'}</button>
			</div>
		{/if}

		{#if r}
			<div class="card match">
				<div class="row1"><span class="small muted">Matched {code ? `“${code}”` : ''}</span>{#if bucket}<span class="pill p-{bucket.tone}">{bucket.label}</span>{/if}</div>
				<div class="row2"><span class="ord">{orderLabel(r)}</span><span class="money big">{inr(num(r.order_value))}</span></div>
				{#if already}<div class="warnline">Already processed: {bucket?.label}. Pick again only to change it.</div>{/if}
				<dl>
					<dt>Courier</dt><dd>{r.carrier_name ?? '—'} <span class="mono">{r.forward_awb ?? ''}</span></dd>
					<dt>Payment</dt><dd>{pay.label}{#if pay.detail}<small class="sub">{pay.detail}</small>{/if}</dd>
					<dt>Customer</dt><dd>{r.customer_name ?? '—'}</dd>
					{#if r.rto_delivered_at}<dt>Courier says</dt><dd>RTO delivered {dateShort(r.rto_delivered_at)}</dd>{/if}
				</dl>
				{#if addr.length}<div class="addr"><span class="small muted">Address</span>{#each addr as line}<div>{line}</div>{/each}</div>{/if}
				{#if detail.items.length}{#key r.id}<ItemList items={detail.items} rtoId={r.id} />{/key}{/if}
				<div class="pack">
					{#if !packing}<span class="muted small">Looking for the packing video…</span>
					{:else if packing.state === 'found'}<a href={packing.url} target="_blank" rel="noopener noreferrer">▶ Packing video (DROPPY-Log)</a>
					{:else if packing.state === 'purged'}<span class="muted small">Packing video deleted from Drive (PC archive only)</span>
					{:else if packing.state === 'missing'}<span class="muted small">No packing video found for this AWB</span>
					{:else}<span class="muted small">Packing video lookup failed</span>{/if}
					<a class="small" href="/rto/{r.id}">Open full page</a>
					{#if trackingUrl(r)}<a class="small" href={trackingUrl(r)} target="_blank" rel="noopener noreferrer">Track</a>{/if}
				</div>
			</div>
			{#if r.stage === 'unknown_parcel'}
				<div class="card warnline">Already saved as an unknown parcel{r.scanned_at ? ` on ${dateShort(r.scanned_at)}` : ''}. Matching it to an order comes in a later update.</div>
			{:else}
				<div class="card picker-card">
					<StatusPicker rto={r} scanned={true} title={already ? 'Change status' : 'What happened to this parcel?'} onsaved={saved} />
				</div>
			{/if}
			<button class="linkbtn" onclick={() => { detail = null; matches = null; code = ''; scanner?.focusInput(); }}>Not this parcel? Scan again</button>
		{/if}

		<div class="card">
			<div class="todayhead"><b>Scanned today</b><span class="muted small">{data.today.length}</span></div>
			{#each data.today as t (t.id)}
				<a class="todayrow" href="/rto/{t.id}"><span><b>{t.order}</b> <span class="muted small">{t.carrier ?? ''}</span></span><span class="pill p-{t.tone}">{t.stage}</span></a>
			{:else}
				<p class="muted small">Nothing yet today.</p>
			{/each}
		</div>
	</main>
</div>
<BottomNav active="scan" />

<style>
	.stack { display: flex; flex-direction: column; gap: 12px; }
	.back { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-size: 22px; }
	.sec { margin: 4px 2px 0; }
	.flash { padding: 10px 12px; border-radius: 12px; background: var(--ok-soft); color: var(--ok); font-weight: 600; font-size: 13.5px; }
	.err { color: var(--bad); font-weight: 600; font-size: 13.5px; margin: 0; }
	.picklist { display: flex; flex-direction: column; gap: 8px; }
	.pick { display: flex; justify-content: space-between; gap: 10px; text-align: left; cursor: pointer; width: 100%; }
	.pl { display: flex; flex-direction: column; gap: 2px; }
	.pl b { font-size: 16px; }
	.pl small, .pl .pill { font-size: 12.5px; color: var(--muted); }
	.pr { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
	.unknown { display: flex; flex-direction: column; gap: 8px; }
	.unknown p { margin: 0; }
	.unknown input { height: 46px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); padding: 0 12px; font-size: 15px; }
	.match { border-color: var(--acc); }
	.row1, .row2 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
	.row2 { margin: 6px 0 8px; }
	.ord { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; }
	.big { font-size: 18px; }
	.warnline { padding: 8px 10px; border-radius: 10px; background: var(--warn-soft); color: var(--warn); font-size: 13px; font-weight: 600; margin-bottom: 8px; }
	dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13.5px; }
	dt { color: var(--muted); }
	dd { margin: 0; font-weight: 600; text-align: right; }
	.sub { display: block; font-weight: 500; font-size: 12.5px; color: var(--muted); }
	.addr { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: var(--sunk); font-size: 13px; line-height: 1.45; }
	.addr .small { display: block; }
	.pack { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
	.pack a { color: var(--acc); font-weight: 600; font-size: 13.5px; }
	.linkbtn { background: none; border: 0; color: var(--acc); font-weight: 600; font-size: 13.5px; cursor: pointer; padding: 4px; }
	.todayhead { display: flex; justify-content: space-between; margin-bottom: 4px; }
	.todayrow { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
</style>
