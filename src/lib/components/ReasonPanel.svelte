<script lang="ts">
	import { dateShort } from '#lib/dashboard.ts';
	import type { ExactReason } from '#lib/reason.ts';

	/**
	 * "Why it came back" panel at the top of an RTO card: the courier's exact failed-delivery note (live from
	 * tracking) as the headline, date · place, attempts and the courier's own code as chips. Hidden when there is nothing to say.
	 */
	let { exact, code }: { exact: ({ state: string } & Partial<ExactReason>) | null; code: string | null } = $props();
	const when = (s: string | null | undefined) => (s ? dateShort(s.replace(' ', 'T') + '+05:30') : '');
	const found = $derived(exact?.state === 'found' && !!exact.text);
	const loading = $derived(exact === null);
	const show = $derived(found || loading || !!code);
	const fails = $derived(found ? exact?.fails ?? 0 : 0);
</script>

{#if show}
	<section class="why" aria-live="polite">
		<div class="k">Why it came back</div>
		{#key found}
			<div class="t" class:quiet={!found && !code}>{found ? exact?.text : (code ?? 'Checking courier tracking…')}</div>
		{/key}
		<div class="chips">
			{#if found && exact?.at}<span class="chip">{when(exact.at)}{exact.location ? ` · ${exact.location}` : ''}</span>{/if}
			{#if fails > 0}<span class="chip">{fails} failed attempt{fails === 1 ? '' : 's'}</span>{/if}
			{#if found && code}<span class="chip q">Code: {code}</span>{/if}
			{#if loading && code}<span class="chip q">Checking courier tracking…</span>{/if}
		</div>
	</section>
{/if}

<style>
	.why { background: var(--warn-soft); border-radius: 14px; padding: 11px 13px 12px; margin: 0 0 12px; }
	.k { font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--warn); }
	.t { font-size: 16px; font-weight: 700; line-height: 1.35; margin-top: 2px; letter-spacing: -0.005em; text-wrap: pretty; animation: rise 220ms cubic-bezier(0.22, 1, 0.36, 1); }
	.t.quiet { font-weight: 600; color: var(--muted); font-size: 14px; }
	.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
	.chips:empty { display: none; }
	.chip { font-size: 12px; font-weight: 600; background: rgba(255, 255, 255, 0.75); color: var(--ink); border-radius: 999px; padding: 3px 9px; }
	.chip.q { color: var(--muted); font-weight: 500; }
	@keyframes rise { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
	@media (prefers-reduced-motion: reduce) { .t { animation: none; } }
</style>
