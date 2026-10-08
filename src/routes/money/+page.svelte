<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import UndoBar from '#lib/components/UndoBar.svelte';
	import { inr, dateShort, agoText } from '#lib/dashboard.ts';
	import { claimReasonLabel } from '#lib/claims.ts';
	import { rtoHref } from '#lib/scan.ts';
	import { parsePassbook, parseCnDetails, suggestFor, monthLabel, rupees } from '#lib/money.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const PART = 1000;
	let busy = $state(false);
	let upMsg = $state('');
	let upOk = $state(true);
	let err = $state('');
	let undo = $state<{ text: string; eventId: number } | null>(null);
	let pick = $state<Record<string, string>>({});
	let cn = $state<Record<string, string>>({});
	let note = $state<Record<string, string>>({});
	type CnLine = { cn: string; ok: boolean; text: string; orders?: { order: string; amount: number; created: boolean; result: string }[] };
	let cnBusy = $state(false);
	let cnMsg = $state('');
	let cnLines = $state<CnLine[]>([]);

	const rtoById = $derived(new Map(data.rtos.map((r) => [r.id, r])));
	const claimById = $derived(new Map(data.claims.map((c) => [c.id, c])));
	const orderOf = (rtoId: string) => {
		const r = rtoById.get(rtoId);
		return !r ? '?' : /^\d+(-\d+)*$/.test(String(r.order_no ?? '')) ? `#${r.order_no}` : String(r.order_no ?? r.forward_awb ?? '?');
	};
	const OPEN = new Set(['raised', 'waiting', 'escalated', 'approved', 'rejected']);
	const openClaims = $derived(
		data.claims.filter((c) => OPEN.has(c.status)).sort((a, b) => orderOf(a.rto_id).localeCompare(orderOf(b.rto_id), undefined, { numeric: true }))
	);
	const toMatch = $derived(data.lines.filter((l) => !l.credit_id && !l.label));
	const labelled = $derived(data.lines.filter((l) => !l.credit_id && l.label));
	const matched = $derived(data.lines.filter((l) => l.credit_id).slice(0, 15));
	const notPaid = $derived(data.claims.filter((c) => c.status === 'approved' && Number(c.outstanding) > 0));
	const sum = (xs: { amount: number | string }[]) => xs.reduce((t, x) => t + Number(x.amount), 0);
	const LABEL: Record<string, string> = { received_parcel: 'Parcel we got back', not_claim: 'Not a claim' };
	const dayIst = (iso: string) => dateShort(iso);

	async function upload(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || busy) return;
		busy = true;
		upOk = true;
		err = '';
		try {
			upMsg = 'Reading the file…';
			const p = parsePassbook(await file.text());
			if (!p.rows.length) {
				upOk = false;
				upMsg = p.skipped[0]?.why ? `Not imported: ${p.skipped[0].why}` : 'No lines found in this file';
				return;
			}
			const parts = Math.ceil(p.rows.length / PART);
			const total = { new: 0, already: 0, claim: 0, linked: 0 };
			for (let i = 0; i < parts; i++) {
				upMsg = `Sending part ${i + 1} of ${parts}…`;
				const r = await fetch('/api/money/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: p.rows.slice(i * PART, (i + 1) * PART) }) });
				const b = await r.json().catch(() => ({}));
				if (!r.ok) {
					upOk = false;
					upMsg = `${b?.message ?? `Upload failed (${r.status})`}. Parts already sent are saved; upload the same file again to finish.`;
					return;
				}
				total.new += b.new; total.already += b.already; total.claim += b.claim_money_new; total.linked += b.linked_to_typed;
			}
			upMsg = `${p.rows.length.toLocaleString('en-IN')} lines read (${dayIst(p.from!)} – ${dayIst(p.to!)}): ${total.new.toLocaleString('en-IN')} new, ${total.already.toLocaleString('en-IN')} already in DRC` +
				(total.claim ? ` · ${total.claim} claim credit${total.claim > 1 ? 's' : ''} found` : '') +
				(total.linked ? ` · ${total.linked} matched to credits you typed earlier` : '') +
				(p.skipped.length ? ` · ${p.skipped.length} line${p.skipped.length > 1 ? 's' : ''} skipped (line ${p.skipped[0].line}: ${p.skipped[0].why})` : '');
			await invalidateAll();
		} catch {
			upOk = false;
			upMsg = 'No connection. Upload the same file again; nothing is counted twice.';
		} finally {
			busy = false;
		}
	}

	const orderLabel = (o: string | null) => (/^\d+(-\d+)*$/.test(String(o ?? '')) ? `#${o}` : String(o ?? '?'));

	/** Velocity → Credit Note → second icon: one file per note; several files at once is fine. */
	async function uploadCn(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = '';
		if (!files.length || busy || cnBusy) return;
		cnBusy = true;
		cnMsg = '';
		cnLines = [];
		err = '';
		const out: CnLine[] = [];
		let lastEvent: { text: string; eventId: number } | null = null;
		let applied = 0;
		try {
			const texts = await Promise.all(files.map((f) => f.text()));
			const p = parseCnDetails(texts.join('\n'));
			if (!p.notes.length) {
				cnMsg = p.skipped[0]?.why ? `Not read: ${p.skipped[0].why}` : 'No credit note lines in this file';
				return;
			}
			for (const n of p.notes) {
				cnMsg = `Applying ${n.cn}…`;
				const r = await fetch('/api/money/cn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cn: n.cn, rows: n.rows }) });
				const b = await r.json().catch(() => ({}));
				if (!r.ok) {
					out.push({ cn: n.cn, ok: false, text: b?.message ?? `Could not apply (${r.status})` });
					continue;
				}
				applied++;
				const orders = (b.orders ?? []).map((o: { order_no: string | null; amount: number; created: boolean; result: string }) =>
					({ order: orderLabel(o.order_no), amount: Number(o.amount), created: o.created, result: o.result }));
				out.push({ cn: n.cn, ok: true, text: `${rupees(Number(b.amount))} · ${dateShort(b.credit_date + 'T12:00:00+05:30')}`, orders });
				lastEvent = { text: `${n.cn} applied: ${orders.map((o: { order: string }) => o.order).join(', ')} closed`, eventId: b.event_id };
			}
			cnMsg = `${applied} of ${p.notes.length} credit note${p.notes.length > 1 ? 's' : ''} applied` +
				(p.skipped.length ? ` · ${p.skipped.length} line${p.skipped.length > 1 ? 's' : ''} skipped (line ${p.skipped[0].line}: ${p.skipped[0].why})` : '');
			if (applied === 1 && lastEvent) undo = lastEvent;
			if (applied) await invalidateAll();
		} catch {
			cnMsg = 'No connection. Upload the same file(s) again; notes already applied are skipped.';
		} finally {
			cnLines = out;
			cnBusy = false;
		}
	}

	async function link(lineId: string) {
		const claimId = pick[lineId];
		if (!claimId || busy) return;
		busy = true;
		err = '';
		try {
			const r = await fetch(`/api/claim/${claimId}`, { method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'credited', ledger_id: lineId, ticket_ref: cn[lineId] ?? '' }) });
			const b = await r.json().catch(() => ({}));
			if (!r.ok) {
				err = b?.message ?? `Could not save (${r.status})`;
				return;
			}
			const c = claimById.get(claimId);
			undo = { text: `Linked to ${c ? orderOf(c.rto_id) : 'claim'}: claim closed`, eventId: b.event_id };
			await invalidateAll();
		} catch {
			err = 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}

	async function label(lineId: string, value: string | null) {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const r = await fetch('/api/money/label', { method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ledger_id: lineId, label: value, note: note[lineId] ?? '' }) });
			const b = await r.json().catch(() => ({}));
			if (!r.ok) err = b?.message ?? `Could not save (${r.status})`;
			else await invalidateAll();
		} catch {
			err = 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}
	async function undoDone() {
		undo = null;
		await invalidateAll();
	}
