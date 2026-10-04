<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let busy = $state(false);
</script>

<main class="login">
	<div class="mark big">D</div>
	<h1>Dropy Return Central</h1>
	<p class="muted small">One shared password. This phone stays logged in.</p>
	<form
		method="POST"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update();
				busy = false;
			};
		}}
	>
		<input type="password" name="password" placeholder="Password" autocomplete="current-password" required aria-invalid={form?.wrong ? 'true' : undefined} />
		{#if form?.wrong}<p class="err" role="alert">Wrong password</p>{/if}
		<button class="btn" disabled={busy}>{busy ? 'Checking…' : 'Log in'}</button>
	</form>
</main>

<style>
	.login { max-width: 360px; margin: 0 auto; padding: calc(env(safe-area-inset-top, 0px) + 18vh) 24px 40px; text-align: center; }
	.big { width: 52px; height: 52px; border-radius: 15px; font-size: 22px; margin: 0 auto 16px; }
	h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
	form { margin-top: 22px; display: flex; flex-direction: column; gap: 10px; }
	input { height: 48px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); padding: 0 14px; font-size: 16px; }
	input[aria-invalid='true'] { border-color: var(--bad); }
	.err { color: var(--bad); font-size: 13px; font-weight: 600; margin: 0; }
</style>
