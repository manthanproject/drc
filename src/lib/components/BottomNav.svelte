<script lang="ts">
	let { active }: { active: 'home' | 'all' | 'scan' | 'claims' | 'stock' | 'refunds' } = $props();
</script>

<nav class="nav" aria-label="Main">
	<a href="/" class:on={active === 'home'} aria-current={active === 'home' ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7v8a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z" /></svg>Home
	</a>
	<a href="/stock" class:on={active === 'stock'} aria-current={active === 'stock' ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 10h18M3 15h18" /></svg>Ready Stock
	</a>
	<a href="/scan" class="fab" class:fabon={active === 'scan'} aria-label="Scan a return" aria-current={active === 'scan' ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 9v6M11 9v6M14 9v6M17 9v6" /></svg>
	</a>
	<a href="/claims" class:on={active === 'claims'} aria-current={active === 'claims' ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>Claims
	</a>
	<a href="/refunds" class:on={active === 'refunds'} aria-current={active === 'refunds' ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h10M7 9h10M9 5c4 0 5 4 0 4l6 10" /></svg>Refunds
	</a>
</nav>

<style>
	.nav {
		position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
		height: calc(var(--nav-h) + env(safe-area-inset-bottom, 0px)); padding-bottom: env(safe-area-inset-bottom, 0px);
		border-top: 1px solid var(--line); background: var(--surface);
		display: grid; grid-template-columns: 1fr 1fr 88px 1fr 1fr; align-items: center; text-align: center;
	}
	@media (min-width: 1024px) { .nav { display: none !important; } }
	@media (min-width: 560px) { .nav { left: 50%; width: 560px; transform: translateX(-50%); border-left: 1px solid var(--line); border-right: 1px solid var(--line); } }
	.nav a { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; color: #8a9099; }
	.nav svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.nav .on { color: var(--acc); }
	.nav .fab {
		justify-self: center; width: 62px; height: 62px; border-radius: 22px; background: var(--acc); color: var(--acc-ink);
		display: grid; place-items: center; margin-top: -28px; box-shadow: 0 10px 22px -10px var(--acc);
	}
	.nav .fab svg { width: 27px; height: 27px; stroke-width: 2.2; }
	.nav .fab.fabon { outline: 3px solid var(--acc-soft); }
</style>
