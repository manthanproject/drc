<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { safePath } from '#lib/scan.ts';
	import type { SyncState } from '#lib/dashboard.ts';

	let { sync }: { sync: SyncState | null } = $props();
	let q = $state('');
	let refreshing = $state(false);

	/** Which tab is lit: an RTO page lights the tab it was opened from. */
	const active = $derived.by(() => {
		let p = page.url.pathname;
		if (p.startsWith('/rto/')) p = safePath(page.url.searchParams.get('from'))?.split('?')[0] ?? '/rtos';
		return p === '/' ? 'home' : p.startsWith('/scan') ? 'scan' : p.startsWith('/claims') ? 'claims' : p.startsWith('/stock') ? 'stock' : 'all';
	});

	function find(e: SubmitEvent) {
		e.preventDefault();
		const v = q.trim();
		if (!v) return;
		q = '';
		goto(`/rtos?f=all&q=${encodeURIComponent(v)}`);
	}
	async function refresh() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
</script>

<header class="tb desk-only">
	<div class="in">
		<a class="brand" href="/"><span class="mark">D</span><b>Returns</b></a>
		<nav aria-label="Main">
			<a href="/" class:on={active === 'home'} aria-current={active === 'home' ? 'page' : undefined}>Home</a>
			<a href="/stock" class:on={active === 'stock'} aria-current={active === 'stock' ? 'page' : undefined}>Ready Stock</a>
			<a href="/claims" class:on={active === 'claims'} aria-current={active === 'claims' ? 'page' : undefined}>Claims</a>
			<a href="/rtos" class:on={active === 'all'} aria-current={active === 'all' ? 'page' : undefined}>All RTOs</a>
		</nav>
		<span class="grow"></span>
		<form class="find" role="search" onsubmit={find}>
			<label for="tb-find" class="sr">Find any RTO</label>
			<span aria-hidden="true">⌕</span>
			<input id="tb-find" bind:value={q} placeholder="Find: AWB, order no., phone, name" autocomplete="off" />
		</form>
		{#if sync}
			<button class="sync" class:bad={!sync.ok} onclick={refresh} disabled={refreshing} title="Refresh">
				{#if refreshing}Refreshing…{:else}Synced <b>{sync.text}</b>{/if}
			</button>
		{/if}
		<a class="scan" class:on={active === 'scan'} href="/scan" aria-current={active === 'scan' ? 'page' : undefined}>⌗ Scan</a>
	</div>
</header>

<style>
	.tb { background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 20; }
	.in { max-width: 1360px; margin: 0 auto; padding: 0 28px; display: flex; align-items: center; gap: 24px; }
	.brand { display: flex; align-items: center; gap: 10px; padding: 10px 0; }
	.brand b { font-size: 17px; }
	nav { display: flex; gap: 22px; }
	nav a { padding: 18px 2px 15px; font-size: 14.5px; color: var(--muted); border-bottom: 2px solid transparent; }
	nav a.on { color: var(--acc); border-color: var(--acc); font-weight: 700; }
	nav a:hover { color: var(--ink); }
	.grow { flex: 1; }
	.find { display: flex; align-items: center; gap: 8px; height: 40px; width: 300px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 0 12px; color: var(--muted); }
	.find input { flex: 1; min-width: 0; border: 0; outline: none; background: none; font-size: 13.5px; color: var(--ink); }
	.find:focus-within { border-color: var(--acc); }
	.sync { background: none; border: 0; font-size: 12.5px; color: var(--muted); cursor: pointer; white-space: nowrap; }
	.sync b { color: var(--ok); }
	.sync.bad b { color: var(--bad); }
	.scan { height: 40px; padding: 0 16px; border-radius: 12px; background: var(--acc); color: var(--acc-ink); display: inline-flex; align-items: center; font-weight: 700; white-space: nowrap; }
	.scan.on { outline: 3px solid var(--acc-soft); }
	.sr { position: absolute; left: -9999px; }
</style>
