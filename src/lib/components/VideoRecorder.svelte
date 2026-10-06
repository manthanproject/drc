<script lang="ts">
	import { onMount } from 'svelte';

	// In-app unboxing recorder: back camera at 720p, ~2 Mbps (≈12 MB for 40 s instead of ~42 MB from the camera app).
	let { onfile, onclose }: { onfile: (f: File) => void; onclose: () => void } = $props();

	const MAX_SECS = 300;
	let video = $state<HTMLVideoElement>();
	let phase = $state<'starting' | 'ready' | 'recording' | 'error'>('starting');
	let errText = $state('');
	let secs = $state(0);
	let stream: MediaStream | null = null;
	let rec: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let timer: ReturnType<typeof setInterval> | undefined;

	const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
	const pickType = () => (typeof MediaRecorder === 'undefined' ? '' : TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '');

	async function start() {
		phase = 'starting';
		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
			phase = 'error';
			errText = 'This browser cannot record here. Use the camera app instead.';
			return;
		}
		const video720 = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
		try {
			stream = await navigator.mediaDevices.getUserMedia({ video: video720, audio: true });
		} catch {
			try {
				stream = await navigator.mediaDevices.getUserMedia({ video: video720 }); // mic blocked → video only
			} catch (e) {
				phase = 'error';
				errText = e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the browser, or use the camera app.' : 'No camera found. Use the camera app or choose a file.';
				return;
			}
		}
		if (video) {
			video.srcObject = stream;
			await video.play().catch(() => {});
		}
		phase = 'ready';
	}

	function record() {
		if (!stream) return;
		const mimeType = pickType();
		chunks = [];
		rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 64_000 });
		rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		rec.onstop = () => {
			const type = rec?.mimeType || mimeType || 'video/webm';
			const ext = type.includes('mp4') ? 'mp4' : 'webm';
			const file = new File(chunks, `unboxing.${ext}`, { type: type.split(';')[0] });
			stop();
			if (file.size > 0) onfile(file);
			else {
				phase = 'error';
				errText = 'Nothing was recorded. Try again or use the camera app.';
			}
		};
		rec.start(1000);
		secs = 0;
		phase = 'recording';
		timer = setInterval(() => {
			secs += 1;
			if (secs >= MAX_SECS) finish();
		}, 1000);
	}

	function finish() {
		clearInterval(timer);
		if (rec && rec.state !== 'inactive') rec.stop();
	}

	function stop() {
		clearInterval(timer);
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	function cancel() {
		if (rec && rec.state !== 'inactive') {
			rec.onstop = null;
			rec.stop();
		}
		stop();
		onclose();
	}

	onMount(() => {
		start();
		return () => {
			if (rec && rec.state !== 'inactive') {
				rec.onstop = null;
				rec.stop();
			}
			stop();
		};
	});

	const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
</script>

<div class="rec" role="dialog" aria-modal="true" aria-label="Record unboxing video">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} muted playsinline></video>
	<div class="top">
		<button class="x" onclick={cancel}>Cancel</button>
		{#if phase === 'recording'}<span class="live"><span class="dot"></span>{mmss(secs)}</span>{:else}<span class="hint">720p</span>{/if}
	</div>
	{#if phase === 'error'}
		<div class="errbox">{errText}<button class="x" onclick={cancel}>Close</button></div>
	{:else}
		<div class="tip">{phase === 'recording' ? 'Show every side, the label, then open it and show each item.' : 'Start with the sealed box: all sides and the label.'}</div>
		<div class="bottom">
			{#if phase === 'recording'}
				<button class="shutter on" onclick={finish} aria-label="Stop recording"><span class="sq"></span></button>
			{:else}
				<button class="shutter" onclick={record} disabled={phase !== 'ready'} aria-label="Start recording"><span class="ci"></span></button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.rec { position: fixed; inset: 0; z-index: 50; background: #000; color: #fff; display: flex; flex-direction: column; }
	video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
	.top, .bottom, .tip, .errbox { position: relative; z-index: 1; }
	.top { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; }
	.x { height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.4); background: rgba(0, 0, 0, 0.45); color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; }
	.hint { font-size: 13px; opacity: 0.8; }
	.live { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: rgba(0, 0, 0, 0.55); font-weight: 700; font-variant-numeric: tabular-nums; }
	.dot { width: 10px; height: 10px; border-radius: 50%; background: #ff3b30; }
	.tip { margin: auto 16px 12px; padding: 10px 12px; border-radius: 12px; background: rgba(0, 0, 0, 0.55); font-size: 14px; text-align: center; }
	.bottom { display: flex; justify-content: center; padding: 8px 0 calc(28px + env(safe-area-inset-bottom, 0px)); }
	.shutter { width: 76px; height: 76px; border-radius: 50%; border: 4px solid #fff; background: transparent; display: grid; place-items: center; cursor: pointer; }
	.shutter:disabled { opacity: 0.4; }
	.ci { width: 58px; height: 58px; border-radius: 50%; background: #ff3b30; }
	.sq { width: 30px; height: 30px; border-radius: 6px; background: #ff3b30; }
	.errbox { margin: auto 16px; padding: 16px; border-radius: 14px; background: #2a2622; display: flex; flex-direction: column; gap: 12px; font-size: 15px; }
</style>
