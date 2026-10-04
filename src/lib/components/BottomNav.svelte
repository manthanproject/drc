<script lang="ts">
	let { active }: { active: 'home' | 'all' } = $props();
	let toast = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	function soon(what: string, phase: string) {
		toast = `${what} comes in ${phase}`;
		clearTimeout(timer);
		timer = setTimeout(() => (toast = ''), 2200);
	}
</script>

{#if toast}<div class="toast" role="status">{toast}</div>{/if}
<nav class="nav" aria-label="Main">
	<a href="/" class:on={active === 'home'} aria-current={active === 'home' ? 'page' : undefined}><i>⌂</i>Home</a>
	<button type="button" class="off" onclick={() => soon('Ready Stock', 'Phase 3')}><i>▤</i>Ready Stock</button>
	<button type="button" class="fab off" aria-label="Scan (Phase 3)" onclick={() => soon('Scan', 'Phase 3')}><i>⌗</i></button>
	<button type="button" class="off" onclick={() => soon('Claims', 'Phase 5')}><i>⚑</i>Claims</button>
	<a href="/rtos" class:on={active === 'all'} aria-current={active === 'all' ? 'page' : undefined}><i>☰</i>All RTOs</a>
</nav>

<style>
	.nav {
		position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
		height: calc(var(--nav-h) + env(safe-area-inset-bottom, 0px)); padding-bottom: env(safe-area-inset-bottom, 0px);
		border-top: 1px solid var(--line); background: var(--surface);
		display: grid; grid-template-columns: 1fr 1fr 88px 1fr 1fr; align-items: center; text-align: center;
	}
	@media (min-width: 560px) { .nav { left: 50%; width: 560px; transform: translateX(-50%); border-left: 1px solid var(--line); border-right: 1px solid var(--line); } }
	.nav a, .nav button { background: none; border: 0; padding: 0; font-size: 11px; color: var(--muted); cursor: pointer; }
	.nav i { display: block; font-style: normal; font-size: 19px; line-height: 1.1; margin-bottom: 2px; }
	.nav .on { color: var(--acc); font-weight: 600; }
	.nav .off { opacity: 0.45; }
	.nav .fab {
		justify-self: center; width: 62px; height: 62px; border-radius: 20px; background: var(--acc); color: var(--acc-ink);
		display: grid; place-items: center; margin-top: -26px; box-shadow: 0 10px 22px -10px var(--acc);
	}
	.nav .fab i { font-size: 22px; margin: 0; }
	.toast {
		position: fixed; left: 50%; transform: translateX(-50%); z-index: 11;
		bottom: calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 14px);
		background: var(--ink); color: var(--bg); font-size: 13px; font-weight: 600; padding: 9px 14px; border-radius: 12px;
	}
</style>
