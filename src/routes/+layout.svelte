<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import TopBar from '#lib/components/TopBar.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>DRC · Dropy Return Central</title>
</svelte:head>

{#if page.url.pathname !== '/login'}<TopBar sync={data.topSync} />{/if}
{@render children()}
