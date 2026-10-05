<script lang="ts">
	import { onMount } from 'svelte';
	let { oncode }: { oncode: (code: string) => void } = $props();

	let video = $state<HTMLVideoElement>();
	let input = $state<HTMLInputElement>();
	let text = $state('');
	let on = $state(false);
	let starting = $state(false);
	let err = $state('');
	let canTorch = $state(false);
	let torch = $state(false);
	let stream: MediaStream | null = null;
	let detector: { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } | null = null;
	let raf = 0;
	let last = 0;
	let busy = false;

	const FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'pdf417'];

	/** Native reader where the phone has one (Android Chrome), else a WebAssembly reader (iPhone, Windows). */
	async function getDetector() {
		const Native = (globalThis as any).BarcodeDetector;
		if (Native?.getSupportedFormats) {
			try {
				const have: string[] = await Native.getSupportedFormats();
				if (have.includes('code_128')) return new Native({ formats: FORMATS.filter((f) => have.includes(f)) });
			} catch {
				/* fall through */
			}
		}
		const { BarcodeDetector } = await import('barcode-detector/ponyfill');
		return new BarcodeDetector({ formats: FORMATS as any });
	}

	export function focusInput() {
		if (matchMedia('(pointer: fine)').matches) input?.focus(); // desktop / USB gun only; never pops the phone keyboard
	}

	async function start() {
		err = '';
		starting = true;
		try {
			detector ??= await getDetector();
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
				audio: false
			});
			if (!video) throw new Error('no video');
			video.srcObject = stream;
			await video.play();
			on = true;
			const caps = (stream.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
			canTorch = !!caps.torch;
			loop();
		} catch (e) {
			const name = (e as { name?: string })?.name;
			err = name === 'NotAllowedError' ? 'Camera blocked. Allow camera for this site in the browser settings.' : 'Camera not available here. Type the code or use a scanner gun.';
			stop();
		} finally {
			starting = false;
		}
	}

	async function loop() {
		if (!on) return;
		raf = requestAnimationFrame(loop);
		const t = performance.now();
		if (busy || t - last < 200 || !video || video.readyState < 2) return;
		last = t;
		busy = true;
		try {
			const codes = await detector!.detect(video);
			const v = codes?.[0]?.rawValue?.trim();
			if (v) {
				navigator.vibrate?.(60);
				stop();
				oncode(v);
			}
		} catch {
			/* frame not ready */
		} finally {
			busy = false;
		}
	}

	function stop() {
		on = false;
		cancelAnimationFrame(raf);
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		torch = false;
		canTorch = false;
	}

	async function toggleTorch() {
		const track = stream?.getVideoTracks()[0];
		if (!track) return;
		torch = !torch;
		try {
			await track.applyConstraints({ advanced: [{ torch } as MediaTrackConstraintSet] });
		} catch {
			torch = false;
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const v = text.trim();
		if (!v) return;
		text = '';
		oncode(v);
	}

	// Browser only (onMount never runs during server rendering): focus for USB guns, stop the camera on leave
	onMount(() => {
		focusInput();
		return stop;
	});
</script>

<div class="scanner">
	<div class="cam" class:live={on}>
		<video bind:this={video} playsinline muted aria-label="Camera preview"></video>
		{#if on}
			<div class="frame"></div>
			<div class="camtools">
				{#if canTorch}<button onclick={toggleTorch}>{torch ? 'Torch off' : 'Torch'}</button>{/if}
				<button onclick={stop}>Stop camera</button>
			</div>
		{:else}
			<button class="startcam" onclick={start} disabled={starting}>{starting ? 'Starting camera…' : 'Scan with camera'}</button>
		{/if}
	</div>
	{#if err}<div class="err" role="alert">{err}</div>{/if}
	<form class="search" onsubmit={submit}>
		<label for="scan-input" class="sr">AWB, order no., phone or name</label>
		<input id="scan-input" bind:this={input} bind:value={text} placeholder="Type or scan: AWB, order no., phone, name" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" />
		<button type="submit" disabled={!text.trim()}>Find</button>
	</form>
</div>

<style>
	.scanner { display: flex; flex-direction: column; gap: 10px; }
	.cam { position: relative; height: 150px; border-radius: 18px; background: #1d1a16; overflow: hidden; display: grid; place-items: center; }
	.cam.live { height: 240px; }
	video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.cam:not(.live) video { display: none; }
	.frame { position: absolute; left: 12%; right: 12%; top: 34%; bottom: 34%; border: 2px solid var(--acc); border-radius: 12px; box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.25); }
	.camtools { position: absolute; bottom: 10px; right: 10px; display: flex; gap: 8px; }
	.camtools button { height: 38px; padding: 0 12px; border-radius: 10px; border: 0; background: rgba(0, 0, 0, 0.6); color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
	.startcam { height: 52px; padding: 0 20px; border-radius: 14px; border: 0; background: var(--acc); color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; }
	.search { display: flex; gap: 8px; }
	.search input { flex: 1; min-width: 0; height: 50px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); padding: 0 14px; font-size: 16px; }
	.search input:focus { border-color: var(--acc); outline: none; }
	.search button { height: 50px; padding: 0 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; cursor: pointer; }
	.err { color: var(--bad); font-size: 13px; font-weight: 600; }
	.sr { position: absolute; left: -9999px; }
</style>
