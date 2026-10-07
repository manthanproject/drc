<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import VideoRecorder from '#lib/components/VideoRecorder.svelte';
	import PhotoCamera from '#lib/components/PhotoCamera.svelte';
	import { REASONS, EVIDENCE, velocityDisputeType, reasonOf, claimReasonLabel, claimStatus, type ReasonKey, type MediaKind } from '#lib/claims.ts';
	import { claimReturn, withUndo } from '#lib/scan.ts';
	import { asinOf } from '#lib/products.ts';
	import { inr, num, orderLabel, paymentBreakdown } from '#lib/dashboard.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.rto);
	const items = $derived(data.items);
	const open = $derived(data.claims.find((c) => !['closed', 'rejected'].includes(c.status)) ?? null);
	const backHref = $derived(claimReturn(r.id, page.url.searchParams.get('from'), page.url.searchParams.get('ret')));
	const scanned = $derived(page.url.searchParams.get('scanned') === '1');
	const noCourier = $derived(!r.courier || !r.forward_awb);

	type Up = { state: 'idle' | 'uploading' | 'done' | 'error'; pct: number; id?: string; mime?: string; size?: number; preview?: string; err?: string };
	const idle = (): Up => ({ state: 'idle', pct: 0 });
	let reason = $state<ReasonKey | null>(null);
	let ticked = $state<string[]>([]);
	let restockOthers = $state(true);
	let note = $state('');
	let media = $state<Record<MediaKind, Up>>({ unboxing_video: idle(), front: idle(), back: idle(), label: idle() });
	let recorder = $state(false);
	let camera = $state<MediaKind | null>(null);
	let saving = $state(false);
	let err = $state('');
	let restored = $state(false);
	let inputs: Partial<Record<string, HTMLInputElement>> = {};

	const untouched = $derived(items.filter((i) => !ticked.includes(i.id) && i.ready_stock_state === 'na'));
	const doneCount = $derived(EVIDENCE.filter((e) => media[e.kind].state === 'done').length);
	const uploading = $derived(EVIDENCE.some((e) => media[e.kind].state === 'uploading'));
	const blocker = $derived(
		!reason ? 'Pick a reason' : items.length && !ticked.length ? 'Tick the item(s) with the problem' : uploading ? 'Uploading…' : doneCount < 4 ? `Record ${4 - doneCount} more to save the claim` : null
	);
	const vType = $derived(reason ? velocityDisputeType(reasonOf(reason)!.claimReason) : null);

	// ---- keep progress if the phone reloads the tab (e.g. Android frees memory while the camera app is open).
	// localStorage, not sessionStorage: a killed tab can lose its session storage. Kept 2 days, cleared on save.
	const KEY = $derived(`drc-claim-${r.id}`);
	onMount(() => {
		if (items.length === 1) ticked = [items[0].id];
		try {
			const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
			if (s && typeof s === 'object' && Date.now() - Number(s.at ?? 0) < 2 * 86_400_000) {
				if (reasonOf(s.reason)) reason = s.reason;
				if (Array.isArray(s.ticked)) ticked = s.ticked.filter((id: string) => items.some((i) => i.id === id));
				if (typeof s.restockOthers === 'boolean') restockOthers = s.restockOthers;
				if (typeof s.note === 'string') note = s.note;
				for (const e of EVIDENCE) if (s.media?.[e.kind]?.id) media[e.kind] = { state: 'done', pct: 100, id: s.media[e.kind].id, mime: s.media[e.kind].mime, size: s.media[e.kind].size };
			}
		} catch {
			/* storage blocked: start fresh */
		}
		restored = true;
	});
	$effect(() => {
		if (!restored) return;
		const keep: Record<string, unknown> = {};
		for (const e of EVIDENCE) if (media[e.kind].state === 'done') keep[e.kind] = { id: media[e.kind].id, mime: media[e.kind].mime, size: media[e.kind].size };
		const snap = JSON.stringify({ at: Date.now(), reason, ticked, restockOthers, note, media: keep });
		try {
			localStorage.setItem(KEY, snap);
		} catch {
			/* ignore */
		}
	});
	beforeNavigate((nav) => {
		if (uploading && !saving && !confirm('A file is still uploading. Leave anyway?')) nav.cancel();
	});

	function toggle(id: string) {
		ticked = ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id];
	}

	function put(url: string, f: Blob, type: string, onpct: (p: number) => void): Promise<any> {
		return new Promise((resolve, reject) => {
			const x = new XMLHttpRequest();
			x.open('PUT', url);
			x.setRequestHeader('content-type', type);
			x.upload.onprogress = (e) => e.lengthComputable && onpct(Math.round((e.loaded / e.total) * 100));
			x.onload = () => {
				if (x.status >= 300) return reject(new Error(`Drive said ${x.status}, try again.`));
				try {
					resolve(JSON.parse(x.responseText));
				} catch {
					reject(new Error('Drive answer unreadable, try again.'));
				}
			};
			x.onerror = () => reject(new Error('Upload stopped (network), try again.'));
			x.send(f);
		});
	}

	async function upload(kind: MediaKind, file: File) {
		const type = file.type || (kind === 'unboxing_video' ? 'video/mp4' : 'image/jpeg');
		const old = media[kind].preview;
		if (old) URL.revokeObjectURL(old);
		media[kind] = { state: 'uploading', pct: 0, preview: type.startsWith('image/') ? URL.createObjectURL(file) : undefined };
		try {
			// one upload link at a time, so two photos never race to create the claim folder twice
			const sess = await (sessions = sessions.catch(() => {}).then(async () => {
				const s = await fetch(`/api/rto/${r.id}/media-session`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind, mimeType: type, size: file.size, name: file.name })
				});
				const b = await s.json().catch(() => ({}));
				if (!s.ok) throw new Error(b?.message ?? `Server said ${s.status}, try again.`);
				return b;
			}));
			const res = await put(sess.uploadUrl, file, type, (p) => (media[kind].pct = p));
			media[kind] = { ...media[kind], state: 'done', pct: 100, id: res.id, mime: res.mimeType ?? type, size: Number(res.size ?? file.size) };
		} catch (e) {
			media[kind] = { ...media[kind], state: 'error', err: e instanceof Error ? e.message : 'Upload failed, try again.' };
		}
	}

	let sessions: Promise<unknown> = Promise.resolve();

	function picked(kind: MediaKind, e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const f = el.files?.[0];
		el.value = '';
		if (f) upload(kind, f);
	}

	async function save() {
		if (blocker || saving) return;
		saving = true;
		err = '';
		try {
			const res = await fetch(`/api/rto/${r.id}/claim`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					reason,
					items: ticked,
					restock: restockOthers ? untouched.map((i) => i.id) : [],
					media: EVIDENCE.map((e) => ({ kind: e.kind, id: media[e.kind].id, mime: media[e.kind].mime, size: media[e.kind].size })),
					note: note.trim(),
					scanned
				})
			});
			const b = await res.json().catch(() => ({}));
			if (!res.ok) {
				err = b?.message ?? `Could not save (${res.status})`;
				saving = false;
				return;
			}
			try {
				localStorage.removeItem(KEY);
			} catch {
				/* ignore */
			}
			await goto(withUndo(backHref, b.event_id, `${orderLabel(r)} saved as RTO claim (Draft)`), { replaceState: true });
		} catch {
			err = 'No connection. Nothing was saved, try again.';
			saving = false;
		}
	}

	const pay = $derived(paymentBreakdown(r));
	const sizeText = (n?: number) => (n ? (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : '');
</script>

<svelte:head><title>RTO claim {orderLabel(r)} · DRC</title></svelte:head>

<div class="app">
	<header class="topbar">
		<a class="back" href={backHref} aria-label="Back">‹</a>
		<h1>RTO claim · {orderLabel(r)}</h1>
		<span class="pill p-mute">{pay.label}</span>
	</header>

	<main class="content">
		{#if open}
			<div class="card stop">
				<b>{orderLabel(r)} already has an open claim</b>
				<p class="small muted">{claimReasonLabel(open.reason)} · {claimStatus(open.status).label}. Open the RTO page to see it.</p>
				<a class="btn" href={backHref}>Back</a>
			</div>
		{:else if noCourier}
			<div class="card stop">
				<b>No courier for this RTO</b>
				<p class="small muted">It comes from the old sheet (no AWB), so there is nothing to claim against. Use Hold with a note.</p>
				<a class="btn" href={backHref}>Back</a>
			</div>
		{:else}
			<div class="cols">
				<div class="col">
					<section class="card">
						<h2>1. Reason</h2>
						<div class="chips" role="radiogroup" aria-label="Reason">
							{#each REASONS as x (x.key)}
								<button type="button" role="radio" aria-checked={reason === x.key} class="chip" class:on={reason === x.key} onclick={() => (reason = x.key)}>{x.label}</button>
							{/each}
						</div>
						{#if vType}<p class="small muted vt">Velocity dispute type: <b>{vType}</b></p>{/if}
					</section>

					<section class="card">
						<h2>2. Which items?</h2>
						{#if items.length}
							<p class="small muted sub">From the order. Tick the ones with the problem.</p>
							{#each items as it (it.id)}
								{@const on = ticked.includes(it.id)}
								<label class="item">
									<input type="checkbox" checked={on} onchange={() => toggle(it.id)} />
									<span class="box" class:on aria-hidden="true">{#if on}✓{/if}</span>
									<span class="itxt">
										<span class="iname" title={it.title}>{it.title}{#if it.is_gift}<span class="pill p-acc">Free gift</span>{/if}</span>
										<span class="small muted">Qty {it.qty}{asinOf(it.sku) ? ` · ${asinOf(it.sku)}` : it.sku ? ` · ${it.sku}` : ''}{it.ready_stock_state === 'in_stock' ? ' · already in Ready Stock' : ''}</span>
									</span>
								</label>
							{/each}
							{#if untouched.length && ticked.length}
								<label class="restock">
									<input type="checkbox" bind:checked={restockOthers} />
									<span class="box acc" class:on={restockOthers} aria-hidden="true">{#if restockOthers}✓{/if}</span>
									Put the {untouched.length} untouched item{untouched.length > 1 ? 's' : ''} into Ready Stock
								</label>
							{/if}
						{:else}
							<p class="small muted">No item list for this order. The claim covers the whole parcel.</p>
						{/if}
					</section>
				</div>

				<div class="col">
					<section class="card">
						<div class="h2row"><h2>3. Evidence</h2><span class="pill {doneCount === 4 ? 'p-ok' : 'p-bad'}">Required · {doneCount} of 4</span></div>
						<p class="small muted sub">Goes straight from the phone to the claim folder in Drive.</p>
						{#each EVIDENCE as e (e.kind)}
							{@const m = media[e.kind]}
							<div class="ev">
								<span class="thumb">
									{#if m.preview}<img src={m.preview} alt="" />{:else if e.video}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2"></rect></svg>
									{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg>{/if}
								</span>
								<span class="evtxt">
									<b>{e.label}</b>
									{#if m.state === 'uploading'}<span class="bar"><span style="width: {m.pct}%"></span></span><small class="muted">Uploading {m.pct}%</small>
									{:else if m.state === 'done'}<small class="okt">Saved to Drive{m.size ? ` · ${sizeText(m.size)}` : ''}</small>
									{:else if m.state === 'error'}<small class="bad">{m.err}</small>{/if}
								</span>
								<span class="evact">
									{#if e.video}
										{#if m.state !== 'uploading'}
											<button type="button" class="act" class:redo={m.state === 'done'} onclick={() => (recorder = true)}>{m.state === 'done' ? 'Redo' : 'Record'}</button>
										{/if}
										<input class="hide" type="file" accept="video/*" capture="environment" bind:this={inputs.video} onchange={(ev) => picked('unboxing_video', ev)} />
										<input class="hide" type="file" accept="video/*" bind:this={inputs.videoFile} onchange={(ev) => picked('unboxing_video', ev)} />
									{:else}
										{#if m.state !== 'uploading'}
											<button type="button" class="act" class:redo={m.state === 'done'} onclick={() => (camera = e.kind)}>{m.state === 'done' ? 'Retake' : 'Take'}</button>
										{/if}
										<input class="hide" type="file" accept="image/*" capture="environment" bind:this={inputs[e.kind]} onchange={(ev) => picked(e.kind, ev)} />
										<input class="hide" type="file" accept="image/*" bind:this={inputs[e.kind + 'File']} onchange={(ev) => picked(e.kind, ev)} />
									{/if}
								</span>
							</div>
							{#if m.state !== 'uploading'}
								<div class="alt">
									{#if e.video}
										<button type="button" class="link" onclick={() => inputs.video?.click()}>Camera app</button>
										<button type="button" class="link" onclick={() => inputs.videoFile?.click()}>Choose file</button>
									{:else}
										<button type="button" class="link" onclick={() => inputs[e.kind]?.click()}>Camera app</button>
										<button type="button" class="link" onclick={() => inputs[e.kind + 'File']?.click()}>Choose file</button>
									{/if}
								</div>
							{/if}
						{/each}
						<p class="small muted foot">Packing video from DROPPY-Log is added to the folder as a shortcut.</p>
					</section>

					<section class="card sum">
						<div><span class="muted">Claim value (full order)</span><b class="money">{inr(num(r.order_value))}</b></div>
						<div><span class="muted">Courier</span><b>{r.courier === 'velocity' ? 'Velocity' : r.courier}{r.carrier_name ? ` · ${r.carrier_name}` : ''}</b></div>
						<div><span class="muted">Saves as</span><b>Claim, Draft</b></div>
						<label class="small muted" for="cnote">Note (optional)</label>
						<input id="cnote" bind:value={note} maxlength="500" placeholder="e.g. box was resealed with brown tape" />
					</section>

					{#if err}<p class="err" role="alert">{err}</p>{/if}
					<button type="button" class="save" class:ready={!blocker} disabled={!!blocker || saving} onclick={save}>
						{saving ? 'Saving…' : blocker ?? 'Save claim'}
					</button>
				</div>
			</div>
		{/if}
	</main>
</div>
<BottomNav active={backHref.startsWith('/scan') ? 'scan' : 'all'} />

{#if camera}
	<PhotoCamera
		label={EVIDENCE.find((x) => x.kind === camera)?.label ?? 'Photo'}
		onclose={() => (camera = null)}
		onfile={(f) => {
			const k = camera!;
			camera = null;
			upload(k, f);
		}}
	/>
{/if}

{#if recorder}
	<VideoRecorder
		onclose={() => (recorder = false)}
		onfile={(f) => {
			recorder = false;
			upload('unboxing_video', f);
		}}
	/>
{/if}

<style>
	.back { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-size: 22px; flex: none; }
	.topbar h1 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.cols, .col { display: flex; flex-direction: column; gap: 12px; }
	h2 { margin: 0 0 8px; font-size: 14px; font-weight: 700; }
	.h2row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
	.h2row h2 { margin: 0; }
	.sub { margin: 2px 0 6px; }
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { height: 40px; padding: 0 13px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 600; font-size: 13.5px; cursor: pointer; }
	.chip.on { background: var(--bad); border-color: var(--bad); color: #fff; }
	.vt { margin: 8px 0 0; }
	.item, .restock { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; position: relative; }
	.item { padding: 10px 0; border-top: 1px solid var(--line); }
	.item input, .restock input, .hide { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
	.box { width: 24px; height: 24px; flex: none; border-radius: 7px; border: 2px solid var(--line); background: var(--surface); display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 14px; }
	.box.on { border-color: var(--bad); background: var(--bad); }
	.box.acc.on { border-color: var(--acc); background: var(--acc); }
	.item input:focus-visible + .box, .restock input:focus-visible + .box { outline: 2px solid var(--acc); outline-offset: 2px; }
	.itxt { min-width: 0; flex: 1; display: flex; flex-direction: column; }
	.iname { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.iname .pill { margin-left: 6px; vertical-align: 1px; }
	.restock { align-items: center; margin-top: 6px; padding: 10px 12px; border-radius: 12px; background: var(--acc-soft); font-size: 13.5px; font-weight: 600; }
	.ev { display: flex; align-items: center; gap: 10px; padding: 9px 0 2px; border-top: 1px solid var(--line); }
	.thumb { width: 40px; height: 40px; flex: none; border-radius: 10px; background: var(--sunk); display: grid; place-items: center; overflow: hidden; }
	.thumb img { width: 100%; height: 100%; object-fit: cover; }
	.thumb svg { width: 18px; height: 18px; fill: none; stroke: var(--ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.evtxt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
	.evtxt small { font-size: 12.5px; }
	.okt { color: var(--ok); font-weight: 600; }
	.bad { color: var(--bad); font-weight: 600; }
	.bar { height: 6px; border-radius: 3px; background: var(--sunk); overflow: hidden; }
	.bar span { display: block; height: 100%; background: var(--acc); transition: width 0.2s; }
	.act { height: 40px; min-width: 84px; padding: 0 14px; border-radius: 12px; border: 0; background: var(--bad); color: #fff; font-weight: 700; font-size: 14px; cursor: pointer; }
	.act.redo { background: var(--surface); color: var(--ink); border: 1px solid var(--line); }
	.alt { display: flex; justify-content: flex-end; gap: 14px; padding: 0 0 8px 50px; }
	.link { background: none; border: 0; padding: 4px 0; color: var(--acc); font-weight: 600; font-size: 12.5px; cursor: pointer; }
	.foot { margin: 6px 0 0; }
	.sum { display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }
	.sum > div { display: flex; justify-content: space-between; gap: 10px; }
	.sum label { margin-top: 6px; }
	.sum input { height: 44px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 0 12px; font-size: 14.5px; }
	.save { height: 52px; border: 0; border-radius: 14px; background: var(--sunk); color: var(--muted); font-weight: 700; font-size: 15px; }
	.save.ready { background: var(--bad); color: #fff; cursor: pointer; }
	.save:disabled.ready { opacity: 0.7; cursor: wait; }
	.err { color: var(--bad); font-weight: 600; margin: 0; }
	.stop { display: flex; flex-direction: column; gap: 8px; }
	.stop p { margin: 0; }
	@media (min-width: 1024px) {
		.content { max-width: 1100px; }
		.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
		.col { gap: 16px; }
		.card { padding: 18px 20px; }
	}
</style>
