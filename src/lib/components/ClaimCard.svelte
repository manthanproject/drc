<script lang="ts">
	import { claimReasonLabel, claimStatus, velocityDisputeType, velocityOrderUrl, driveFileUrl, driveFolderUrl } from '#lib/claims.ts';
	import { dateShort, inr, num } from '#lib/dashboard.ts';
	import { istTime } from '#lib/scanlog.ts';

	interface ClaimRow { id: string; reason: string; status: string; channel?: string | null; ticket_url?: string | null; ticket_ref: string | null; claimed_amount: number | string; deadline_at: string | null; raised_at: string | null; description: string | null; created_at: string }
	interface MediaRow { id: string; kind: string; drive_file_id: string }
	let {
		claim,
		orderNo,
		folderId,
		media,
		packingUrl = null,
		onraised
	}: { claim: ClaimRow; orderNo: string | null; folderId: string | null; media: MediaRow[]; packingUrl?: string | null; onraised: (eventId: number) => void } = $props();

	let text = $state('');
	let saved = $state('');
	let ref = $state('');
	let busy = $state(false);
	let err = $state('');
	let copied = $state<'' | 'type' | 'text'>('');
	$effect.pre(() => {
		text = claim.description ?? '';
		saved = claim.description ?? '';
	});

	const st = $derived(claimStatus(claim.status));
	const vType = $derived(velocityDisputeType(claim.reason));
	const draft = $derived(claim.status === 'draft');
	const ticket = $derived(claim.channel === 'support_ticket');
	const byKind = (k: string) => media.find((m) => m.kind === k);
	const photos = $derived(['front', 'back', 'label'].map((k) => [k, byKind(k)] as const).filter(([, m]) => !!m));
	const orderName = $derived(/^\d+(-\d+)*$/.test(orderNo ?? '') ? `#Dropy-${orderNo}` : orderNo ?? '');

	async function copy(value: string, what: 'type' | 'text') {
		try {
			await navigator.clipboard.writeText(value);
			copied = what;
			setTimeout(() => copied === what && (copied = ''), 2500);
		} catch {
			err = 'Copy blocked by the browser: select the text and copy it by hand.';
		}
	}

	async function post(body: Record<string, unknown>) {
		busy = true;
		err = '';
		try {
			const r = await fetch(`/api/claim/${claim.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
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

	async function saveText() {
		if (await post({ action: 'save_text', description: text })) saved = text;
	}
	async function raise() {
		const b = await post({ action: 'raise', ticket_ref: ref, description: text });
		if (b?.event_id) onraised(b.event_id);
	}
</script>

{#if ticket}
<div class="card claim">
	<div class="head">
		<b>Courier ticket · {claim.reason === 'mdnd' ? 'Not received' : 'Lost or stuck'}</b>
		<span class="pill p-{st.tone}">{st.label}</span>
	</div>
	<p class="small muted meta">
		{inr(num(claim.claimed_amount))} (full order) ·
		{#if claim.raised_at}Raised {dateShort(claim.raised_at)}{/if}
		{#if claim.ticket_ref} · {#if claim.ticket_url}<a class="tref" href={claim.ticket_url} target="_blank" rel="noopener noreferrer">ticket {claim.ticket_ref} ↗</a>{:else}ticket {claim.ticket_ref}{/if}{/if}
	</p>
	<p class="small tnote">Follow up in the ticket. If the parcel turns up, scan it in as usual.</p>
	{#if claim.description}
		<details>
			<summary class="small">Ticket text</summary>
			<pre class="tt">{claim.description}</pre>
			<button class="go" onclick={() => copy(claim.description ?? '', 'text')}>{copied === 'text' ? 'Copied ✓' : 'Copy text'}</button>
		</details>
	{/if}
	{#if err}<p class="err" role="alert">{err}</p>{/if}
</div>
{:else}
<div class="card claim">
	<div class="head">
		<b>RTO claim · {claimReasonLabel(claim.reason)}</b>
		<span class="pill p-{st.tone}">{st.label}</span>
	</div>
	<p class="small muted meta">
		{inr(num(claim.claimed_amount))} (full order) ·
		{#if claim.raised_at}Raised {dateShort(claim.raised_at)}, {istTime(claim.raised_at)}{claim.ticket_ref ? ` · ref ${claim.ticket_ref}` : ''}
		{:else}Made {dateShort(claim.created_at)}{claim.deadline_at ? ` · window to ${dateShort(claim.deadline_at)}` : ''}{/if}
	</p>

	<details open={draft}>
		<summary class="small">{draft ? 'Raise it in Velocity' : 'Remarks and evidence'}</summary>
		<ol class="steps">
			<li>
				<span class="n">1</span>
				<div class="sb">
					<b>Open the order in Velocity</b>
					<div class="row"><a class="go dark" href={velocityOrderUrl(orderNo)} target="_blank" rel="noopener noreferrer">Open {orderName} ↗</a><span class="small muted">then Order Details → Dispute tab</span></div>
				</div>
			</li>
			<li>
				<span class="n">2</span>
				<div class="sb">
					<b>Choose this dispute type</b>
					{#if vType}
						<div class="row"><span class="vt">{vType}</span><button class="go" onclick={() => copy(vType, 'type')}>{copied === 'type' ? 'Copied ✓' : 'Copy'}</button></div>
					{:else}<span class="small muted">No panel type for this reason: use a support ticket.</span>{/if}
				</div>
			</li>
			<li>
				<span class="n">3</span>
				<div class="sb">
					<label for="rm-{claim.id}"><b>Paste the remarks</b></label>
					{#if !claim.description && !text}<span class="small muted">No draft text (this claim was made before DRC wrote remarks).</span>{/if}
					<textarea id="rm-{claim.id}" rows="8" bind:value={text}></textarea>
					<div class="row">
						<button class="go accb" disabled={!text.trim()} onclick={() => copy(text, 'text')}>{copied === 'text' ? 'Copied ✓' : 'Copy remarks'}</button>
						{#if text !== saved}<button class="go" disabled={busy || !text.trim()} onclick={saveText}>Save edit</button>{:else}<span class="small muted">Editable before copying</span>{/if}
					</div>
				</div>
			</li>
			<li>
				<span class="n">4</span>
				<div class="sb">
					<b>Attach the evidence</b>
					<div class="files">
						{#if folderId}<div><span>Claim folder in Drive<small class="muted">anyone with the link can view</small></span><a href={driveFolderUrl(folderId)} target="_blank" rel="noopener noreferrer">Open folder</a></div>{/if}
						{#if photos.length}<div><span>Front, back, label photos<small class="muted">download to attach</small></span><span class="links">{#each photos as [k, m] (k)}<a href={driveFileUrl(m!.drive_file_id)} target="_blank" rel="noopener noreferrer">{k}</a>{/each}</span></div>{/if}
						{#if byKind('unboxing_video')}<div><span>Unboxing video<small class="muted">link is in the remarks</small></span><a href={driveFileUrl(byKind('unboxing_video')!.drive_file_id)} target="_blank" rel="noopener noreferrer">Open</a></div>{/if}
						{#if packingUrl}<div><span>Packing video<small class="muted">from DROPPY-Log{byKind('packing_shortcut') ? ', shortcut in the folder' : ''}</small></span><a href={packingUrl} target="_blank" rel="noopener noreferrer">Open</a></div>{/if}
						{#if !folderId && !media.length}<span class="small muted">No media recorded in DRC for this claim.</span>{/if}
					</div>
				</div>
			</li>
			{#if draft}
				<li>
					<span class="n">5</span>
					<div class="sb">
						<b>Mark as raised</b>
						<div class="row">
							<label class="sr" for="ref-{claim.id}">Dispute or ticket ref</label>
							<input id="ref-{claim.id}" bind:value={ref} maxlength="80" placeholder="Ticket no. (optional)" />
							<button class="go accb" disabled={busy} onclick={raise}>✓ Mark raised</button>
						</div>
					</div>
				</li>
			{/if}
		</ol>
	</details>
	{#if err}<p class="err" role="alert">{err}</p>{/if}
</div>
{/if}

<style>
	.claim { border-color: var(--bad); }
	/* <details> content does not inherit box-sizing in Chromium (shadow slot), so set it here */
	.claim :global(*) { box-sizing: border-box; }
	.head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
	.meta { margin: 4px 0 6px; }
	summary { cursor: pointer; color: var(--acc); font-weight: 700; padding: 4px 0; }
	.steps { list-style: none; margin: 4px 0 0; padding: 0; }
	.steps li { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
	.n { width: 26px; height: 26px; flex: none; border-radius: 50%; background: var(--ink); color: var(--bg); display: grid; place-items: center; font-size: 12.5px; font-weight: 700; }
	.sb { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
	.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.go { min-height: 42px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 13.5px; cursor: pointer; display: inline-flex; align-items: center; }
	.go:disabled { opacity: 0.55; cursor: default; }
	.dark { background: var(--ink); border-color: var(--ink); color: var(--bg); }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.vt { padding: 9px 12px; border-radius: 12px; background: var(--sunk); font-weight: 700; }
	textarea { width: 100%; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 10px 12px; font-size: 13.5px; line-height: 1.5; resize: vertical; }
	.files { display: flex; flex-direction: column; }
	.files > div { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 0; }
	.files span { display: flex; flex-direction: column; font-weight: 600; font-size: 13.5px; }
	.files small { font-weight: 500; font-size: 12px; }
	.files a { color: var(--acc); font-weight: 600; font-size: 13.5px; }
	.files .links { flex-direction: row; gap: 10px; }
	.files .links a { text-transform: capitalize; }
	input { height: 42px; flex: 1; min-width: 140px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 0 12px; font-size: 14px; }
	.sr { position: absolute; left: -9999px; }
	.tref { color: var(--acc); font-weight: 700; }
	.tnote { margin: 0 0 4px; }
	.tt { white-space: pre-wrap; font: inherit; font-size: 13px; line-height: 1.5; background: var(--sunk); border-radius: 12px; padding: 10px 12px; margin: 6px 0 8px; max-height: 320px; overflow: auto; }
	.err { color: var(--bad); font-weight: 600; font-size: 13px; margin: 6px 0 0; }
</style>
