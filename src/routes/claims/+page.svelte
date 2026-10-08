<script lang="ts">
	import { onMount, tick as tick_ } from 'svelte';
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import ClaimCard from '#lib/components/ClaimCard.svelte';
	import UndoBar from '#lib/components/UndoBar.svelte';
	import TicketDraft from '#lib/components/TicketDraft.svelte';
	import { ticketSub, ticketPill, COURIER_NAME, type TicketGroup } from '#lib/tickets.ts';
	import { inr, num, dateShort } from '#lib/dashboard.ts';
	import { rtoHref, undoFromUrl } from '#lib/scan.ts';
	import type { QueueRow } from '#lib/queue.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const q = $derived(data.queue);
	const all = $derived([...q.toRaise, ...q.raised]);

	let sel = $state<string | null>(null);
	let undo = $state<{ text: string; eventId: number } | null>(null);
	let busy = $state(false);
	let err = $state('');
	let packing = $state<Record<string, string | null>>({});
	let paneEl = $state<HTMLElement>();
	// Phase 4: parcels ticked for one combined courier ticket (one courier at a time)
	let ticked = $state<string[]>([]);
	let view = $state<'claim' | 'ticket'>('claim');
	const tickRows = $derived(data.tickets.flatMap((g) => g.rows).filter((r) => ticked.includes(r.rtoId)));
	const tickValue = $derived(tickRows.reduce((s, r) => s + r.amount, 0));
	const ticketN = $derived(data.tickets.reduce((s, g) => s + g.rows.length, 0));
	const ticketValue = $derived(data.tickets.reduce((s, g) => s + g.value, 0));

	const row = $derived(all.find((r) => r.rtoId === sel) ?? null);
	const claim = $derived(row?.claimId ? data.claims.find((c) => c.id === row.claimId) ?? null : null);
	const info = $derived(row ? data.pane[row.rtoId] : null);
	const media = $derived(row ? data.media.filter((m) => m.rto_id === row.rtoId) : []);

	onMount(() => {
		const u = undoFromUrl(page.url);
		if (u) undo = u;
		sel = page.url.searchParams.get('sel') ?? (window.matchMedia('(min-width: 1024px)').matches ? q.toRaise[0]?.rtoId ?? null : null);
	});

	// keep ?sel in the address bar (reload keeps the same parcel open); drop ?undo once shown
	$effect(() => {
		if (!sel) return;
		const u = new URL(page.url.href);
		if (u.searchParams.get('sel') === sel && !u.searchParams.has('undo')) return;
		u.searchParams.set('sel', sel);
		u.searchParams.delete('undo');
		u.searchParams.delete('msg');
		replaceState(u, {});
	});

	// packing video link for the pane (DROPPY-Log lookup takes a few seconds)
	$effect(() => {
		const id = sel;
		if (!id || id in packing) return;
		packing[id] = null;
		fetch(`/api/rto/${id}/packing`)
			.then((r) => r.json())
			.then((p) => (packing[id] = p.state === 'found' ? p.url : null))
			.catch(() => {});
	});

	function tick(g: TicketGroup, id: string) {
		const same = tickRows.every((r) => r.courier === g.courier);
		const base = same ? ticked : [];
		ticked = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
		view = 'ticket';
	}
	function tickAll(g: TicketGroup) {
		const ids = g.rows.map((r) => r.rtoId);
		ticked = ids.every((id) => ticked.includes(id)) ? [] : ids;
		view = 'ticket';
	}
	async function showTicket() {
		view = 'ticket';
		await tick_();
		paneEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
	async function ticketRaised(eventId: number, n: number, ref: string) {
		undo = { text: `Ticket ${ref} recorded on ${n} parcel${n > 1 ? 's' : ''}`, eventId };
		ticked = [];
		view = 'claim';
		await invalidateAll();
	}

	async function pick(r: QueueRow) {
		sel = r.rtoId;
		view = 'claim';
		err = '';
		await tick_();
		if (!window.matchMedia('(min-width: 1024px)').matches) paneEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	async function draftMdnd(id: string) {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const r = await fetch(`/api/rto/${id}/mdnd`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
			const b = await r.json().catch(() => ({}));
			if (!r.ok) {
				err = b?.message ?? `Could not save (${r.status})`;
				return;
			}
			undo = { text: `${row?.label ?? 'MDND'} drafted${b.bulk ? ` (bulk update: ${b.bulk} parcels same minute)` : ''}`, eventId: b.event_id };
			await invalidateAll();
		} catch {
			err = 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}

	/** Mark raised → open the next one to raise. */
	async function raised(eventId: number) {
		const label = row?.label ?? 'Claim';
		const order = q.toRaise.map((r) => r.rtoId);
		const i = order.indexOf(sel ?? '');
		const next = order.slice(i + 1).concat(order.slice(0, Math.max(i, 0))).find((id) => id !== sel) ?? null;
		undo = { text: `${label} marked raised`, eventId };
		await invalidateAll();
		if (next) sel = next;
	}
	async function changed(eventId: number, text: string) {
		undo = { text: `${row?.label ?? 'Claim'}: ${text}`, eventId };
		await invalidateAll();
	}
	async function undoDone() {
		undo = null;
		await invalidateAll();
	}
</script>

<svelte:head><title>Disputes to raise · DRC</title></svelte:head>

<div class="app">
	<header class="topbar mobile-only">
		<span class="mark">D</span>
		<h1>Disputes</h1>
	</header>

	<main class="content" class:withbar={tickRows.length > 0}>
		<div class="head">
			<h1 class="desk-only">Disputes to raise</h1>
			<span class="pill {q.totals.n ? 'p-bad' : 'p-ok'}">{q.totals.n ? `${q.totals.n} to raise · ${inr(q.totals.value)}` : 'Nothing to raise'}</span>
			{#if q.toFollow}<span class="pill p-warn">{q.toFollow} to follow up</span>{/if}
			<a class="mlink small" href="/money">Money check →</a>
			{#if ticketN}<span class="pill p-warn">{ticketN} for a ticket · {inr(ticketValue)}</span>{/if}
		</div>
		<p class="lead muted">Every claim ready to paste into Velocity. Raise one, mark it raised, the next one opens.</p>
		{#if undo}<div class="undo">{#key undo.eventId}<UndoBar text={undo.text} eventId={undo.eventId} ondone={undoDone} />{/key}</div>{/if}

		<div class="cols">
			<div class="list">
				<div class="sec">MOST URGENT FIRST</div>
				{#each q.toRaise as r (r.key)}
					<button class="qrow" class:on={sel === r.rtoId} onclick={() => pick(r)}>
						<span class="l1"><b>{r.label}</b><b class="money">{inr(r.amount)}</b></span>
						<span class="l2"><span class="muted">{r.sub}</span><span class="pill p-{r.pill.tone}">{r.pill.label}</span></span>
					</button>
				{:else}
					<p class="small muted empty">Nothing waiting to be raised.</p>
				{/each}
				{#if q.raised.length}
					<div class="sec">RAISED · FOLLOW UP</div>
					{#each q.raised as r (r.key)}
						<button class="qrow" class:on={sel === r.rtoId} onclick={() => pick(r)}>
							<span class="l1"><b>{r.label}</b><b class="money">{inr(r.amount)}</b></span>
							<span class="l2"><span class="muted">{r.sub}</span><span class="pill p-{r.pill.tone}">{r.pill.label}</span></span>
						</button>
					{/each}
				{/if}
				{#each data.tickets as g (g.courier)}
					{@const all = g.rows.every((r) => ticked.includes(r.rtoId))}
					<div class="sec tsec">
						<span>TICKETS TO RAISE · {(COURIER_NAME[g.courier] ?? g.courier).toUpperCase()} · {g.rows.length}</span>
						<button class="link" onclick={() => tickAll(g)}>{all ? 'Clear' : 'Select all'}</button>
					</div>
					<p class="small muted hint">Stuck {data.stuckDays}+ days, marked lost, or not received after the dispute window. The panel dispute can't take these: tick them for one ticket.</p>
					{#each g.rows as t (t.rtoId)}
						{@const pill = ticketPill(t)}
						<label class="qrow trow" class:on={ticked.includes(t.rtoId)}>
							<span class="l1">
								<span class="lb"><input type="checkbox" checked={ticked.includes(t.rtoId)} onchange={() => tick(g, t.rtoId)} /><b>{t.label}</b>{#if t.nonDropy}<span class="pill p-mute">not Dropy</span>{/if}</span>
								<b class="money">{inr(t.amount)}</b>
							</span>
							<span class="l2"><span class="muted">{ticketSub(t)}</span><span class="pill p-{pill.tone}">{pill.label}</span></span>
						</label>
					{/each}
				{/each}

			</div>

			<div class="pane" bind:this={paneEl}>
				{#if view === 'ticket' && tickRows.length}
					<TicketDraft rows={tickRows} stuckDays={data.stuckDays} onraised={ticketRaised} />
				{:else if view === 'ticket'}
					<div class="card idle">Tick parcels under "Tickets to raise". One ticket text covers all of them, ready to paste.</div>
				{:else if row && info}
					<div class="ptop">
						<a class="small open" href={rtoHref(row.rtoId, '/claims')}>Open RTO page →</a>
						<span class="small muted">{info.carrier_name ?? ''} <span class="mono">{info.forward_awb ?? ''}</span>{info.customer_name ? ` · ${info.customer_name}` : ''}</span>
					</div>
					{#if claim}
						{#key claim.id}
							<ClaimCard {claim} orderNo={info.order_no} folderId={info.media_folder_id} {media} packingUrl={packing[row.rtoId] ?? null} onraised={raised}
								rto={info} followHours={data.rules.followHours} onchanged={changed} />
						{/key}
					{:else if row.kind === 'mdnd'}
						<div class="card mdnd">
							<div class="mh"><b>{row.label} · not received</b><span class="pill p-acc">MDND</span></div>
							<p class="small">
								The courier marked it delivered back on <b>{dateShort(info.rto_delivered_at)}</b>, but it was never scanned in.
								Check the warehouse once more, then draft the dispute. DRC writes the remarks (delivered time and place, packing video,
								and a bulk-update note if the courier marked 3+ of our parcels delivered in the same minute).
							</p>
							<dl>
								<dt>Claim value</dt><dd class="money">{inr(num(info.order_value))} (full order)</dd>
								<dt>Window</dt><dd>{row.sub.split(' · ')[1]}</dd>
							</dl>
							<button class="go" disabled={busy} onclick={() => draftMdnd(row.rtoId)}>{busy ? 'Drafting…' : 'Draft MDND dispute'}</button>
							<p class="small muted">Saved as a Draft claim (the parcel moves to Claims). Undo works for 10 minutes.</p>
						</div>
					{/if}
					{#if err}<p class="err" role="alert">{err}</p>{/if}
				{:else}
					<div class="card idle">Pick a parcel on the left. Its dispute type, remarks and evidence open here, ready to paste.</div>
				{/if}
			</div>
		</div>
	</main>
	{#if tickRows.length}
		<div class="tbar mobile-only">
			<span><b>{tickRows.length} ticked</b> · {inr(tickValue)}</span>
			<button onclick={showTicket}>Draft ticket ↓</button>
		</div>
	{/if}
</div>
<BottomNav active="claims" />

<style>
	.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
	.head h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
	.lead { margin: 4px 0 14px; font-size: 14px; }
	.mlink { color: var(--acc); font-weight: 700; margin-left: auto; }
	.undo { margin-bottom: 12px; }
	.cols { display: flex; flex-direction: column; gap: 16px; }
	.list { display: flex; flex-direction: column; gap: 8px; }
	.sec { font-size: 12.5px; font-weight: 700; color: var(--muted); margin: 6px 2px 0; letter-spacing: 0.02em; }
	.qrow { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); text-align: left; cursor: pointer; width: 100%; }
	.qrow.on { border: 2px solid var(--acc); background: var(--acc-soft); padding: 11px 13px; }
	.l1, .l2 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
	.l1 b:first-child { font-size: 16px; font-weight: 800; }
	.l2 .muted { font-size: 13px; }
	.empty { margin: 4px 2px; }
	.tsec { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; }
	.link { border: 0; background: none; color: var(--acc); font-weight: 700; font-size: 13px; cursor: pointer; padding: 4px 2px; }
	.hint { margin: 0 2px 2px; line-height: 1.45; }
	.trow { cursor: pointer; }
	@media (max-width: 1023.98px) { .withbar { padding-bottom: 84px; } }
	.lb { display: inline-flex; align-items: center; gap: 10px; }
	.lb input { width: 20px; height: 20px; accent-color: var(--acc); margin: 0; flex: none; }
	.tbar { position: fixed; left: 12px; right: 12px; bottom: calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 10px); z-index: 11;
		display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 10px 10px 16px; border-radius: 14px;
		background: var(--ink); color: var(--bg); font-size: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.18); }
	.tbar button { height: 42px; padding: 0 16px; border: 0; border-radius: 12px; background: var(--acc); color: #fff; font-weight: 700; font-size: 14px; cursor: pointer; }
	@media (min-width: 560px) { .tbar { left: 50%; right: auto; width: 536px; transform: translateX(-50%); } }
	.ptop { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
	.open { color: var(--acc); font-weight: 700; }
	.mdnd { display: flex; flex-direction: column; gap: 10px; border-color: var(--acc); }
	.mh { display: flex; justify-content: space-between; align-items: center; }
	.mdnd p { margin: 0; line-height: 1.5; }
	dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13.5px; }
	dt { color: var(--muted); }
	dd { margin: 0; font-weight: 600; text-align: right; }
	.go { height: 48px; border: 0; border-radius: 12px; background: var(--acc); color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; }
	.go:disabled { opacity: 0.6; cursor: wait; }
	.idle { color: var(--muted); text-align: center; padding: 40px 20px; border-style: dashed; }
	.err { color: var(--bad); font-weight: 600; margin: 8px 0 0; }
	@media (min-width: 1024px) {
		.content { max-width: 1200px; margin: 0 auto; }
		.cols { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 20px; align-items: start; }
		.pane { position: sticky; top: 76px; }
	}
</style>
