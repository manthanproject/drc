<script lang="ts">
	import { inr } from '#lib/dashboard.ts';
	import type { MoneyStatus } from '#lib/money.ts';

	let { s }: { s: MoneyStatus } = $props();
	const pct = $derived(s.asked > 0 ? Math.round((s.recovered / s.asked) * 100) : 0);
	const BAR = ['recovered', 'approved', 'waiting', 'rejected', 'lost'] as const;
	const seg = $derived(BAR.map((k) => s.buckets.find((b) => b.key === k)!).filter((b) => b.amount > 0));
</script>

<section class="card ms" aria-labelledby="ms-h">
	<div class="top">
		<div>
			<div id="ms-h" class="small muted">Claim money recovered</div>
			<div class="big"><b>{inr(s.recovered)}</b> <span class="of">of {inr(s.asked)}</span></div>
		</div>
		<div class="pct" aria-label="{pct} percent recovered">{pct}%</div>
	</div>

	{#if seg.length}
		<div class="bar" aria-hidden="true">
			{#each seg as b (b.key)}<div class="b-{b.key}" style="flex:{b.amount}"></div>{/each}
		</div>
	{/if}

	<ul class="rows">
		{#each s.buckets as b (b.key)}
			{#if b.n || b.key === 'recovered' || b.key === 'waiting'}
				<li>
					<span class="dot b-{b.key}"></span>
					<span class="lbl">
						{#if b.key === 'rejected' || b.key === 'draft'}<a href="/claims">{b.label}</a>{:else}{b.label}{/if}
						<span class="small muted">{b.hint}</span>
					</span>
					<span class="n small muted">{b.n} claim{b.n === 1 ? '' : 's'}</span>
					<b class="amt" class:bad={b.key === 'rejected' && b.amount > 0}>{inr(b.amount)}</b>
				</li>
			{/if}
		{/each}
	</ul>

	{#if s.setAside.amount > 0}
		<p class="aside small">
			<b>{inr(s.setAside.amount)} set aside, not counted as recovered</b>: Velocity paid it for {s.setAside.orders.length ? s.setAside.orders.join(', ') : 'parcels'} we got back, so they may take it back.
		</p>
	{/if}

	<details class="how">
		<summary>How the money works</summary>
		<ol class="small">
			<li><b>Claim raised</b>: a parcel is not received, lost, wrong or damaged → you raise a dispute or ticket with Velocity. DRC counts what it is worth (Velocity pays lost / not-received up to ₹2,500).</li>
			<li><b>Velocity answers</b>: DRC reads the dispute status every 15 min. Rejected → escalate with a ticket. Approved → wait for the credit note.</li>
			<li><b>Money arrives</b>: Velocity adds a credit note to your wallet. Upload the <b>passbook</b> below so DRC sees the money.</li>
			<li><b>Matched to claims</b>: upload the <b>credit-note details</b> → DRC links each rupee to its order and closes the claim. That money is <b>Recovered</b>.</li>
			<li><b>Set aside</b>: if a credit note pays for a parcel we actually got back, DRC keeps it apart, because Velocity may take it back.</li>
		</ol>
	</details>
</section>

<style>
	.ms { display: flex; flex-direction: column; gap: 14px; padding: 20px; }
	.top { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
	.big { font-size: 15px; margin-top: 2px; }
	.big b { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
	.of { color: var(--muted); font-weight: 600; white-space: nowrap; }
	.pct { font-size: 26px; font-weight: 700; color: var(--acc); font-variant-numeric: tabular-nums; }
	.bar { display: flex; gap: 4px; height: 12px; }
	.bar div { border-radius: 99px; min-width: 6px; }
	.b-recovered { background: var(--acc); }
	.b-approved { background: var(--acc-pale); }
	.b-waiting { background: #cfd4db; }
	.b-rejected { background: var(--bad); }
	.b-draft { background: #e7c66a; }
	.b-lost { background: #8a9099; }
	.rows { list-style: none; margin: 0; padding: 0; }
	.rows li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
	.dot { width: 10px; height: 10px; border-radius: 50%; }
	.lbl { display: flex; flex-direction: column; font-weight: 600; min-width: 0; }
	.lbl a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--line); }
	.lbl .small { font-weight: 400; }
	.n { white-space: nowrap; }
	.amt { font-variant-numeric: tabular-nums; text-align: right; min-width: 76px; }
	.amt.bad { color: var(--bad); }
	.aside { margin: 0; padding: 10px 14px; border-radius: 14px; background: #fff5e0; color: #7a5300; }
	.how summary { cursor: pointer; font-weight: 700; color: var(--acc); font-size: 13.5px; }
	.how ol { margin: 10px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; color: #4b5059; }
	@media (max-width: 420px) {
		.rows li { grid-template-columns: 10px minmax(0, 1fr) auto; }
		.n { display: none; }
	}
</style>
