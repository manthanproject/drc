<script lang="ts">
	import { istTime, isToday } from '#lib/scanlog.ts';

	// "Clear today's scan": a parcel scanned today by mistake (wrong parcel, wrong status) goes back exactly as it
	// was before the scan, so it can be scanned again. Shown only for today's scans.
	let { rto, oncleared }: { rto: { id: string; scanned_at?: string | null; stage: string }; oncleared: (text: string) => void } = $props();
	const show = $derived(rto.stage !== 'unknown_parcel' && isToday(rto.scanned_at, Date.now()));
	let open = $state(false);
	let busy = $state(false);
	let err = $state('');

	async function clear() {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const res = await fetch(`/api/rto/${rto.id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'clear_scan' }) });
			const b = await res.json().catch(() => ({}));
			if (!res.ok) err = b?.message ?? 'Could not clear';
			else {
				open = false;
				oncleared('Scan cleared. Scan the parcel again to pick the right status.');
			}
		} catch {
			err = 'No connection. Nothing changed.';
		} finally {
			busy = false;
		}
	}
</script>

{#if show}
	<div class="cs">
		{#if !open}
			<button class="lnkb" onclick={() => (open = true)}>Scanned by mistake or wrong status? Clear today's scan</button>
		{:else}
			<b>Clear today's scan ({istTime(rto.scanned_at!)})</b>
			<p class="small muted">Puts the parcel back exactly as it was before today's scan: the status, Ready Stock, the refund row and a draft claim made from it are all undone. Then scan it again. The history keeps a note.</p>
			{#if err}<p class="err small" role="alert">{err}</p>{/if}
			<div class="row">
				<button class="go warnb" disabled={busy} onclick={clear}>{busy ? 'Clearing…' : 'Clear scan'}</button>
				<button class="go" disabled={busy} onclick={() => { open = false; err = ''; }}>Cancel</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.cs { display: flex; flex-direction: column; gap: 8px; }
	.cs p { margin: 0; }
	.lnkb { border: 0; background: none; color: var(--muted); font: inherit; font-weight: 600; font-size: 13.5px; cursor: pointer; text-align: left; padding: 2px 0; text-decoration: underline; }
	.row { display: flex; gap: 8px; flex-wrap: wrap; }
	.go { min-height: 48px; padding: 0 18px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: inherit; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer; }
	.warnb { background: var(--warn, #b7791f); border-color: var(--warn, #b7791f); color: #fff; }
	.go:disabled { opacity: 0.5; cursor: default; }
	.err { margin: 0; color: var(--bad); }
</style>
