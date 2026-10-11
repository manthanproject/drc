<script lang="ts">
	import { MAX_BACK_DAYS, arrivedDay, shortDay } from '#lib/arrived.ts';
	import { istDate, istTime, shiftDay } from '#lib/scanlog.ts';

	// RTO page: the day a scanned parcel actually arrived (it may be scanned a day or more later). Staff can fix it.
	let { rto, onsaved }: { rto: { id: string; scanned_at: string | null; received_on?: string | null }; onsaved: () => void } = $props();
	const scanDay = $derived(rto.scanned_at ? istDate(Date.parse(rto.scanned_at)) : '');
	const day = $derived(arrivedDay(rto));
	let open = $state(false);
	let pick = $state('');
	let busy = $state(false);
	let err = $state('');

	function start() {
		pick = day ?? scanDay;
		err = '';
		open = true;
	}
	async function save() {
		if (busy || !pick) return;
		busy = true;
		err = '';
		try {
			const res = await fetch(`/api/rto/${rto.id}/received`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day: pick === scanDay ? null : pick }) });
			const b = await res.json().catch(() => ({}));
			if (!res.ok) err = b?.message ?? 'Could not save';
			else {
				open = false;
				onsaved();
			}
		} catch {
			err = 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}
</script>

{#if day && rto.scanned_at}
	<span class="v">{shortDay(day)}{#if !open} <button class="lnkb" onclick={start}>Change</button>{/if}</span>
	<small class="sub">Scanned {shortDay(scanDay)}, {istTime(rto.scanned_at)}{rto.received_on ? ' (arrived earlier)' : ''}</small>
	{#if open}
		<span class="ed">
			<input type="date" aria-label="Arrived on" bind:value={pick} min={shiftDay(scanDay, -MAX_BACK_DAYS)} max={scanDay} />
			<button class="go okb" disabled={busy || !pick} onclick={save}>{busy ? 'Saving…' : 'Save'}</button>
			<button class="go" disabled={busy} onclick={() => (open = false)}>Cancel</button>
		</span>
		{#if err}<small class="err" role="alert">{err}</small>{/if}
	{/if}
{/if}

<style>
	.v { font-weight: inherit; }
	.sub { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }
	.lnkb { border: 0; background: none; color: var(--acc); font: inherit; font-weight: 700; font-size: 13px; cursor: pointer; padding: 0 0 0 6px; text-decoration: underline; }
	.ed { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; justify-content: inherit; }
	.ed input { height: 40px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: inherit; padding: 0 8px; font: inherit; }
	.go { min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: inherit; font: inherit; font-weight: 700; font-size: 13.5px; cursor: pointer; }
	.okb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.go:disabled { opacity: 0.5; cursor: default; }
	.err { display: block; color: var(--bad); }
</style>
