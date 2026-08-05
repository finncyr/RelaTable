<script lang="ts">
	import { goto } from '$app/navigation';
	import Topbar from '$lib/components/Topbar.svelte';

	let { data } = $props();
	let q = $state(data.q);
	let showSensitive = $state(false);

	function apply(overrides: Record<string, string | undefined> = {}) {
		const params = new URLSearchParams();
		const next = { q, typ: data.typ, ...overrides };
		for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
		goto(`/ereignisse?${params.toString()}`, { keepFocus: true, noScroll: true });
	}
	let timer: ReturnType<typeof setTimeout>;
	function onSearch() {
		clearTimeout(timer);
		timer = setTimeout(() => apply({ q }), 250);
	}

	const ICONS: Record<string, string> = {
		Urlaub: '🏖',
		Party: '🥳',
		'Konzert/Festival': '🎵',
		Convention: '🎟',
		Sex: '🔒',
		Generisch: '★'
	};
	const visible = $derived(data.items.filter((e) => showSensitive || !e.sensitive));
	const hiddenCount = $derived(data.items.filter((e) => e.sensitive).length);
</script>

<svelte:head><title>Ereignisse – RelaTable</title></svelte:head>

<Topbar title="Ereignisse" subtitle={String(data.items.length)}>
	<button class="chip" onclick={() => (showSensitive = !showSensitive)}>⊙ Sensible: {showSensitive ? 'an' : 'aus'}</button>
	<a class="btn btn-primary btn-sm" href="/ereignisse/neu">+ Neues Ereignis</a>
</Topbar>

<div class="flex-1 overflow-auto p-3.5">
	<div class="mb-3 flex flex-wrap items-center gap-2">
		<input class="inp max-w-xs flex-1" placeholder="Suche…" bind:value={q} oninput={onSearch} aria-label="Ereignis suchen" />
		<select class="inp w-auto" value={data.typ} onchange={(e) => apply({ typ: e.currentTarget.value || undefined })}>
			<option value="">Alle Typen</option>
			{#each data.typeOptions as t}<option value={t}>{t}</option>{/each}
		</select>
	</div>

	{#if visible.length > 0}
		<ul class="stagger flex flex-col gap-2">
			{#each visible as e, i (e.id)}
				<li style="--i:{i}">
					<a href={`/ereignisse/${e.id}`} class="lift flex items-center gap-2.5 rounded-xl border border-line bg-card p-2.5 hover:bg-bg">
						<span class="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-line bg-bg text-[15px]">{ICONS[e.typeName] ?? '★'}</span>
						<span class="min-w-0 flex-1">
							<b class="block truncate">{e.sensitive ? '🔒 ' : ''}{e.name}</b>
							<span class="block truncate text-xs text-mut">{e.when}{e.city ? ` · ${e.city}` : ''}{e.participants ? ` · ${e.participants}` : ''}</span>
						</span>
						<span class="text-mut">›</span>
					</a>
				</li>
			{/each}
		</ul>
		{#if hiddenCount > 0 && !showSensitive}
			<p class="mt-2 text-xs text-mut">🔒 {hiddenCount} sensibles Ereignis verborgen — Toggle oben aktivieren.</p>
		{/if}
	{:else}
		<div class="card flex flex-col items-center justify-center gap-3 p-10 text-center">
			<p class="text-mut">Noch keine Ereignisse.</p>
			<a class="btn btn-primary" href="/ereignisse/neu">+ Erstes Ereignis anlegen</a>
		</div>
	{/if}
</div>
