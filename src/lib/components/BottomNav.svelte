<script lang="ts">
	let { active }: { active: 'home' | 'all' | 'scan' | 'claims' | 'stock' | 'refunds' } = $props();
</script>

<nav class="nav" aria-label="Main">
	<a href="/" class:on={active === 'home'} aria-current={active === 'home' ? 'page' : undefined}><i>⌂</i>Home</a>
	<a href="/stock" class:on={active === 'stock'} aria-current={active === 'stock' ? 'page' : undefined}><i>▤</i>Ready Stock</a>
	<a href="/scan" class="fab" class:fabon={active === 'scan'} aria-label="Scan a return" aria-current={active === 'scan' ? 'page' : undefined}><i>⌗</i></a>
	<a href="/claims" class:on={active === 'claims'} aria-current={active === 'claims' ? 'page' : undefined}><i>⚑</i>Claims</a>
	<a href="/refunds" class:on={active === 'refunds'} aria-current={active === 'refunds' ? 'page' : undefined}><i>₹</i>Refunds</a>
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
	.nav a { background: none; border: 0; padding: 0; font-size: 11px; color: var(--muted); cursor: pointer; }
	.nav i { display: block; font-style: normal; font-size: 19px; line-height: 1.1; margin-bottom: 2px; }
	.nav .on { color: var(--acc); font-weight: 600; }
	.nav .fab {
		justify-self: center; width: 62px; height: 62px; border-radius: 20px; background: var(--acc); color: var(--acc-ink);
		display: grid; place-items: center; margin-top: -26px; box-shadow: 0 10px 22px -10px var(--acc);
	}
	.nav .fab i { font-size: 22px; margin: 0; }
	.nav .fab.fabon { outline: 3px solid var(--acc-soft); }
</style>
