<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import ActionTable from '#lib/components/ActionTable.svelte';
	import { rtoHref } from '#lib/scan.ts';
	import { inr } from '#lib/dashboard.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const d = $derived(data.d);
	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
	// hero: what the "needs action" parcels are, in three groups
	const NOT_REC = new Set(['mdnd', 'no_date']);
	const FOLLOW = new Set(['follow_up', 'rejected', 'courier_approved', 'credit_due']);
	const groups = $derived([
		{ n: d.action.filter((a) => NOT_REC.has(a.kind)).length, label: 'not received' },
		{ n: d.action.filter((a) => FOLLOW.has(a.kind)).length, label: 'follow-ups' },
		{ n: d.action.filter((a) => !NOT_REC.has(a.kind) && !FOLLOW.has(a.kind)).length, label: 'lost / other' }
	]);
	const flow = $derived([d.coming.started, d.coming.moving, d.coming.ofd]);
	const flowMax = $derived(Math.max(1, ...flow));
	const notRecLate = $derived(d.action.filter((a) => NOT_REC.has(a.kind)).length);
	const claimOpen = $derived(Math.max(0, d.claims.n - d.creditDue.n));
	const claimMax = $derived(Math.max(1, claimOpen, d.creditDue.n));
	const pct = (a: number, b: number) => `${Math.round((a / Math.max(1, b)) * 100)}%`;
</script>

