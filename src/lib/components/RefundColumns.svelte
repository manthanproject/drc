<script lang="ts">
	import { untrack } from 'svelte';
	import { BUILTIN, COL_TYPES, newColKey, type ColumnsSetting, type ColType, type CustomCol } from '#lib/refunds.ts';

	let { columns, onsaved, onclose }: { columns: ColumnsSetting; onsaved: (c: ColumnsSetting) => void; onclose: () => void } = $props();

	const start = untrack(() => columns);
	let custom = $state<CustomCol[]>(start.custom.map((c) => (c.options ? { ...c, options: [...c.options] } : { ...c })));
	let hidden = $state<string[]>([...start.hidden]);
	let label = $state('');
	let type = $state<ColType>('text');
	let opts = $state('');
	let busy = $state(false);
	let err = $state('');
	let sure = $state('');

	const toggle = (k: string) => (hidden = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]);

	function add() {
		err = '';
		const l = label.trim();
		if (!l) return (err = 'Type a column name');
		const options = type === 'choice' ? opts.split(',').map((o) => o.trim()).filter(Boolean) : undefined;
		if (type === 'choice' && !options?.length) return (err = 'Type the choices, separated by commas');
		custom = [...custom, options ? { key: newColKey(), label: l, type, options } : { key: newColKey(), label: l, type }];
		label = '';
		opts = '';
		type = 'text';
	}
	function remove(k: string) {
		if (sure !== k) return (sure = k);
		custom = custom.filter((c) => c.key !== k);
		hidden = hidden.filter((x) => x !== k);
		sure = '';
	}
	function move(i: number, d: number) {
		const j = i + d;
		if (j < 0 || j >= custom.length) return;
		const c = [...custom];
		[c[i], c[j]] = [c[j], c[i]];
		custom = c;
	}

	async function save() {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const r = await fetch('/api/refunds/columns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ custom, hidden }) });
			const b = await r.json().catch(() => ({}));
			if (!r.ok) {
				err = b?.message ?? `Could not save (${r.status})`;
				return;
			}
			onsaved(b);
		} catch {
			err = 'No connection. Nothing saved.';
		} finally {
			busy = false;
		}
	}
</script>

<section class="cp" aria-label="Columns">
	<div class="hd"><b>Columns</b><span class="small muted">Show or hide any column. Add your own; deleting one keeps its old values in DRC.</span></div>
	<ul>
		{#each BUILTIN as c (c.key)}
			<li>
				<span>{c.label}</span>
				{#if c.fixed}<span class="small muted">always shown</span>{:else}
					<label class="tg"><input type="checkbox" checked={!hidden.includes(c.key)} onchange={() => toggle(c.key)} /> Show</label>
				{/if}
			</li>
		{/each}
		{#each custom as c, i (c.key)}
			<li class="mine">
				<span>{c.label} <span class="small muted">{COL_TYPES[c.type]}{c.options ? `: ${c.options.join(', ')}` : ''}</span></span>
				<span class="ops">
					<button type="button" class="mini" aria-label="Move {c.label} up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
					<button type="button" class="mini" aria-label="Move {c.label} down" disabled={i === custom.length - 1} onclick={() => move(i, 1)}>↓</button>
					<label class="tg"><input type="checkbox" checked={!hidden.includes(c.key)} onchange={() => toggle(c.key)} /> Show</label>
					<button type="button" class="mini bad" onclick={() => remove(c.key)}>{sure === c.key ? 'Sure? Delete' : 'Delete'}</button>
				</span>
			</li>
		{/each}
	</ul>
	<div class="add">
		<label class="fld">New column<input bind:value={label} maxlength="40" placeholder="e.g. Ticket no., Handled by" /></label>
		<label class="fld">Type
			<select bind:value={type}>{#each Object.entries(COL_TYPES) as [k, v] (k)}<option value={k}>{v}</option>{/each}</select>
		</label>
		{#if type === 'choice'}<label class="fld wide">Choices (comma separated)<input bind:value={opts} maxlength="400" placeholder="e.g. High, Normal, Low" /></label>{/if}
		<button type="button" class="go" onclick={add}>+ Add column</button>
	</div>
	{#if err}<p class="err" role="alert">{err}</p>{/if}
	<div class="acts">
		<button type="button" class="go accb" disabled={busy} onclick={save}>{busy ? 'Saving…' : 'Save columns'}</button>
		<button type="button" class="go" disabled={busy} onclick={onclose}>Cancel</button>
	</div>
</section>

<style>
	.cp { display: flex; flex-direction: column; gap: 12px; }
	.hd { display: flex; flex-direction: column; gap: 2px; }
	ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
	li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--line); font-size: 14px; }
	li:first-child { border-top: 0; }
	.ops { display: flex; align-items: center; gap: 6px; }
	.tg { display: flex; align-items: center; gap: 6px; font-size: 13.5px; min-height: 36px; cursor: pointer; }
	.tg input { width: 18px; height: 18px; accent-color: var(--acc); }
	.mini { min-width: 36px; min-height: 36px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; cursor: pointer; }
	.mini:disabled { opacity: 0.4; }
	.mini.bad { color: var(--bad); padding: 0 10px; }
	.add { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
	.fld { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; flex: 1; min-width: 160px; }
	.fld.wide { flex-basis: 100%; }
	.fld input, .fld select { height: 42px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); padding: 0 10px; font-size: 14px; font-weight: 400; }
	.acts { display: flex; gap: 8px; }
	.go { min-height: 42px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 14px; cursor: pointer; }
	.go:disabled { opacity: 0.55; }
	.accb { background: var(--acc); border-color: var(--acc); color: #fff; }
	.err { color: var(--bad); font-weight: 600; margin: 0; }
</style>
