<script lang="ts">
	import { untrack } from 'svelte';
	import { STATUSES, STATUS, VIA, TO, REASON_CHIPS, type Refund, type ColumnsSetting } from '#lib/refunds.ts';

	type Saved = { log_id: number; text: string };
	let {
		refund = null,
		columns,
		order = '',
		onsaved,
		oncancel
	}: { refund?: Refund | null; columns: ColumnsSetting; order?: string; onsaved: (r: Saved) => void; oncancel: () => void } = $props();

	const r0 = untrack(() => refund);
	let orderNo = $state(r0?.order_no ?? untrack(() => order));
	let status = $state<string>(r0?.status ?? 'to_refund');
	let reason = $state(r0?.reason ?? '');
	let via = $state(r0?.via ?? '');
	let to = $state(r0?.refund_to ?? 'original');
	let amount = $state(r0?.amount == null ? '' : String(Number(r0.amount)));
	let doneRef = $state(r0?.done_ref ?? '');
	let extra = $state<Record<string, string>>(Object.fromEntries(untrack(() => columns).custom.map((c) => [c.key, r0?.extra?.[c.key] == null ? '' : String(r0.extra[c.key])])));
	let busy = $state(false);
	let err = $state('');
	let sure = $state(false);
	const uid = Math.random().toString(36).slice(2, 8);

	async function post(body: Record<string, unknown>) {
		const r = await fetch('/api/refunds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const b = await r.json().catch(() => ({}));
		if (!r.ok) throw new Error(b?.message ?? `Could not save (${r.status})`);
		return b;
	}

	async function save() {
		if (busy) return;
		if (!orderNo.trim()) {
			err = 'Type the order number';
			return;
		}
		busy = true;
		err = '';
		try {
			const body = {
				action: r0 ? 'update' : 'create', id: r0?.id, order_no: orderNo, status, reason, via, refund_to: to, amount,
				done_ref: doneRef, extra
			};
			const b = await post(body);
			onsaved({ log_id: b.log_id, text: r0 ? `#${b.order_no ?? r0.order_no} saved` : `Refund added for #${b.order_no}` });
		} catch (e) {
			err = (e as Error).message || 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!r0 || busy) return;
		if (!sure) {
			sure = true;
			return;
		}
		busy = true;
		err = '';
		try {
			const b = await post({ action: 'delete', id: r0.id });
			onsaved({ log_id: b.log_id, text: `#${r0.order_no} deleted` });
		} catch (e) {
			err = (e as Error).message || 'No connection. Nothing deleted.';
		} finally {
			busy = false;
		}
	}
</script>

<form class="rf" onsubmit={(e) => { e.preventDefault(); save(); }}>
	<div class="row2">
		<label class="fld">Order no.
			<input bind:value={orderNo} maxlength="40" inputmode="numeric" placeholder="e.g. 3489" disabled={!!r0 && r0.source === 'rto'} />
		</label>
		<label class="fld">Amount (₹)
			<input bind:value={amount} inputmode="decimal" placeholder={r0 ? '' : 'Blank = order value for RTOs'} />
		</label>
	</div>

	<fieldset>
		<legend>Status</legend>
		<div class="chips">
			{#each STATUSES as s (s)}
				<button type="button" class="chip" class:on={status === s} aria-pressed={status === s} onclick={() => (status = s)}>{STATUS[s].label}</button>
			{/each}
		</div>
	</fieldset>

	<label class="fld">Reason
		<input bind:value={reason} maxlength="500" placeholder="Why the refund (or no refund)" />
	</label>
	<div class="chips small">
		{#each REASON_CHIPS as c (c)}<button type="button" class="chip sm" onclick={() => (reason = c)}>{c}</button>{/each}
	</div>

	{#if status !== 'no_refund'}
		<div class="row2">
			<fieldset>
				<legend>Pay from</legend>
				<div class="chips">
					{#each Object.entries(VIA) as [k, v] (k)}
						<button type="button" class="chip" class:on={via === k} aria-pressed={via === k} onclick={() => (via = via === k ? '' : k)}>{v}</button>
					{/each}
				</div>
			</fieldset>
			<fieldset>
				<legend>Refund to</legend>
				<div class="chips">
					{#each Object.entries(TO) as [k, v] (k)}
						<button type="button" class="chip" class:on={to === k} aria-pressed={to === k} onclick={() => (to = k)}>{v}</button>
					{/each}
				</div>
			</fieldset>
		</div>
	{/if}
	{#if status === 'done'}
		<label class="fld">Refund ref (UTR / PayU id), optional
			<input bind:value={doneRef} maxlength="120" placeholder="e.g. UTR 4567…" />
		</label>
	{/if}

	{#if columns.custom.length}
		<div class="row2">
			{#each columns.custom as c (c.key)}
				{#if c.type === 'choice'}
					<label class="fld">{c.label}
						<select bind:value={extra[c.key]}>
							<option value="">—</option>
							{#each c.options ?? [] as o (o)}<option value={o}>{o}</option>{/each}
						</select>
					</label>
				{:else}
					<label class="fld">{c.label}
						<input bind:value={extra[c.key]} type={c.type === 'date' ? 'date' : 'text'} inputmode={c.type === 'number' ? 'decimal' : undefined} maxlength="300" />
					</label>
				{/if}
			{/each}
		</div>
	{/if}

	{#if err}<p class="err" role="alert">{err}</p>{/if}
	<div class="acts">
		<button type="submit" class="go accb" disabled={busy}>{busy ? 'Saving…' : r0 ? 'Save' : 'Add refund'}</button>
		<button type="button" class="go" disabled={busy} onclick={oncancel}>Cancel</button>
		{#if r0}
			<span class="sp"></span>
			<button type="button" class="go del" disabled={busy} onclick={remove} id="del-{uid}">{sure ? 'Tap again to delete' : 'Delete row'}</button>
		{/if}
	</div>
</form>

<style>
	.rf { display: flex; flex-direction: column; gap: 12px; }
	.row2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
	.fld { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; }
	.fld input, .fld select { height: 44px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 0 12px; font-size: 15px; font-weight: 400; width: 100%; box-sizing: border-box; }
	fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
	legend { font-size: 13px; font-weight: 600; margin-bottom: 6px; padding: 0; }
	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip { min-height: 40px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-weight: 600; font-size: 13.5px; cursor: pointer; }
	.chip.on { border: 2px solid var(--acc); background: var(--acc-soft); }
	.chip.sm { min-height: 32px; font-size: 12.5px; font-weight: 500; }
	.chips.small { margin-top: -4px; }
	.acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.sp { flex: 1; }
	.go { min-height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 14px; cursor: pointer; }
	.go:disabled { opacity: 0.55; cursor: default; }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.del { color: var(--bad); border-color: var(--bad); }
	.err { color: var(--bad); font-weight: 600; margin: 0; }
</style>
