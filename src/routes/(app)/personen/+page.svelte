<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Topbar from '$lib/components/Topbar.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import MultiCheckSelect from '$lib/components/MultiCheckSelect.svelte';

	let { data } = $props();

	let q = $state(data.q);
	let showFilter = $state(false);

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
		<a class="btn btn-primary btn-sm" href="/personen/neu"><span aria-hidden="true">+</span> Neue Person</a>
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
		<ul class="flex flex-col gap-2">
			{#each data.items as p (p.id)}
				<li>
					<a
						href={`/personen/${p.id}`}
						class="lift flex items-center gap-2.5 rounded-xl border border-line bg-card p-2.5 hover:bg-bg"
					>
						<span class="flex-none" style="view-transition-name: person-{p.id}">
							<Avatar person={{ name: p.name, profileImageUrl: p.image }} />
						</span>
						<span class="min-w-0 flex-1">
							<b class="block truncate">{p.name}</b>
							<span class="block truncate text-xs text-mut">
								{p.city ?? 'Kein Ort'} · {p.degree} {p.degree === 1 ? 'Verbindung' : 'Verbindungen'}
							</span>
							{#if p.aliases.length}
								<span class="block truncate text-[11px] text-mut">Alias: {p.aliases.join(', ')}</span>
							{/if}
						</span>
						<span class="text-mut">›</span>
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
