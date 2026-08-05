<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Topbar from '$lib/components/Topbar.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import MultiCheckSelect from '$lib/components/MultiCheckSelect.svelte';

	let { data, form } = $props();

	let q = $state(data.q);
	let showFilter = $state(false);

	// Mehrfachauswahl zum Bulk-Löschen (SCR-010b Erweiterung).
	let selectMode = $state(false);
	let selected = $state<Set<number>>(new Set());
	let confirmBulkDelete = $state(false);
	let bulkAck = $state(false);

	function toggleSelectMode() {
		selectMode = !selectMode;
		selected = new Set();
	}
	function toggleSelected(id: number) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}
	function selectAll() {
		selected = new Set(data.items.map((p) => p.id));
	}
	function clearSelection() {
		selected = new Set();
	}
	const selectedDegreeSum = $derived(
		data.items.filter((p) => selected.has(p.id)).reduce((sum, p) => sum + p.degree, 0)
	);

	// Build a query string from the current controls and navigate (keeps URL shareable).
	function apply(overrides: Record<string, string | undefined> = {}) {
		const params = new URLSearchParams();
		const next = { q, ort: data.ort.join(','), typ: data.typ.join(','), sort: data.sort, ...overrides };
		for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
		goto(`/personen?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	function toggleSort() {
		apply({ sort: data.sort === 'asc' ? 'desc' : 'asc' });
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearch() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => apply({ q }), 250);
	}

	const hasResults = $derived(data.items.length > 0);
	const isFiltering = $derived(!!(data.q || data.ort.length || data.typ.length));
</script>

<svelte:head><title>Personen – RelaTable</title></svelte:head>

<Topbar title="Personen" subtitle={String(data.total)}>
	<button class="btn btn-sm" onclick={toggleSort}>Name {data.sort === 'asc' ? '↑' : '↓'}</button>
	<button class="btn btn-sm {selectMode ? 'bg-accent/20 text-ink' : ''}" onclick={toggleSelectMode}>
		{selectMode ? 'Auswahl beenden' : 'Mehrfachauswahl'}
	</button>
	<a class="btn btn-primary btn-sm" href="/personen/neu">+ Neue Person</a>
</Topbar>

<div class="flex-1 overflow-auto p-3.5">
	<!-- Search + filter row -->
	<div class="mb-3 flex flex-wrap items-center gap-2">
		<input
			class="inp max-w-xs flex-1"
			placeholder="Suche nach Name…"
			bind:value={q}
			oninput={onSearch}
			aria-label="Suche nach Name"
		/>
		{#if data.ort.length || data.typ.length}
			<button class="chip border-dashed" onclick={() => apply({ ort: undefined, typ: undefined })}>Filter zurücksetzen ✕</button>
		{/if}
		<button class="chip border-dashed" onclick={() => (showFilter = !showFilter)}>+ Filter</button>
	</div>

	{#if showFilter}
		<div class="card mb-3 flex flex-wrap gap-4 p-3 text-sm">
			<label class="flex flex-col gap-1">
				<span class="label">Ort</span>
				<MultiCheckSelect label="Ort" options={data.cities} selected={data.ort} onChange={(v) => apply({ ort: v.join(',') || undefined })} />
			</label>
			<label class="flex flex-col gap-1">
				<span class="label">Beziehungstyp</span>
				<MultiCheckSelect label="Beziehungstyp" options={data.typeOptions} selected={data.typ} onChange={(v) => apply({ typ: v.join(',') || undefined })} />
			</label>
		</div>
	{/if}

	{#if hasResults}
		{#if selectMode}
			<div class="mb-2 flex items-center gap-2 text-xs text-mut">
				<button class="chip border-dashed" onclick={selectAll}>Alle auswählen</button>
				<button class="chip border-dashed" onclick={clearSelection}>Auswahl leeren</button>
			</div>
		{/if}
		{#if form?.bulkError}<p class="mb-2 text-[11px] text-warn">{form.bulkError}</p>{/if}
		<ul class="flex flex-col gap-2">
			{#each data.items as p (p.id)}
				<li>
					<a
						href={`/personen/${p.id}`}
						onclick={(e) => {
							if (selectMode) {
								e.preventDefault();
								toggleSelected(p.id);
							}
						}}
						class="flex items-center gap-2.5 rounded-lg border border-line bg-card p-2.5 hover:bg-bg {selectMode && selected.has(p.id) ? 'border-accent bg-accent/10' : ''}"
					>
						{#if selectMode}
							<input
								type="checkbox"
								checked={selected.has(p.id)}
								onclick={(e) => e.stopPropagation()}
								onchange={() => toggleSelected(p.id)}
								class="shrink-0"
								aria-label={`${p.name} auswählen`}
							/>
						{/if}
						<Avatar person={{ name: p.name, profileImageUrl: p.image }} />
						<span class="min-w-0 flex-1">
							<b class="block truncate">{p.name}</b>
							<span class="block truncate text-xs text-mut">
								{p.city ?? 'Kein Ort'} · {p.degree} {p.degree === 1 ? 'Verbindung' : 'Verbindungen'}
							</span>
							{#if p.aliases.length}
								<span class="block truncate text-[11px] text-mut">Alias: {p.aliases.join(', ')}</span>
							{/if}
						</span>
						{#if !selectMode}<span class="text-mut">›</span>{/if}
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<!-- Empty state (SCR-010b) -->
		<div class="card flex flex-col items-center justify-center gap-3 p-10 text-center">
			{#if isFiltering}
				<p class="text-mut">Kein Suchtreffer.</p>
				<a class="btn" href="/personen">Filter zurücksetzen</a>
			{:else}
				<p class="text-mut">Noch keine Personen.</p>
				<a class="btn btn-primary" href="/personen/neu">+ Erste Person anlegen</a>
			{/if}
		</div>
	{/if}
</div>

{#if selectMode && selected.size > 0}
	<div class="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-line bg-card p-3 shadow-lg">
		<span class="text-sm">{selected.size} {selected.size === 1 ? 'Person' : 'Personen'} ausgewählt</span>
		<div class="flex gap-2">
			<button class="btn btn-sm" onclick={clearSelection}>Abwählen</button>
			<button class="btn btn-warn btn-sm" onclick={() => { confirmBulkDelete = true; bulkAck = false; }}>Löschen</button>
		</div>
	</div>
{/if}

<!-- Bulk-delete confirm dialog, matches the single-person delete dialog on /personen/[id] (SCR-013). -->
{#if confirmBulkDelete}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
		<div class="card w-full max-w-md">
			<div class="border-b border-line p-3.5 font-semibold">{selected.size} {selected.size === 1 ? 'Person' : 'Personen'} löschen?</div>
			<div class="p-3.5">
				<div class="rounded-md border border-warn bg-warn/10 p-2.5 text-[13px] text-warn">
					Betroffen: mindestens <b>{selectedDegreeSum} {selectedDegreeSum === 1 ? 'Verbindung' : 'Verbindungen'}</b> (Summe über alle ausgewählten Personen).
				</div>
				<p class="mt-2.5 text-xs text-mut">
					Beziehungen, Ereignis-Teilnahmen, Aliase und Tagebuch-Einträge dieser Personen werden mitgelöscht bzw. entfernt. Ereignisse selbst bleiben erhalten, verlieren aber die gelöschten Teilnehmer.
				</p>
				<label class="mt-2.5 flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={bulkAck} /> Ich verstehe die Auswirkungen.
				</label>
			</div>
			<div class="flex justify-end gap-2 border-t border-line p-3.5">
				<button class="btn" onclick={() => (confirmBulkDelete = false)}>Abbrechen</button>
				<form
					method="POST"
					action="?/bulkDelete"
					use:enhance={() => async ({ update }) => {
						confirmBulkDelete = false;
						selectMode = false;
						selected = new Set();
						await update();
					}}
				>
					{#each [...selected] as id}
						<input type="hidden" name="ids" value={id} />
					{/each}
					<button class="btn btn-warn" disabled={!bulkAck}>Endgültig löschen</button>
				</form>
			</div>
		</div>
	</div>
{/if}
