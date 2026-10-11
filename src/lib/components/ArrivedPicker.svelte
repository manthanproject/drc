<script lang="ts">
	import { ARRIVED_COOKIE, MAX_BACK_DAYS, arrivedCookie, shortDay } from '#lib/arrived.ts';
	import { istDate, shiftDay } from '#lib/scanlog.ts';

	// Scan screen: "These parcels arrived: Today / Yesterday / other date". Kept for the rest of today only.
	let { initial }: { initial: string | null } = $props();
	const today = istDate(Date.now());
	const yesterday = shiftDay(today, -1);
	// svelte-ignore state_referenced_locally
	let day = $state<string | null>(initial); // starting value only; the chips own it after that
	let other = $state(false);

	function set(d: string | null) {
		day = d && d < today && d >= shiftDay(today, -MAX_BACK_DAYS) ? d : null;
		try {
			document.cookie = day
				? `${ARRIVED_COOKIE}=${encodeURIComponent(arrivedCookie(day, Date.now()))}; path=/; max-age=86400; samesite=lax`
				: `${ARRIVED_COOKIE}=; path=/; max-age=0; samesite=lax`;
		} catch {
			/* cookies blocked: scans stay "arrived today" */
		}
		if (!day || day === yesterday) other = false;
	}
</script>

<div class="ap" class:late={!!day}>
	<div class="row">
		<span class="lbl">Parcels arrived</span>
		<div class="chips" role="group" aria-label="Day the parcels arrived">
			<button class="chip" class:on={!day} aria-pressed={!day} onclick={() => set(null)}>Today</button>
			<button class="chip" class:on={day === yesterday} aria-pressed={day === yesterday} onclick={() => set(yesterday)}>Yesterday</button>
			<button class="chip" class:on={!!day && day !== yesterday} aria-pressed={!!day && day !== yesterday} onclick={() => (other = !other)}>{day && day !== yesterday ? shortDay(day) : 'Other day'}</button>
		</div>
	</div>
	{#if other}
		<input class="dt" type="date" aria-label="Arrived on" min={shiftDay(today, -MAX_BACK_DAYS)} max={yesterday} value={day ?? ''} onchange={(e) => set(e.currentTarget.value || null)} />
	{/if}
	{#if day}<p class="note">Parcels you scan now are saved as <b>arrived {shortDay(day)}</b>. Goes back to Today by itself tomorrow.</p>{/if}
</div>

<style>
	.ap { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); }
	.ap.late { background: #fff5e0; border-color: #f1dfb5; }
	.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
	.lbl { font-size: 13px; font-weight: 700; color: var(--muted); }
	.late .lbl, .note { color: #7a5300; }
	.chips { display: flex; gap: 6px; flex-wrap: wrap; }
	.chip { min-height: 40px; padding: 0 14px; border-radius: 99px; border: 1px solid var(--line); background: var(--surface); color: inherit; font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; }
	.chip.on { background: var(--acc); border-color: var(--acc); color: #fff; }
	.late .chip.on { background: #7a5300; border-color: #7a5300; }
	.dt { height: 40px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: inherit; padding: 0 10px; font: inherit; align-self: flex-start; }
	.note { margin: 0; font-size: 12.5px; }
</style>
