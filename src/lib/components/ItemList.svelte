<script lang="ts">
	import { onMount } from 'svelte';
	import { searchUrl, asinOf, amazonUrl, type ProductLink } from '#lib/products.ts';

	type Item = { id: string; sku: string | null; title: string; qty: number; is_gift: boolean; ready_stock_state?: string };
	let { items, rtoId }: { items: Item[]; rtoId: string } = $props();
	let links = $state<Record<string, ProductLink> | null>(null);

	onMount(() => {
		if (!items.some((i) => i.sku)) return;
		fetch(`/api/rto/${rtoId}/products`)
			.then((r) => (r.ok ? r.json() : {}))
			.then((x) => (links = x))
			.catch(() => (links = {}));
	});
</script>

<ul class="items">
	{#each items as it (it.id)}
		{@const l = it.sku ? links?.[it.sku] : undefined}
		{@const asin = asinOf(it.sku)}
		<li>
			{#if l?.image}<img src={l.image} alt="" width="44" height="44" loading="lazy" />{:else}<span class="ph" aria-hidden="true"></span>{/if}
			<span class="body">
				{#if it.sku}
					<a class="name" href={l?.url ?? searchUrl(it.sku)} target="_blank" rel="noopener noreferrer" title={it.title || it.sku}>{it.title || it.sku}</a>
				{:else}
					<span class="t name" title={it.title || 'Item'}>{it.title || 'Item'}</span>
				{/if}
				<span class="meta">
					{#if asin}<a class="asin mono" href={amazonUrl(asin)} target="_blank" rel="noopener noreferrer" title="Open on Amazon.com">{asin}</a>
					{:else if it.sku}<span class="mono">{it.sku}</span>
					{:else}<span>no SKU</span>{/if}
					{#if it.qty > 1}<span>× {it.qty}</span>{/if}
					{#if it.is_gift}<span class="pill p-acc">free gift</span>{/if}
					{#if it.ready_stock_state === 'in_stock'}<span class="pill p-ok">in Ready Stock</span>{/if}
					{#if it.sku && links}
						{#if l?.verified}<span class="ok">✓ on dropy.in</span>{:else}<span class="muted">not found, search link</span>{/if}
					{:else if it.sku}<span class="muted">checking…</span>{/if}
				</span>
			</span>
		</li>
	{/each}
</ul>

<style>
	.items { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	li { display: flex; gap: 10px; align-items: center; }
	img, .ph { width: 44px; height: 44px; flex: none; border-radius: 10px; object-fit: cover; background: var(--sunk); border: 1px solid var(--line); }
	.body { min-width: 0; flex: 1; display: flex; flex-direction: column; }
	.name { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
	a, .t { font-size: 13.5px; font-weight: 600; line-height: 1.35; }
	a { color: var(--acc); text-decoration: underline; text-underline-offset: 2px; }
	.meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
	.ok { color: var(--ok); font-weight: 600; }
	.meta .asin { font-size: 12px; font-weight: 600; color: var(--ink); text-decoration-color: var(--muted); }
</style>
