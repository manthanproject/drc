<script lang="ts">
	import { dateShort } from '#lib/dashboard.ts';
	import type { ExactReason } from '#lib/reason.ts';

	/** RTO reason line: the courier's exact note (live from tracking), the broad code underneath. */
	let { exact, code }: { exact: ({ state: string } & Partial<ExactReason>) | null; code: string | null } = $props();
	const when = (s: string | null | undefined) => (s ? dateShort(s.replace(' ', 'T') + '+05:30') : '');
</script>

{#if exact?.state === 'found' && exact.text}
	<b class="rr">{exact.text}</b>{#if exact.at}<small class="sub">{when(exact.at)}{exact.location ? ` · ${exact.location}` : ''}</small>{/if}
	{#each exact.earlier ?? [] as e (e.text)}<small class="sub">Earlier: {e.text}{e.at ? `, ${when(e.at)}` : ''}</small>{/each}
	{#if code}<small class="sub muted">Courier code: {code}</small>{/if}
{:else if exact === null}
	{code ?? '—'}<small class="sub muted">Checking courier tracking…</small>
{:else}
	{code ?? '—'}
{/if}

<style>
	.rr { font-weight: 700; }
	.sub { display: block; font-weight: 400; }
</style>
