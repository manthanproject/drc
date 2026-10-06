<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { rtoHref } from '#lib/scan.ts';
	import { ACTION_GROUPS, actionGroup, actionWhat, ageText, inr, orderLabel, windowText, type ActionGroup, type ActionItem } from '#lib/dashboard.ts';

	/** PC table of Needs action. `limit` shows the first N with a "Show all" link (Home). */
	let { items, limit = 0, title = 'Needs action today' }: { items: ActionItem[]; limit?: number; title?: string } = $props();

	let group = $state<'all' | ActionGroup>('all');
	let busy = $state<string | null>(null);
	let err = $state('');

	const counts = $derived(Object.fromEntries(ACTION_GROUPS.map((g) => [g.key, items.filter((i) => actionGroup(i) === g.key).length])));
	const shown = $derived(group === 'all' ? items : items.filter((i) => actionGroup(i) === group));
	const visible = $derived(limit ? shown.slice(0, limit) : shown);
	const total = $derived(items.reduce((s, i) => s + i.amount, 0));
	const from = $derived(page.url.pathname + page.url.search);
	const winTone = (i: ActionItem) => (i.daysLeft !== null ? (i.daysLeft <= 2 ? 'p-bad' : 'p-warn') : 'p-mute');

	async function decide(i: ActionItem, action: 'reship_confirm' | 'reship_reject') {
		if (!i.rto || busy) return;
		busy = i.key;
		err = '';
		try {
			const r = await fetch(`/api/rto/${i.rto.id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
			if (!r.ok) err = (await r.json().catch(() => null))?.message ?? `Failed (${r.status})`;
			else await invalidateAll();
		} catch {
			err = 'No connection, try again';
		} finally {
			busy = null;
		}
	}
</script>

<section class="tbl" aria-label={title}>
	<div class="head">
		<b>{title}</b>
		<span class="pill {items.length ? 'p-bad' : 'p-ok'}">{items.length} · {inr(total)}</span>
		<span class="grow"></span>
		<div class="chips" role="tablist">
			<button role="tab" aria-selected={group === 'all'} class:on={group === 'all'} onclick={() => (group = 'all')}>All {items.length}</button>
			{#each ACTION_GROUPS as g (g.key)}
				{#if counts[g.key]}<button role="tab" aria-selected={group === g.key} class:on={group === g.key} onclick={() => (group = g.key)}>{g.label} {counts[g.key]}</button>{/if}
			{/each}
		</div>
	</div>
	{#if err}<p class="err" role="alert">{err}</p>{/if}
	{#if items.length === 0}
		<p class="empty muted">Nothing late. Every parcel the courier delivered back has been scanned.</p>
	{:else}
		<div class="grid hdr" aria-hidden="true"><span></span><span>Order</span><span>What</span><span>Age</span><span class="r">Value</span><span>Window</span><span class="r">Action</span></div>
		{#each visible as i (i.key)}
			{@const win = windowText(i)}
			<div class="grid row">
				<span class="dot" style="background: var(--{i.tone === 'mute' ? 'muted' : i.tone})"></span>
				<span class="ord">{#if i.rto}<a href={rtoHref(i.rto.id, from)}>{orderLabel(i.rto)}</a>{:else}—{/if}{#if i.nonDropy} <span class="pill p-mute">non-Dropy</span>{/if}</span>
				<span class="what"><b>{actionWhat(i)}</b><small title={i.detail}>{i.detail}</small></span>
				<span class="small muted">{ageText(i)}</span>
				<span class="money r">{inr(i.amount)}</span>
				<span>{#if win}<span class="pill {winTone(i)}">{win}</span>{:else}<span class="muted">—</span>{/if}</span>
				<span class="acts">
					{#if i.kind === 'reship_found'}
						<button class="ok" disabled={busy === i.key} onclick={() => decide(i, 'reship_confirm')}>Confirm received</button>
						<button disabled={busy === i.key} onclick={() => decide(i, 'reship_reject')}>No, new stock</button>
					{:else if i.rto}
						<a class="btnlink" href={rtoHref(i.rto.id, from)}>Open</a>
					{/if}
				</span>
			</div>
		{/each}
		{#if limit && shown.length > limit}<a class="more" href="/rtos?f=action">Show all {shown.length} →</a>{/if}
	{/if}
</section>

<style>
	.tbl { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
	.head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px 12px; }
	.head b { font-size: 16px; }
	.grow { flex: 1; }
	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.chips button { font-size: 12.5px; font-weight: 600; padding: 6px 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; }
	.chips button.on { background: var(--acc); border-color: var(--acc); color: var(--acc-ink); }
	.grid { display: grid; grid-template-columns: 10px 130px minmax(0, 1fr) 110px 92px 100px 230px; gap: 12px; align-items: center; padding: 11px 16px; }
	.hdr { padding: 8px 16px; background: var(--sunk); font-size: 11.5px; font-weight: 700; color: var(--muted); }
	.row { border-top: 1px solid var(--line); }
	.row:hover { background: color-mix(in srgb, var(--sunk) 55%, transparent); }
	.dot { width: 8px; height: 8px; border-radius: 50%; }
	.ord { font-weight: 800; min-width: 0; }
	.ord a:hover { color: var(--acc); }
	.what { min-width: 0; display: flex; flex-direction: column; }
	.what b { font-weight: 600; }
	.what small { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r { text-align: right; }
	.acts { display: flex; gap: 8px; justify-content: flex-end; }
	.acts button, .btnlink { height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; }
	.acts .ok { background: var(--ok); border-color: var(--ok); color: #fff; }
	.acts button:disabled { opacity: 0.6; cursor: wait; }
	.more { display: block; text-align: center; padding: 12px; border-top: 1px solid var(--line); font-weight: 700; color: var(--acc); }
	.empty { padding: 4px 16px 16px; margin: 0; }
	.err { color: var(--bad); font-weight: 600; padding: 0 16px; margin: 0 0 8px; }
</style>