<div class="app">
	<header class="topbar mobile-only">
		<h1>Returns</h1>
		<button class="sync" class:bad={!data.sync.ok} onclick={refresh} disabled={refreshing} title="Tap to refresh">
			<span class="dot"></span>{#if refreshing}Refreshing…{:else}Synced {data.sync.text}{/if}
		</button>
	</header>

	<main class="content home">
		<section class="hero card" aria-labelledby="hero-l">
			<div class="hn">
				<span class="big">{d.action.length}</span>
				<span id="hero-l" class="hl">{d.action.length === 0 ? 'Nothing needs action today' : d.action.length === 1 ? 'parcel needs action today' : 'parcels need action today'}</span>
			</div>
			<div class="hbar">
				<div class="segs">
					{#each groups as g, i (g.label)}
						<div class="seg s{i}" style="flex:{d.action.length ? Math.max(g.n, 0.0001) : 1}"></div>
					{/each}
				</div>
				<div class="slabels">
					{#each groups as g (g.label)}<span><b>{g.n}</b> {g.label}</span>{/each}
				</div>
			</div>
			<a class="open" href="/rtos?f=action">{d.action.length ? 'Open list' : 'All RTOs'}</a>
		</section>

		<div class="tiles">
			<a class="tile" href="/rtos?f=awaiting">
				<span class="tl">Arrived, not scanned</span>
				<span class="tn">{d.awaiting.n}</span>
				<span class="ts">{inr(d.awaiting.value)} waiting</span>
				<span class="grow"></span>
				<div class="meter"><div style="width:{pct(notRecLate, d.awaiting.n)}"></div></div>
				<span class="tf">{notRecLate ? `${notRecLate} past the ${data.rules.mdndHours} h claim flag` : `claim flag at ${data.rules.mdndHours} h`}</span>
			</a>
			<a class="tile" href="/rtos?f=claims">
				<span class="tl">Claims</span>
				<span class="tn sm">{d.claims.n} open</span>
				<span class="ts">{inr(d.claims.atStake)} at stake</span>
				<span class="grow"></span>
				<div class="bars two">
					<div style="height:{pct(claimOpen, claimMax)}" class="b1"></div>
					<div style="height:{pct(d.creditDue.n, claimMax)}" class="b2"></div>
				</div>
				<span class="tf two"><span>{claimOpen} waiting</span><span>{d.creditDue.n} approved</span></span>
			</a>
			<a class="tile" href="/rtos?f=coming">
				<span class="tl">Coming back</span>
				<span class="tn">{d.coming.n}</span>
				<span class="ts">{d.delayed.n} delayed</span>
				<span class="grow"></span>
				<div class="bars three">
					{#each flow as v, i (i)}<div style="height:{pct(v, flowMax)}" class="b{i + 1}"></div>{/each}
				</div>
				<span class="tf three"><span>started</span><span>moving</span><span>out</span></span>
			</a>
			<a class="tile" href="/refunds">
				<span class="tl">Refunds {#if data.refunds.toRefund}<i class="reddot" aria-hidden="true"></i>{/if}</span>
				<span class="tn">{data.refunds.open}</span>
				<span class="ts" class:hot={data.refunds.toRefund}>{data.refunds.toRefund ? `${data.refunds.toRefund} to refund now` : 'Nothing to refund now'}</span>
				<span class="grow"></span>
				<div class="chips">
					{#each data.refunds.first as o (o)}<span>#{o}</span>{/each}
					{#if data.refunds.toRefund > data.refunds.first.length}<span>+{data.refunds.toRefund - data.refunds.first.length}</span>{/if}
				</div>
				<span class="tf">{data.refunds.waiting} waiting</span>
			</a>
		</div>

		<div class="desk-only list"><ActionTable items={d.action} limit={15} /></div>

		<aside class="side">
			<div class="pills">
				<a href="/rtos?f=call"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>To call<b>{d.call.n}</b></a>
				<a href="/rtos?f=inspect"><svg viewBox="0 0 24 24" aria-hidden="true" class="blue"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>To inspect<b>{d.inspect.n}</b></a>
				<a href="/rtos?f=delayed"><svg viewBox="0 0 24 24" aria-hidden="true" class="amber"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>Delayed<b>{d.delayed.n}</b></a>
				<a href="/money"><svg viewBox="0 0 24 24" aria-hidden="true" class="green"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18" /></svg>Money<b>{d.creditDue.n}</b></a>
			</div>

			<div class="card desk-only">
				<div class="todayhead"><b>Scanned today</b><span class="muted small">{data.today.length}</span></div>
				{#each data.today.slice(0, 8) as t (t.id)}
					<a class="todayrow" href={rtoHref(t.id, '/')}><span><b>{t.order}</b> <span class="muted small">{t.carrier ?? ''}</span></span><span class="pill p-{t.tone}">{t.stage}</span></a>
				{:else}
					<p class="muted small">Nothing scanned yet today.</p>
				{/each}
				<div class="scanlinks"><a class="openscan" href="/scan">Open Scan →</a><a class="openscan" href="/scan/log">Scan log →</a></div>
			</div>
			{#if d.parked.length}
				<div class="sec">Parked / done</div>
				<div class="parked">
					{#each d.parked as p (p.key)}
						<a href="/rtos?f={p.key}"><b>{p.n}</b> {p.label}</a>
					{/each}
				</div>
			{/if}
			<p class="small muted total">{d.total} RTOs in DRC · <a href="/rtos?f=all">All RTOs</a></p>
		</aside>
	</main>
</div>
<BottomNav active="home" />

<style>
	.topbar { padding-top: 22px; }
	.sync { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 999px; border: 0; background: var(--surface); box-shadow: var(--shadow); font-size: 12.5px; font-weight: 600; color: var(--muted); cursor: pointer; }
	.sync .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
	.sync.bad .dot { background: var(--bad); }
	.home { display: flex; flex-direction: column; gap: 14px; }
	.hero { display: grid; grid-template-columns: auto 1fr; grid-template-areas: 'n open' 'bar bar'; gap: 16px 12px; align-items: center; padding: 20px; }
	.hn { grid-area: n; display: flex; flex-direction: column; }
	.big { font-size: 96px; font-weight: 300; line-height: 0.95; letter-spacing: -0.05em; font-variant-numeric: tabular-nums; }
	.hl { font-size: 14.5px; font-weight: 600; color: #4b5059; margin-top: 4px; }
	.open { grid-area: open; justify-self: end; padding: 14px 20px; border-radius: 999px; background: var(--acc); color: var(--acc-ink); font-weight: 700; }
	.hbar { grid-area: bar; display: flex; flex-direction: column; gap: 8px; }
	.segs { display: flex; gap: 6px; }
	.seg { height: 10px; border-radius: 99px; min-width: 10px; background: #dfe2e7; }
	.seg.s0 { background: var(--acc-grad-a); }
	.seg.s1 { background: var(--acc-grad-b); }
	.slabels { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
	.slabels b { color: var(--ink); }
	.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
	.tile { background: var(--surface); border-radius: 26px; padding: 16px 16px 14px; display: flex; flex-direction: column; gap: 4px; min-height: 190px; box-shadow: var(--shadow); border: 1px solid #eceef1; }
	.tile:active { transform: scale(0.985); }
	.tl { font-size: 13.5px; font-weight: 600; color: #4b5059; display: flex; align-items: center; gap: 6px; }
	.tn { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
	.tn.sm { font-size: 25px; }
	.ts { font-size: 12.5px; color: var(--muted); }
	.ts.hot { color: var(--bad); font-weight: 700; }
	.grow { flex: 1; min-height: 8px; }
	.meter { height: 20px; border-radius: 8px; background: #eceef2; overflow: hidden; }
	.meter div { height: 100%; background: var(--acc-pale); border-radius: 8px; min-width: 4px; }
	.bars { display: grid; gap: 6px; align-items: end; height: 56px; }
	.bars.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.bars.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.bars div { border-radius: 6px; min-height: 6px; background: #d9dce2; }
	.bars .b2 { background: var(--acc-pale); }
	.bars .b3, .bars.two .b2 { background: var(--acc-grad-b); }
	.tf { font-size: 11.5px; color: var(--muted); }
	.tf.two, .tf.three { display: grid; text-align: center; }
	.tf.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.tf.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.reddot { width: 8px; height: 8px; border-radius: 50%; background: var(--bad); display: inline-block; }
	.chips { display: flex; flex-wrap: wrap; gap: 5px; }
	.chips span { padding: 4px 8px; border-radius: 10px; background: var(--sunk); font-size: 11.5px; font-weight: 700; }
	.pills { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
	.pills a { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 0 18px; border-radius: 999px; background: var(--surface); box-shadow: var(--shadow); border: 1px solid #eceef1; font-weight: 700; font-size: 15px; }
	.pills b { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
	.pills svg { width: 21px; height: 21px; flex: none; fill: none; stroke: var(--acc); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.pills svg.blue { stroke: #2f6fc4; }
	.pills svg.amber { stroke: #b07a0c; }
	.pills svg.green { stroke: var(--ok); }
	.side { display: flex; flex-direction: column; gap: 12px; }
	.side .sec { margin: 6px 2px 0; }
	.parked { display: flex; flex-wrap: wrap; gap: 8px; }
	.parked a { font-size: 13px; padding: 8px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); }
	.parked b { font-variant-numeric: tabular-nums; }
	.total { text-align: center; margin-top: 4px; }
	.total a { color: var(--acc); font-weight: 700; }
	.todayhead { display: flex; justify-content: space-between; margin-bottom: 4px; }
	.todayrow { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 0; border-top: 1px solid var(--line); }
	.openscan { display: block; margin-top: 8px; font-size: 13.5px; font-weight: 700; color: var(--acc); }
	.scanlinks { display: flex; justify-content: space-between; }

	/* PC: hero + 4 tiles on top, Needs action table left, shortcuts + Scanned today right */
	@media (min-width: 1024px) {
		.home { display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-areas: 'hero hero' 'tiles tiles' 'list side'; gap: 18px; align-items: start; }
		.hero { grid-area: hero; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'n bar open'; gap: 36px; padding: 26px 32px; border-radius: 32px; }
		.big { font-size: 116px; }
		.tiles { grid-area: tiles; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
		.list { grid-area: list; min-width: 0; }
		.side { grid-area: side; }
		.parked { flex-direction: column; gap: 0; background: var(--surface); border: 1px solid #eceef1; border-radius: 24px; padding: 4px 16px; box-shadow: var(--shadow); }
		.parked a { display: flex; flex-direction: row-reverse; justify-content: space-between; border: 0; border-top: 1px solid var(--line); border-radius: 0; padding: 9px 0; background: none; font-size: 13.5px; }
		.parked a:first-child { border-top: 0; }
	}
</style>
