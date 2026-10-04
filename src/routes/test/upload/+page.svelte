<script lang="ts">
	let pass = $state('');
	let orderNo = $state('');
	let awb = $state('');
	let file: File | null = $state(null);
	let progress = $state(0);
	let log: string[] = $state([]);
	let busy = $state(false);

	const say = (m: string) => (log = [`${new Date().toLocaleTimeString()}  ${m}`, ...log]);

	async function post(path: string, body: unknown) {
		const r = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-drc-pass': pass },
			body: JSON.stringify(body)
		});
		const text = await r.text();
		if (!r.ok) throw new Error(`${r.status}: ${text}`);
		return JSON.parse(text);
	}

	function put(url: string, f: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const x = new XMLHttpRequest();
			x.open('PUT', url);
			x.setRequestHeader('content-type', f.type || 'application/octet-stream');
			x.upload.onprogress = (e) => e.lengthComputable && (progress = Math.round((e.loaded / e.total) * 100));
			x.onload = () => (x.status < 300 ? resolve(x.responseText) : reject(new Error(`PUT ${x.status}: ${x.responseText}`)));
			x.onerror = () => reject(new Error('PUT blocked (network or CORS)'));
			x.send(f);
		});
	}

	async function upload() {
		if (!file) return say('Pick a file first');
		busy = true;
		progress = 0;
		try {
			say(`Asking server for upload link (${(file.size / 1048576).toFixed(1)} MB)…`);
			const s = await post('/api/test/upload-session', {
				orderNo, awb, fileName: file.name, mimeType: file.type, size: file.size
			});
			say(`Folder ready: ${s.folder.url}`);
			const t0 = performance.now();
			const res = JSON.parse(await put(s.uploadUrl, file));
			say(`✅ Uploaded ${res.name} (${res.size} bytes) in ${((performance.now() - t0) / 1000).toFixed(1)} s, id ${res.id}`);
		} catch (e) {
			say(`❌ ${e instanceof Error ? e.message : e}`);
		} finally {
			busy = false;
		}
	}

	async function shortcut() {
		busy = true;
		try {
			const r = await post('/api/test/shortcut', { orderNo, awb });
			if (r.state === 'found') say(`✅ Packing video shortcut added (${r.shortcut.id}) → ${r.folder.url}`);
			else say(`⚠️ Packing video ${r.state}: ${r.message ?? r.packing?.filesDeleted ?? ''}`);
		} catch (e) {
			say(`❌ ${e instanceof Error ? e.message : e}`);
		} finally {
			busy = false;
		}
	}
</script>

<main>
	<h1>DRC uploader test</h1>
	<label>Password <input type="password" bind:value={pass} autocomplete="current-password" /></label>
	<label>Order no. <input bind:value={orderNo} inputmode="numeric" placeholder="3479" /></label>
	<label>Forward AWB <input bind:value={awb} placeholder="7D139889794" /></label>
	<label>
		Video or photo
		<input type="file" accept="video/*,image/*" onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)} />
	</label>
	<button disabled={busy} onclick={upload}>1. Upload to Drive</button>
	<progress max="100" value={progress}></progress> {progress}%
	<button disabled={busy} onclick={shortcut}>2. Add packing video shortcut</button>
	<ol>{#each log as l}<li>{l}</li>{/each}</ol>
</main>

<style>
	main { max-width: 520px; margin: 0 auto; padding: 16px; font-family: Inter, system-ui, sans-serif; display: grid; gap: 12px; }
	label { display: grid; gap: 4px; font-size: 14px; font-weight: 600; }
	input { font: inherit; padding: 10px; border: 1px solid #ddd; border-radius: 10px; }
	button { font: inherit; font-weight: 700; padding: 12px; border: 0; border-radius: 12px; background: #ea6a1f; color: #fff; }
	button:disabled { opacity: 0.5; }
	progress { width: 100%; }
	ol { font-size: 13px; padding-left: 18px; word-break: break-all; }
</style>
