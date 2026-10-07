<script lang="ts">
	import { invalidateAll, afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { rtoReturnedDraft } from '#lib/messages.ts';
	import { safePath, claimHref, undoFromUrl } from '#lib/scan.ts';
	import ClaimCard from '#lib/components/ClaimCard.svelte';
	import { onMount } from 'svelte';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import StatusPicker from '#lib/components/StatusPicker.svelte';
	import UndoBar from '#lib/components/UndoBar.svelte';
	import ItemList from '#lib/components/ItemList.svelte';
	import { addressLines } from '#lib/products.ts';
	import { BUCKETS, bucketOf, DEFAULT_RULES, inr, num, orderLabel, dateShort, trackingUrl, isSheetOnly, paymentBreakdown, disputeStatus, disputeType } from '#lib/dashboard.ts';
	import { istTime } from '#lib/scanlog.ts';
	import { describe } from '#lib/history.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.rto);
	const bucket = $derived(BUCKETS[bucketOf(r, Date.now(), DEFAULT_RULES)]);
	let undo = $state<{ text: string; eventId: number } | null>(null);

	// Back: to the page you came from (Scan, Home, All RTOs with its filter); from a link or reload, use ?from
	let cameFrom = $state<string | null>(null);
	afterNavigate(({ from }) => {
		if (from?.url && !from.url.pathname.startsWith('/rto/')) cameFrom = from.url.pathname + from.url.search;
	});
	const fromParam = $derived(safePath(page.url.searchParams.get('from')));
	const backHref = $derived(cameFrom ?? fromParam ?? '/rtos');
	const backLabel = $derived(backHref.startsWith('/scan') ? 'Scan' : backHref.startsWith('/claims') ? 'Disputes' : backHref.startsWith('/stock') ? 'Ready Stock' : backHref === '/' ? 'Home' : 'All RTOs');
	const navActive = $derived(backHref.startsWith('/scan') ? 'scan' : backHref.startsWith('/claims') ? 'claims' : backHref.startsWith('/stock') ? 'stock' : backHref === '/' ? 'home' : 'all');

	// WhatsApp: a ready-to-send draft to copy (playbook template E), never opens WhatsApp
	let showDraft = $state(false);
	let draft = $state('');
	let copied = $state<'' | 'msg' | 'phone'>('');
	function openDraft() {
		draft = rtoReturnedDraft(r);
		showDraft = !showDraft;
		copied = '';
	}
	async function copy(text: string, what: 'msg' | 'phone') {
		try {
			await navigator.clipboard.writeText(text);
			copied = what;
		} catch {
			copied = '';
			err = 'Copy blocked by the browser: select the text and copy it by hand.';
		}
	}
	let packing = $state<{ state: string; url?: string } | null>(null);
	let busy = $state(false);
	let err = $state('');

	const MONEY: Record<string, [string, string]> = {
		due: ['Refund due', 'p-bad'], done: ['Refunded', 'p-ok'], credit_due: ['Store credit to give', 'p-warn'], credit_done: ['Store credit given', 'p-ok']
	};
	const pay = $derived(paymentBreakdown(r));
	const disputes = $derived([...(Array.isArray(r.disputes) ? r.disputes : [])].sort((a, b) => String(b.raised_at ?? '').localeCompare(String(a.raised_at ?? ''))));
	const velocityUrl = $derived(`https://dashboard.velocity.in/shipping/orders?order_status=all&search=${encodeURIComponent(r.order_no ?? '')}`);
	const addr = $derived(addressLines(r.ship));
	const phone = $derived(r.customer_phone10 ? `+91${r.customer_phone10}` : null);
	const paid = $derived(r.payment_mode === 'partial' ? num(r.amount_collected) : num(r.order_value));

	const claims = $derived([...data.claims].sort((a, b) => Number(['closed', 'rejected'].includes(a.status)) - Number(['closed', 'rejected'].includes(b.status))));
	const openClaim = $derived(data.claims.some((c) => !['closed', 'rejected'].includes(c.status)));

	onMount(() => {
		// Back from the claim page with ?undo=… → show Undo, then clean the address bar
		const u = undoFromUrl(page.url);
		if (u) {
			undo = u;
			const clean = new URL(page.url.href);
			clean.searchParams.delete('undo');
			clean.searchParams.delete('msg');
			replaceState(clean, {});
		}
		if (r.forward_awb) fetch(`/api/rto/${r.id}/packing`).then((x) => x.json()).then((x) => (packing = x)).catch(() => (packing = { state: 'error' }));
	});

	async function act(action: string) {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const res = await fetch(`/api/rto/${r.id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
			const b = await res.json().catch(() => ({}));
			if (!res.ok) err = b?.message ?? 'Could not save';
			else {
				undo = { text: action === 'call_no_answer' ? `No answer logged${b.to === 'hold' ? ', moved to Hold' : ''}` : 'Saved', eventId: b.event_id };
				await invalidateAll();
			}
		} catch {
			err = 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}

	async function saved(res: { event_id: number; label: string }) {
		undo = { text: `Saved as ${res.label}`, eventId: res.event_id };
		await invalidateAll();
	}
	async function raised(eventId: number) {
		undo = { text: 'Claim marked raised', eventId };
		await invalidateAll();
	}
	async function undoDone() {
		undo = null;
		await invalidateAll();
	}
</script>

<div class="app">
	<header class="topbar">
		<a class="back" href={backHref} aria-label="Back">‹</a>
		<span class="crumb desk-only">{backLabel} ›</span>
		<h1>{orderLabel(r)}</h1>
		<span class="pill p-{bucket.tone}">{bucket.label}</span>
		<span class="money hval desk-only">{inr(num(r.order_value))}</span>
	</header>

	<main class="content stack cols">
		<div class="left">
		<div class="card o-details">
			<div class="dtop">
			<dl>
				<dt>Customer</dt><dd>{r.customer_name ?? '—'}</dd>
				<dt>Payment</dt><dd>{pay.label}{#if pay.detail}<small class="sub">{pay.detail}</small>{/if}</dd>
				{#if MONEY[r.refund_state]}<dt>Money</dt><dd><span class="pill {MONEY[r.refund_state][1]}">{MONEY[r.refund_state][0]} {inr(paid)}</span></dd>{/if}
				<dt>Courier</dt><dd>{#if isSheetOnly(r)}From old sheet, no AWB{:else}{r.carrier_name ?? ''} <span class="mono">{r.forward_awb}</span>{/if}</dd>
				{#if r.rto_delivered_at}<dt>Delivered back</dt><dd>{dateShort(r.rto_delivered_at)}</dd>{/if}
				{#if r.last_event_text}<dt>Last courier event</dt><dd>{r.last_event_text}{r.last_event_at ? `, ${dateShort(r.last_event_at)}` : ''}</dd>{/if}
				{#if r.reship_date}<dt>Re-ship date</dt><dd>{dateShort(r.reship_date + 'T12:00:00Z')}</dd>{/if}
			</dl>
			{#if addr.length}<div class="addr"><span class="small muted">Address</span>{#each addr as line}<div>{line}</div>{/each}</div>{/if}
			</div>
			{#if data.items.length}{#key r.id}<ItemList items={data.items} rtoId={r.id} />{/key}{/if}
			<div class="links">
				{#if packing?.state === 'found'}<a href={packing.url} target="_blank" rel="noopener noreferrer">▶ Packing video</a>
				{:else if packing?.state === 'purged'}<span class="muted small">Packing video deleted (PC archive)</span>
				{:else if packing?.state === 'missing'}<span class="muted small">No packing video</span>
				{:else if packing?.state === 'error'}<span class="muted small">Packing video lookup failed</span>
				{:else if r.forward_awb}<span class="muted small">Looking for packing video…</span>{/if}
				{#if trackingUrl(r)}<a href={trackingUrl(r)} target="_blank" rel="noopener noreferrer">Track</a>{/if}
			</div>
		</div>
		{#if r.notes}<div class="card o-notes"><b>Notes</b><p class="notes">{r.notes}</p></div>{/if}
		<div class="card o-history">
			<b>History</b>
			{#each data.events as e (e.id)}
				{@const d = describe(e)}
				<div class="ev" class:muted={d.muted}><span class="dot"></span><span><span class="et">{d.text}</span><small>{dateShort(e.received_at)} {new Date(e.received_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · {d.who}</small></span></div>
			{:else}
				<p class="small muted">No history yet.</p>
			{/each}
		</div>
		</div>

		<div class="right">
		{#if undo}<div class="o-undo">{#key undo.eventId}<UndoBar text={undo.text} eventId={undo.eventId} ondone={undoDone} />{/key}</div>{/if}
		{#if r.stage === 'awaiting_receipt' && !openClaim && r.courier && r.rto_delivered_at && Date.now() - Date.parse(r.rto_delivered_at) > 48 * 3_600_000}
			<div class="card o-claim mdndhint">
				<b>Not received?</b>
				<p class="small muted">The courier marked it delivered back on {dateShort(r.rto_delivered_at)}. If it is not in the warehouse, draft an MDND dispute.</p>
				<a class="go" href="/claims?sel={r.id}">Draft MDND in Disputes →</a>
			</div>
		{/if}
				{#each claims as c (c.id)}
			<div class="o-claim"><ClaimCard claim={c} orderNo={r.order_no} folderId={r.media_folder_id} media={data.media} packingUrl={packing?.state === 'found' ? packing.url : null} onraised={raised} /></div>
		{/each}
		{#if disputes.length}
			<div class="card o-dispute">
				<div class="dhead"><b>Velocity dispute{disputes.length > 1 ? 's' : ''}</b><a class="small vlink" href={velocityUrl} target="_blank" rel="noopener noreferrer">Open in Velocity ↗</a></div>
				{#each disputes as d (d.id)}
					{@const st = disputeStatus(d.status)}
					<div class="disp">
						<div class="drow"><span>{disputeType(d.dispute_type)}</span><span class="pill p-{st.tone}">{st.label}</span></div>
						{#if d.raised_at}<div class="small muted">Raised {dateShort(d.raised_at)}, {istTime(d.raised_at)}{#if d.images?.length} · {d.images.length} image{d.images.length > 1 ? 's' : ''}{/if}</div>{/if}
						{#if d.reason}<details><summary class="small">Your remark</summary><p class="small reason">{d.reason}</p></details>{/if}
					</div>
				{/each}
				<p class="small muted upd">Status from Velocity, refreshed every 15 min.</p>
			</div>
		{/if}
		{#if r.reship_state === 'pending'}
			<div class="card okcard o-reship">
				<b>Re-shipped as #{r.reship_order_no}?</b>
				<p class="small muted">Velocity shows a re-ship created {dateShort(r.reship_created_at)}, after this parcel came back.</p>
				<div class="two">
					<button class="go okb" disabled={busy} onclick={() => act('reship_confirm')}>Confirm received</button>
					<button class="go" disabled={busy} onclick={() => act('reship_reject')}>No, sent new stock</button>
				</div>
			</div>
		{/if}

		{#if phone && (r.stage === 'to_call' || r.stage === 'hold')}
			<div class="card o-call">
				<div class="callhead"><b>Customer call</b><span class="pill p-warn">Attempt {Math.min(r.callback_attempts + 1, data.maxCalls)} of {data.maxCalls}</span></div>
				<p class="small muted">After {data.maxCalls} unanswered calls it moves to Hold.</p>
				<div class="three">
					<a class="go okb" href="tel:{phone}">Call</a>
					<button class="go" class:sel={showDraft} onclick={openDraft}>WhatsApp</button>
					{#if r.stage === 'to_call'}<button class="go" disabled={busy} onclick={() => act('call_no_answer')}>No answer</button>{/if}
				</div>
				{#if showDraft}
					<div class="draft">
						<div class="drafthead">
							<span class="small muted">Send to</span>
							<b class="mono">{phone}</b>
							<button class="mini" onclick={() => copy(phone ?? '', 'phone')}>{copied === 'phone' ? 'Copied ✓' : 'Copy number'}</button>
						</div>
						<label class="small muted" for="wa-draft">Message (RTO returned, from your CS playbook). Edit if needed:</label>
						<textarea id="wa-draft" rows="13" bind:value={draft}></textarea>
						<button class="go okb full" onclick={() => copy(draft, 'msg')}>{copied === 'msg' ? 'Copied ✓ Paste it in WhatsApp' : 'Copy message'}</button>
					</div>
				{/if}
			</div>
		{/if}

		{#if err}<p class="err o-err" role="alert">{err}</p>{/if}

		{#if r.stage !== 'unknown_parcel'}
			<div class="card o-picker"><StatusPicker rto={r} title={r.stage === 'to_call' ? 'Call outcome / change status' : 'Change status'} claimHref={!openClaim && r.courier && r.forward_awb ? claimHref(r.id, backHref, { ret: 'rto' }) : null} onsaved={saved} /></div>
		{/if}

		</div>
	</main>
</div>
<BottomNav active={navActive} />

<style>
	.stack { display: flex; flex-direction: column; gap: 12px; }
	.crumb { font-size: 13px; color: var(--muted); }
	.dhead { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
	.vlink { color: var(--acc); font-weight: 600; }
	.disp { padding: 10px 0; border-top: 1px solid var(--line); margin-top: 8px; }
	.drow { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 600; font-size: 13.5px; }
	.disp details { margin-top: 4px; }
	.disp summary { cursor: pointer; color: var(--acc); font-weight: 600; }
	.reason { margin: 6px 0 0; white-space: pre-line; color: var(--muted); }
	.upd { margin: 4px 0 0; }
	.hval { margin-left: auto; font-size: 20px; }
	.mdndhint { border-color: var(--acc); }
	.mdndhint p { margin: 4px 0 10px; }

	/* Phone: one column in the original order. PC: details + history left, actions right */
	@media (max-width: 1023.98px) {
		.left, .right { display: contents; }
		.o-undo { order: 1; } .o-details { order: 2; } .o-claim { order: 3; } .o-dispute { order: 3; } .o-reship { order: 3; } .o-call { order: 4; }
		.o-err { order: 5; } .o-picker { order: 6; } .o-notes { order: 7; } .o-history { order: 8; }
	}
	@media (min-width: 1024px) {
		.cols { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 18px; align-items: start; }
		.left, .right { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
		.dtop { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
		.dtop .addr { margin-top: 0; }
		.topbar h1 { flex: none; }
	}
	.back { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-size: 22px; }
	dl { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; font-size: 13.5px; }
	dt { color: var(--muted); }
	dd { margin: 0; font-weight: 600; text-align: right; }
	.sub { display: block; font-weight: 500; font-size: 12.5px; color: var(--muted); }
	.addr { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: var(--sunk); font-size: 13px; line-height: 1.45; }
	.addr .small { display: block; }
	.links { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
	.links a { color: var(--acc); font-weight: 600; font-size: 13.5px; }
	.okcard { background: var(--ok-soft); border-color: transparent; }
	.okcard p { margin: 4px 0 10px; }
	.callhead { display: flex; justify-content: space-between; align-items: center; }
	.callhead + p { margin: 4px 0 10px; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
	.go { min-height: 48px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 14px; cursor: pointer; text-align: center; }
	.okb { background: var(--ok); border-color: var(--ok); color: #fff; }
	.go.sel { border: 2px solid var(--acc); }
	.full { width: 100%; }
	.draft { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
	.drafthead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.mini { height: 34px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); font-weight: 600; font-size: 12.5px; cursor: pointer; }
	.draft textarea { width: 100%; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 10px 12px; font-size: 14px; line-height: 1.45; resize: vertical; }
	.err { color: var(--bad); font-weight: 600; margin: 0; }
	.notes { white-space: pre-line; font-size: 13.5px; margin: 6px 0 0; }
	.ev { display: flex; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); }
	.ev:first-of-type { border-top: 0; }
	.ev.muted { opacity: 0.55; }
	.ev .dot { width: 8px; height: 8px; margin-top: 7px; flex: none; border-radius: 50%; background: var(--acc); }
	.et { display: block; font-size: 13.5px; font-weight: 600; }
	.ev small { font-size: 12px; color: var(--muted); }
</style>
