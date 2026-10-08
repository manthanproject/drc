<script lang="ts">
	import { inr } from '#lib/dashboard.ts';
	import { dateShort } from '#lib/dashboard.ts';
	import { followState, followText, withdrawText, creditTarget, creditOutcome, followCount, isTicket, type FollowClaim, type TextRto } from '#lib/followups.ts';
	import { FRESHDESK_NEW } from '#lib/tickets.ts';
	import { DEFAULT_RULES } from '#lib/dashboard.ts';

	let {
		claim,
		rto,
		followHours = 48,
		packingUrl = null,
		ondone
	}: { claim: FollowClaim & { id: string }; rto: TextRto; followHours?: number; packingUrl?: string | null; ondone: (eventId: number, text: string) => void } = $props();

	const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
	const st = $derived(followState(claim, rto, { ...DEFAULT_RULES, followHours }, Date.now()));

	let mode = $state<'main' | 'withdraw' | 'credit' | 'approve'>('main');
	let subject = $state('');
	let body = $state('');
	let ref = $state('');
	let note = $state('');
	let amount = $state('');
	let cn = $state('');
	let cnDate = $state(todayIst());
	let busy = $state(false);
	let err = $state('');
	let copied = $state('');

	const text = $derived(st ? (mode === 'withdraw' ? withdrawText(claim, rto) : followText(claim, rto, st.kind, packingUrl)) : null);
	$effect.pre(() => {
		subject = text?.subject ?? '';
		body = text?.body ?? '';
	});
	const target = $derived(creditTarget(claim));
	const outcome = $derived(creditOutcome(claim, Number(String(amount).replace(/[₹,\s]/g, ''))));
	const n = $derived(followCount(claim));

	function open(m: typeof mode) {
		err = '';
		mode = mode === m ? 'main' : m;
		if (m === 'credit' && !amount) amount = String(target || '');
		if (m === 'approve' && !amount) amount = String(target || '');
	}

	async function copy(v: string, what: string) {
		try {
			await navigator.clipboard.writeText(v);
			copied = what;
			setTimeout(() => copied === what && (copied = ''), 2500);
		} catch {
			err = 'Copy blocked by the browser: select the text and copy it by hand.';
		}
	}

	async function act(action: string, args: Record<string, unknown>, done: string) {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const r = await fetch(`/api/claim/${claim.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...args }) });
			const b = await r.json().catch(() => ({}));
			if (!r.ok) {
				err = b?.message ?? `Could not save (${r.status})`;
				return;
			}
			mode = 'main';
			ref = note = cn = '';
			ondone(b.event_id, b.n > 1 ? `${done} (${b.n} parcels on this ticket)` : done);
		} catch {
			err = 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}
</script>

{#if st}
	<div class="fu t-{mode === 'main' ? st.tone : 'acc'}">
		<div class="fh">
			<b>{mode === 'withdraw' ? 'Parcel arrived? Withdraw' : mode === 'credit' ? 'Credit received' : mode === 'approve' ? 'Mark approved' : 'Follow-up'}</b>
			{#if mode === 'main'}<span class="pill p-{st.tone}">{st.label}</span>{/if}
		</div>
		{#if mode === 'main'}
			<p class="small muted meta">
				{n ? `Followed up ${n}×${claim.last_follow_up_at ? `, last ${dateShort(claim.last_follow_up_at)}` : ''}` : 'Not followed up yet'}
				{#if st.due && st.kind !== 'rejected'} · {st.due <= Date.now() ? 'due since' : 'next'} {dateShort(new Date(st.due).toISOString())}{/if}
			</p>
		{/if}

		{#if mode === 'credit'}
			<div class="grid">
				<label>Credit note no.<input bind:value={cn} maxlength="80" placeholder="e.g. VSF/FN/1026/096" /></label>
				<label>Amount (₹)<input bind:value={amount} inputmode="decimal" /></label>
				<label>Date<input type="date" bind:value={cnDate} max={todayIst()} /></label>
			</div>
			<p class="small muted">
				Claim target {inr(target)}.
				{#if outcome === 'full'}Closes as fully credited.{:else if outcome === 'short'}Less than the target: closes as short-paid (Velocity's ₹2,500 cap often does this).{/if}
			</p>
			<button class="go accb wide" disabled={busy || !cn.trim() || !outcome} onclick={() => act('credited', { ticket_ref: cn, amount, credit_date: cnDate }, `Credit ${cn.trim()} saved, claim closed`)}>Save credit</button>
		{:else if mode === 'approve'}
			<label class="one">Approved amount (₹)<input bind:value={amount} inputmode="decimal" /></label>
			<button class="go accb wide" disabled={busy} onclick={() => act('approved', { approved_amount: amount }, 'Marked approved: chase the credit note')}>Mark approved</button>
		{:else if text}
			<p class="small where">
				<b>{text.where}</b>
				{#if text.where.startsWith('New Velocity')} · <a href={FRESHDESK_NEW} target="_blank" rel="noopener noreferrer">Open support ↗</a>{:else if claim.ticket_url && isTicket(claim)} · <a href={claim.ticket_url} target="_blank" rel="noopener noreferrer">Open ticket ↗</a>{/if}
			</p>
			{#if text.subject !== null}
				<div class="row"><input class="subj" bind:value={subject} aria-label="Subject" /><button class="go" onclick={() => copy(subject, 's')}>{copied === 's' ? 'Copied ✓' : 'Copy'}</button></div>
			{/if}
			<textarea rows={mode === 'withdraw' ? 4 : 9} bind:value={body} aria-label="Text to paste"></textarea>
			<div class="row"><button class="go accb" onclick={() => copy(body, 'b')}>{copied === 'b' ? 'Copied ✓' : 'Copy text'}</button><span class="small muted">Editable before copying</span></div>

			{#if mode === 'withdraw'}
				<input bind:value={note} maxlength="300" placeholder="Note (optional), e.g. parcel arrived 7 Oct" aria-label="Note" />
				<button class="go wide" disabled={busy} onclick={() => act('withdraw', { note }, 'Claim withdrawn')}>Withdraw claim in DRC</button>
			{:else if st.kind === 'rejected'}
				<div class="row">
					<input bind:value={ref} maxlength="40" placeholder="New ticket no." aria-label="New ticket number" />
					<button class="go accb" disabled={busy || !ref.trim()} onclick={() => act('escalate', { ticket_ref: ref, description: (subject ? subject + '\n\n' : '') + body }, `Escalated (ticket ${ref.trim()})`)}>✓ Escalated</button>
				</div>
			{:else if st.kind === 'courier_approved'}
				<button class="go okb wide" disabled={busy} onclick={() => open('approve')}>Mark approved in DRC</button>
			{:else}
				<button class="go accb wide" disabled={busy} onclick={() => act('follow_up', {}, `Followed up: next in ${Math.round(followHours / 24)} days`)}>
					✓ Followed up{isTicket(claim) && claim.ticket_ref ? ` (ticket ${claim.ticket_ref})` : ''}
				</button>
			{/if}
		{/if}

		<div class="more">
			{#if mode !== 'main'}<button class="lnk" onclick={() => (mode = 'main')}>← Back</button>{/if}
			{#if mode !== 'withdraw'}<button class="lnk" onclick={() => open('withdraw')}>Parcel arrived? Withdraw</button>{/if}
			{#if mode !== 'approve' && claim.status !== 'approved' && st.kind !== 'courier_approved'}<button class="lnk" onclick={() => open('approve')}>Approved</button>{/if}
			{#if mode !== 'credit'}<button class="lnk" onclick={() => open('credit')}>Credit received</button>{/if}
		</div>
		{#if err}<p class="err" role="alert">{err}</p>{/if}
	</div>
{/if}

<style>
	.fu { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 14px; border: 1px solid var(--line); background: var(--bg); margin: 8px 0 4px; }
	.fu :global(*) { box-sizing: border-box; }
	.t-bad { border-color: var(--bad); }
	.t-warn { border-color: var(--warn, #c98a1b); }
	.t-ok { border-color: var(--ok, #2f8f5b); }
	.t-acc { border-color: var(--acc); }
	.fh { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
	.meta, .where { margin: 0; }
	.where a, .lnk { color: var(--acc); font-weight: 700; }
	.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.go { min-height: 42px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 13.5px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
	.go:disabled { opacity: 0.55; cursor: default; }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.okb { background: var(--ok, #2f8f5b); border-color: var(--ok, #2f8f5b); color: #fff; }
	.wide { width: 100%; min-height: 46px; }
	textarea { width: 100%; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); padding: 10px 12px; font-size: 13px; line-height: 1.5; resize: vertical; color: inherit; }
	input { height: 42px; width: 100%; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); padding: 0 12px; font-size: 14px; color: inherit; }
	.row input { flex: 1; min-width: 140px; width: auto; }
	.subj { font-weight: 600; }
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
	label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
	.more { display: flex; flex-wrap: wrap; gap: 14px; padding-top: 2px; }
	.lnk { border: 0; background: none; padding: 4px 0; font-size: 13px; cursor: pointer; }
	.err { color: var(--bad); font-weight: 600; font-size: 13px; margin: 0; }
</style>
