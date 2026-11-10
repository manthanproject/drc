<script lang="ts">
	import type { Snippet } from 'svelte';

	// A row of "Scanned today": tap opens it; swipe left (finger or mouse drag) shows Delete behind it.
	// One row open at a time: the parent binds `openId`.
	let {
		id,
		href,
		openId = $bindable(null),
		busy = false,
		ondelete,
		children
	}: { id: string; href: string; openId?: string | null; busy?: boolean; ondelete: () => void; children: Snippet } = $props();

	const W = 96; // width of the Delete button
	let x = $state(0); // current offset (0 closed … -W open)
	let dragging = $state(false);
	let startX = 0;
	let startY = 0;
	let base = 0;
	let swiped = false; // a drag happened → the click that follows must not open the row
	let decided: 'h' | 'v' | null = null;
	let tracking = false; // pointer is down on this row

	// another row opened (or this one closed from outside) → slide shut
	$effect(() => {
		if (openId !== id && !dragging) x = 0;
	});

	function down(e: PointerEvent) {
		if (e.button !== 0 || busy) return;
		startX = e.clientX;
		startY = e.clientY;
		base = openId === id ? -W : 0;
		decided = null;
		swiped = false;
		tracking = true;
	}

	function move(e: PointerEvent) {
		if (!tracking) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (!decided) {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			decided = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
			if (decided === 'h') {
				dragging = true;
				swiped = true;
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			}
		}
		if (decided !== 'h') return;
		x = Math.max(-W - 24, Math.min(0, base + dx));
	}

	function up() {
		if (dragging) {
			const open = x < -W / 2;
			x = open ? -W : 0;
			openId = open ? id : openId === id ? null : openId;
		}
		dragging = false;
		decided = null;
		tracking = false;
	}

	function click(e: MouseEvent) {
		if (swiped) {
			e.preventDefault();
			swiped = false;
			return;
		}
		if (openId === id) {
			// tap on an open row closes it instead of opening the parcel
			e.preventDefault();
			openId = null;
		}
	}
</script>

<div class="sw">
	<button class="del" style:visibility={x < 0 ? 'visible' : 'hidden'} tabindex={openId === id ? 0 : -1} aria-hidden={openId !== id} disabled={busy} onclick={ondelete}>{busy ? '…' : 'Delete'}</button>
	<a
		class="fg"
		class:anim={!dragging}
		{href}
		style="transform: translateX({x}px)"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onclick={click}
		draggable="false"
	>
		{@render children()}
	</a>
</div>

<style>
	.sw { position: relative; overflow: hidden; border-top: 1px solid var(--line); }
	.del { position: absolute; inset: 0 0 0 auto; width: 96px; border: 0; background: var(--bad, #c0392b); color: #fff; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer; }
	.del:disabled { opacity: 0.6; cursor: default; }
	.fg { position: relative; display: flex; justify-content: space-between; align-items: center; padding: 10px 0; background: var(--surface); touch-action: pan-y; user-select: none; -webkit-user-select: none; }
	.fg.anim { transition: transform 0.18s ease; }
</style>
