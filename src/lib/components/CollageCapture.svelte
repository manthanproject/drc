<script lang="ts">
	import PhotoCamera from './PhotoCamera.svelte';
	import { COLLAGE_SHOTS } from '#lib/claims.ts';
	import { buildCollage, type Stamp } from '#lib/collage.ts';

	// 7 photos (label, front, back, 4 sides) → one stamped collage image. The shots live in the parent (bind:shots),
	// so closing this and opening it again keeps what was taken.
	let {
		shots = $bindable(),
		stamp,
		onfile,
		onclose
	}: { shots: (File | null)[]; stamp: Stamp; onfile: (f: File) => void; onclose: () => void } = $props();

	let camAt = $state<number | null>(null);
	let chain = $state(false); // after a shot, open the camera for the next empty one
	let busy = $state(false);
	let err = $state('');
	let preview = $state<{ url: string; file: File } | null>(null);
	let camApp: HTMLInputElement;
	let gallery: HTMLInputElement;
	let appAt = 0;

	const thumbs = $derived(shots.map((f) => (f ? URL.createObjectURL(f) : null)));
	$effect(() => {
		const urls = thumbs;
		return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
	});
	const filled = $derived(shots.filter(Boolean).length);
	const nextEmpty = $derived(shots.findIndex((f) => !f));

	function setShot(i: number, f: File) {
		const next = [...shots];
		next[i] = f;
		shots = next;
		if (preview) {
			URL.revokeObjectURL(preview.url);
			preview = null;
		}
	}
	function takeAll() {
		if (nextEmpty < 0) return;
		chain = true;
		camAt = nextEmpty;
	}
	function retake(i: number) {
		chain = false;
		camAt = i;
	}
	function snapped(f: File) {
		const i = camAt!;
		setShot(i, f);
		const n = shots.findIndex((x) => !x);
		camAt = chain && n >= 0 ? n : null;
	}
	function useCameraApp() {
		appAt = nextEmpty >= 0 ? nextEmpty : 0;
		camApp.click();
	}
	function fromCameraApp(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const f = el.files?.[0];
		el.value = '';
		if (f) setShot(appAt, f);
	}
	function fromGallery(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const files = [...(el.files ?? [])];
		el.value = '';
		const next = [...shots];
		for (const f of files) {
			const i = next.findIndex((x) => !x);
			if (i < 0) break;
			next[i] = f;
		}
		shots = next;
	}
	async function make() {
		if (busy || filled < COLLAGE_SHOTS.length) return;
		busy = true;
		err = '';
		try {
			const file = await buildCollage(
				COLLAGE_SHOTS.map((s, i) => ({ label: s.label, file: shots[i]! })),
				stamp
			);
			preview = { url: URL.createObjectURL(file), file };
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not make the collage. Retake the last photo and try again.';
		} finally {
			busy = false;
		}
	}
	function use() {
		if (!preview) return;
		const f = preview.file;
		URL.revokeObjectURL(preview.url);
		preview = null;
		onfile(f);
	}
</script>

<div class="sheet" role="dialog" aria-modal="true" aria-label="Photo collage">
	<header>
		<button class="x" onclick={onclose}>Close</button>
		<b>Photo collage <span class="muted">{filled} of {COLLAGE_SHOTS.length}</span></b>
	</header>

	<div class="body">
		{#if preview}
			<p class="small muted">This one image goes to the claim. Check the AWB is readable on the label photo.</p>
			<img class="prev" src={preview.url} alt="Collage preview" />
			<div class="row">
				<button class="go accb" onclick={use}>Use this collage</button>
				<button class="go" onclick={() => { if (preview) URL.revokeObjectURL(preview.url); preview = null; }}>Back to photos</button>
			</div>
		{:else}
			<p class="small muted">Take the 7 photos in order. Tap a photo to retake it. They become one image with the order, AWB and time stamped on top.</p>
			<div class="grid">
				{#each COLLAGE_SHOTS as s, i (s.key)}
					<button class="slot" class:wide={i === 0} class:on={!!shots[i]} onclick={() => retake(i)} aria-label="{shots[i] ? 'Retake' : 'Take'} {s.label}">
						{#if thumbs[i]}<img src={thumbs[i]} alt="" />{/if}
						<span class="cap">{i + 1}. {s.label}{shots[i] ? ' ✓' : ''}</span>
					</button>
				{/each}
			</div>
			{#if err}<p class="err small" role="alert">{err}</p>{/if}
			<div class="row">
				{#if filled < COLLAGE_SHOTS.length}
					<button class="go accb" onclick={takeAll}>{filled ? `Take next: ${COLLAGE_SHOTS[nextEmpty].label}` : 'Start taking photos'}</button>
				{:else}
					<button class="go accb" disabled={busy} onclick={make}>{busy ? 'Making collage…' : 'Make collage'}</button>
				{/if}
			</div>
			<div class="alt">
				<button class="link" onclick={useCameraApp}>Camera app</button>
				<button class="link" onclick={() => gallery.click()}>Choose files</button>
			</div>
		{/if}
	</div>
	<input class="hide" type="file" accept="image/*" capture="environment" bind:this={camApp} onchange={fromCameraApp} />
	<input class="hide" type="file" accept="image/*" multiple bind:this={gallery} onchange={fromGallery} />
</div>

{#if camAt !== null}
	{#key camAt}
		<PhotoCamera
			label="{camAt + 1}/{COLLAGE_SHOTS.length} · {COLLAGE_SHOTS[camAt].label}"
			onclose={() => { camAt = null; chain = false; }}
			onfile={snapped}
		/>
	{/key}
{/if}

<style>
	.sheet { position: fixed; inset: 0; z-index: 40; background: var(--bg); display: flex; flex-direction: column; overflow: auto; }
	header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--surface); position: sticky; top: 0; }
	header b { font-size: 16px; }
	.x { height: 40px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font: inherit; font-weight: 700; cursor: pointer; }
	.body { padding: 14px 16px 28px; display: flex; flex-direction: column; gap: 12px; max-width: 760px; width: 100%; margin: 0 auto; box-sizing: border-box; }
	.body p { margin: 0; }
	.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
	.slot { position: relative; aspect-ratio: 1; border-radius: 14px; border: 2px dashed var(--line); background: var(--sunk); overflow: hidden; padding: 0; cursor: pointer; font: inherit; }
	.slot.wide { grid-column: 1 / -1; aspect-ratio: 2 / 1; }
	.slot.on { border-style: solid; border-color: var(--acc); }
	.slot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 6px 8px; background: rgba(15, 23, 32, 0.72); color: #fff; font-size: 12.5px; font-weight: 600; text-align: left; }
	.row { display: flex; gap: 8px; flex-wrap: wrap; }
	.go { min-height: 48px; padding: 0 18px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: inherit; font: inherit; font-weight: 700; font-size: 14.5px; cursor: pointer; flex: 1 1 auto; }
	.go.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.go:disabled { opacity: 0.6; cursor: wait; }
	.alt { display: flex; justify-content: center; gap: 18px; }
	.link { background: none; border: 0; padding: 4px 0; color: var(--acc); font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; }
	.prev { width: 100%; border-radius: 12px; border: 1px solid var(--line); }
	.err { color: var(--bad); }
	.hide { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
	@media (min-width: 700px) {
		.grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
		.slot.wide { grid-column: span 2; aspect-ratio: 2 / 1; }
	}
</style>