</script>

<svelte:head><title>Money check · DRC</title></svelte:head>

<div class="app">
	<header class="topbar mobile-only">
		<a class="back" href="/claims" aria-label="Back to Claims">‹</a>
		<h1>Money check</h1>
	</header>

	<main class="content">
		<div class="head">
			<h1 class="desk-only">Money check</h1>
			<span class="pill {toMatch.length ? 'p-bad' : 'p-ok'}">{toMatch.length ? `${toMatch.length} to match · ${rupees(sum(toMatch))}` : 'All claim money matched'}</span>
			{#if notPaid.length}<span class="pill p-warn">{notPaid.length} approved, not paid · {inr(notPaid.reduce((t, c) => t + Number(c.outstanding), 0))}</span>{/if}
		</div>
		<p class="lead muted">Did each claim get paid? Upload Velocity's passbook; DRC finds the claim money in it and links it to the claim.</p>
		{#if undo}<div class="undo">{#key undo.eventId}<UndoBar text={undo.text} eventId={undo.eventId} ondone={undoDone} />{/key}</div>{/if}
		{#if err}<p class="err" role="alert">{err}</p>{/if}

		<section class="card up">
			<div class="uh">
				<b>Upload the passbook</b>
				<span class="small muted">
					{data.lastImport?.at ? `Last upload ${agoText(data.lastImport.at, data.now)}${data.lastImport.from ? ` · covers ${dayIst(data.lastImport.from)} – ${dayIst(data.lastImport.to ?? '')}` : ''}` : 'Not uploaded yet'}
				</span>
			</div>
			<ol class="small steps">
				<li>Velocity → Payments → <b>Passbook</b>, pick the dates (overlap with the last upload is fine)</li>
				<li>Tap the <b>download</b> icon at the right of the filters</li>
				<li>Choose that file here</li>
			</ol>
			<label class="file" class:busy>
				<input type="file" accept=".csv,text/csv" onchange={upload} disabled={busy} />
				<span>{busy ? 'Working…' : 'Choose passbook file (.csv)'}</span>
			</label>
			{#if upMsg}<p class="small msg" class:bad={!upOk} role="status">{upMsg}</p>{/if}
		</section>

		<section class="card up">
			<div class="uh">
				<b>Upload credit-note details</b>
				<span class="small muted">Tells DRC which orders each credit note pays</span>
			</div>
			<ol class="small steps">
				<li>Upload the passbook first (the note's money must be in DRC)</li>
				<li>Velocity → Payments → <b>Credit Note</b> → tap the <b>second icon</b> on a note to download its details</li>
				<li>Choose the file(s) here; several at once is fine</li>
			</ol>
			<label class="file" class:busy={cnBusy}>
				<input type="file" accept=".csv,text/csv" multiple onchange={uploadCn} disabled={busy || cnBusy} />
				<span>{cnBusy ? 'Working…' : 'Choose credit-note detail file(s) (.csv)'}</span>
			</label>
			{#if cnMsg}<p class="small msg" class:bad={cnLines.some((l) => !l.ok) || !cnLines.length} role="status">{cnMsg}</p>{/if}
			{#if cnLines.length}
				<ul class="cnl">
					{#each cnLines as l (l.cn)}
						<li class:bad={!l.ok}>
							<b>{l.cn}</b> <span class="small">{l.text}</span>
							{#if l.orders}
								<span class="small muted">→ {#each l.orders as o, i (o.order)}{i ? ', ' : ''}{o.order} {rupees(o.amount)}{o.created ? ' (claim created)' : ''}{o.result === 'short_paid_accepted' ? ' short-paid' : ''}{/each}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<div class="sec">CLAIM MONEY TO MATCH</div>
		{#each toMatch as l (l.id)}
			{@const sug = suggestFor(Number(l.amount), data.claims, data.rtos)}
			<section class="card line">
				<div class="lh"><b class="money">{rupees(Number(l.amount))}</b><span class="small muted">{dayIst(l.at)} · {l.notes}</span></div>
				{#if sug.length}
					<div class="sugs">
						{#each sug as s (s.rtoId + s.why)}
							{#if s.kind === 'claim'}
								<button class="chip" class:on={pick[l.id] === s.claimId} onclick={() => (pick[l.id] = s.claimId!)}>{s.order} · {s.why}</button>
							{:else}
								<a class="chip ghost" href={rtoHref(s.rtoId, '/money')}>{s.order} · {s.why}</a>
							{/if}
						{/each}
					</div>
					{#if sug.some((s) => s.kind === 'order') && !sug.some((s) => s.kind === 'claim')}
						<p class="small hint">Same amount as an order with no open claim: often money for a parcel marked lost that came back. Velocity may take it back.</p>
					{/if}
				{:else}
					<p class="small muted hint">No claim has this amount. Download this note's details (Credit Note → second icon) and upload it above; DRC then splits it across its orders.</p>
				{/if}
				<div class="row">
					<label class="sr" for="cl-{l.id}">Claim</label>
					<select id="cl-{l.id}" bind:value={pick[l.id]}>
						<option value={undefined}>Pick the claim it pays…</option>
						{#each openClaims as c (c.id)}
							<option value={c.id}>{orderOf(c.rto_id)} · {claimReasonLabel(c.reason)}{c.channel === 'support_ticket' ? ' (ticket)' : ''} · {inr(Number(c.approved_amount ?? c.expected_amount ?? c.claimed_amount))} · {c.status}</option>
						{/each}
					</select>
					<label class="sr" for="cn-{l.id}">Credit note no.</label>
					<input id="cn-{l.id}" bind:value={cn[l.id]} maxlength="80" placeholder="Credit note no. (optional)" />
					<button class="go accb" disabled={busy || !pick[l.id]} onclick={() => link(l.id)}>Link to claim</button>
				</div>
				<div class="row second">
					<input bind:value={note[l.id]} maxlength="200" placeholder="Note (optional), e.g. which order" aria-label="Note" />
					<button class="go" disabled={busy} onclick={() => label(l.id, 'received_parcel')}>Parcel we got back</button>
					<button class="go" disabled={busy} onclick={() => label(l.id, 'not_claim')}>Not a claim</button>
				</div>
			</section>
		{:else}
			<p class="small muted empty">{data.lines.length ? 'Every claim credit in the passbook is matched or labelled.' : 'Upload a passbook to see claim money here.'}</p>
		{/each}

		{#if notPaid.length}
			<div class="sec">APPROVED, NOT PAID</div>
			<div class="card list">
				{#each notPaid as c (c.id)}
					<a class="lrow" href={rtoHref(c.rto_id, '/money')}>
						<span><b>{orderOf(c.rto_id)}</b> <span class="muted small">{claimReasonLabel(c.reason)}{c.approved_at ? ` · approved ${dateShort(c.approved_at)}` : ''}</span></span>
						<b class="money">{inr(Number(c.outstanding))}</b>
					</a>
				{/each}
			</div>
		{/if}

		{#if labelled.length}
			<div class="sec">CLAIM MONEY WITH NO CLAIM</div>
			<div class="card list">
				{#each labelled as l (l.id)}
					<div class="lrow">
						<span><b class="money">{rupees(Number(l.amount))}</b> <span class="muted small">{dayIst(l.at)} · {LABEL[l.label ?? ''] ?? l.label}{l.label_note ? ` · ${l.label_note}` : ''}</span></span>
						<button class="lnk" disabled={busy} onclick={() => label(l.id, null)}>Undo label</button>
					</div>
				{/each}
			</div>
		{/if}

		{#if matched.length}
			<div class="sec">MATCHED</div>
			<div class="card list">
				{#each matched as l (l.id)}
					{@const allocs = l.credit?.allocs ?? []}
					<div class="lrow">
						<span><b class="money">{rupees(Number(l.amount))}</b> <span class="muted small">{dayIst(l.at)}{l.credit?.external_ref ? ` · ${l.credit.external_ref}` : ''}</span></span>
						<span class="tos">
							{#each allocs as a (a.claim_id)}
								{@const c = claimById.get(a.claim_id)}
								{#if c}<a class="small to" href={rtoHref(c.rto_id, '/money')}>→ {orderOf(c.rto_id)} {claimReasonLabel(c.reason)}{allocs.length > 1 ? ` ${rupees(Number(a.amount))}` : ''}</a>{/if}
							{:else}<span class="small muted">linked</span>{/each}
						</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if data.months.length}
			<div class="sec">CHARGES BY MONTH (VELOCITY)</div>
			<div class="card tbl">
				<table>
					<thead><tr><th>Month</th><th>Shipping</th><th>COD</th><th>RTO</th><th>Weight disc.</th><th>Reversed</th><th>Net freight</th><th>Claim money</th></tr></thead>
					<tbody>
						{#each data.months as m (m.month)}
							<tr>
								<td>{monthLabel(m.month)}</td>
								<td>{inr(m.shipping)}</td>
								<td>{inr(m.cod)}</td>
								<td>{inr(m.rto)} <small class="muted">{m.rtoCount}</small></td>
								<td class:hi={m.weight > 0}>{inr(m.weight)} <small class="muted">{m.weightCount}</small></td>
								<td>−{inr(m.reversed)}</td>
								<td><b>{inr(m.net)}</b></td>
								<td>{m.claimMoney ? inr(m.claimMoney) : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="small muted foot">Small numbers = how many lines. Net freight = shipping + COD + RTO + weight discrepancy − reversed. The current month is partial.</p>
			</div>
		{/if}
	</main>
</div>
<BottomNav active="claims" />

<style>
	.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
	.head h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
	.topbar .back { font-size: 26px; color: inherit; text-decoration: none; padding: 0 6px; }
	.lead { margin: 4px 0 14px; font-size: 14px; }
	.undo { margin-bottom: 12px; }
	.err { color: var(--bad); font-weight: 600; }
	.sec { font-size: 12.5px; font-weight: 700; color: var(--muted); margin: 18px 2px 8px; letter-spacing: 0.02em; }
	.card { box-sizing: border-box; }
	.card :global(*) { box-sizing: border-box; }
	.up { display: flex; flex-direction: column; gap: 8px; }
	.uh { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
	.steps { margin: 0; padding-left: 18px; line-height: 1.6; }
	.file { position: relative; display: flex; align-items: center; justify-content: center; min-height: 48px; border-radius: 12px; border: 2px dashed var(--acc); color: var(--acc); font-weight: 700; cursor: pointer; }
	.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
	.file.busy { opacity: 0.6; cursor: wait; }
	.msg { margin: 0; color: var(--ok, #2f8f5b); font-weight: 600; }
	.msg.bad { color: var(--bad); }
	.line { display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; border-color: var(--acc); }
	.lh { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
	.lh .money { font-size: 18px; }
	.sugs { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 7px 12px; font-size: 13px; font-weight: 600; cursor: pointer; color: inherit; text-decoration: none; }
	.chip.on { border-color: var(--acc); background: var(--acc-soft); }
	.chip.ghost { border-style: dashed; }
	.hint { margin: 0; }
	.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.row select, .row input { height: 42px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 0 10px; font-size: 14px; color: inherit; flex: 1; min-width: 180px; }
	.row select { flex: 2; min-width: 220px; }
	.second input { flex: 1; }
	.go { min-height: 42px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 13.5px; cursor: pointer; color: inherit; }
	.go:disabled { opacity: 0.55; cursor: default; }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.empty { margin: 0 2px; }
	.list { display: flex; flex-direction: column; padding: 4px 14px; }
	.lrow { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); color: inherit; text-decoration: none; }
	.lrow:first-child { border-top: 0; }
	.to { color: var(--acc); font-weight: 600; }
	.tos { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; }
	.cnl { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
	.cnl li.bad { color: var(--bad); }
	.lnk { border: 0; background: none; color: var(--acc); font-weight: 700; cursor: pointer; }
	.tbl { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 640px; }
	th, td { text-align: right; padding: 8px 10px; border-top: 1px solid var(--line); white-space: nowrap; }
	th { color: var(--muted); font-weight: 600; font-size: 12.5px; border-top: 0; }
	th:first-child, td:first-child { text-align: left; }
	td.hi { color: var(--bad); }
	.foot { margin: 8px 0 0; }
	.sr { position: absolute; left: -9999px; }
	@media (min-width: 1024px) { .content { max-width: 1100px; margin: 0 auto; } }
</style>
