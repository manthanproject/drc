<script lang="ts">
	import { onDestroy } from 'svelte';
	let { text, eventId, ondone }: { text: string; eventId: number; ondone: (undone: boolean) => void } = $props();
	let left = $state(10);
	let busy = $state(false);
	let err = $state('');
	const t = setInterval(() => {
		left -= 1;
		if (left <= 0) {
			clearInterval(t);
			ondone(false);
		}
	}, 1000);
	onDestroy(() => clearInterval(t));

	async function undo() {
		if (busy) return;
		busy = true;
		clearInterval(t);
		try {
			const r = await fetch('/api/rto/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_id: eventId }) });
			if (!r.ok) {
				err = (await r.json().catch(() => null))?.message ?? 'Undo failed';
				busy = false;
				return;
			}
			ondone(true);
		} catch {
			err = 'No connection, undo not done';
			busy = false;
		}
	}
</script>

<div class="bar" role="status">
	<span class="tick">✓</span>
	<div class="txt">{text}<br /><small>{err || `Undo in ${left} s`}</small></div>
	<button onclick={undo} disabled={busy}>{busy ? '…' : 'Undo'}</button>
</div>

<style>
	.bar { display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 14px; border-radius: 14px; background: var(--ink); color: var(--bg); }
	.tick { color: #5cc58b; font-weight: 800; font-size: 18px; }
	.txt { flex: 1; font-size: 14px; font-weight: 600; }
	.txt small { font-weight: 500; opacity: 0.75; font-size: 12.5px; }
	button { height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--bg) 40%, transparent); background: transparent; color: var(--bg); font-weight: 700; font-size: 14px; cursor: pointer; }
</style>
