<script lang="ts">
	import { onMount } from 'svelte';

	// In-app photo: the browser never leaves DRC, so the phone can't kill the page to free memory
	// (that happens when the separate camera app opens). Back camera, up to 1920 px, JPEG ~0.85.
	let { label, onfile, onclose }: { label: string; onfile: (f: File) => void; onclose: () => void } = $props();

	let video = $state<HTMLVideoElement>();
	let phase = $state<'starting' | 'ready' | 'busy' | 'error'>('starting');
	let errText = $state('');
	let stream: MediaStream | null = null;

	function stop() {
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	async function start() {
		if (!navigator.mediaDevices?.getUserMedia) {
			phase = 'error';
			errText = 'This browser cannot use the camera here. Use the camera app or choose a file.';
			return;
		}
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
				audio: false
			});
		} catch (e) {
			phase = 'error';
			errText = e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the browser, or use the camera app.' : 'No camera found. Use the camera app or choose a file.';
			return;
		}
		if (video) {
			video.srcObject = stream;
			await video.play().catch(() => {});
		}
		phase = 'ready';
	}

	async function snap() {
		if (!video || phase !== 'ready') return;
		phase = 'busy';
		const w = video.videoWidth, h = video.videoHeight;
		const scale = Math.min(1, 1920 / Math.max(w, h));
		const c = document.createElement('canvas');
		c.width = Math.round(w * scale);
		c.height = Math.round(h * scale);
		c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
		const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85));
		stop();
		if (blob) onfile(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
		else {
			phase = 'error';
			errText = 'Could not take the photo. Use the camera app instead.';
		}
	}

	function cancel() {
		stop();
		onclose();
	}

	onMount(() => {
		start();
		return stop;
	});
</script>

<div class="cam" role="dialog" aria-modal="true" aria-label="Take {label}">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} muted playsinline></video>
	<div class="top"><button class="x" onclick={cancel}>Cancel</button><span class="what">{label}</span></div>
	{#if phase === 'error'}
		<div class="errbox">{errText}<button class="x" onclick={cancel}>Close</button></div>
	{:else}
		<div class="bottom"><button class="shutter" onclick={snap} disabled={phase !== 'ready'} aria-label="Take photo"><span></span></button></div>
	{/if}
</div>

<style>
	.cam { position: fixed; inset: 0; z-index: 50; background: #000; color: #fff; display: flex; flex-direction: column; }
	video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
	.top, .bottom, .errbox { position: relative; z-index: 1; }
	.top { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; }
	.what { font-weight: 700; padding: 6px 12px; border-radius: 999px; background: rgba(0, 0, 0, 0.55); }
	.x { height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.4); background: rgba(0, 0, 0, 0.45); color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; }
	.bottom { margin-top: auto; display: flex; justify-content: center; padding: 8px 0 calc(28px + env(safe-area-inset-bottom, 0px)); }
	.shutter { width: 76px; height: 76px; border-radius: 50%; border: 4px solid #fff; background: transparent; display: grid; place-items: center; cursor: pointer; }
	.shutter span { width: 60px; height: 60px; border-radius: 50%; background: #fff; }
	.shutter:disabled { opacity: 0.4; }
	.errbox { margin: auto 16px; padding: 16px; border-radius: 14px; background: #2a2622; display: flex; flex-direction: column; gap: 12px; font-size: 15px; }
</style>
