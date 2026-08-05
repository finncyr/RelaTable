<script lang="ts">
	import Topbar from '$lib/components/Topbar.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import PairActions from '$lib/components/PairActions.svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let tab = $state<'verlauf' | 'events' | 'tagebuch'>('verlauf');
	let onlyTwo = $state(false);
	let showSensitive = $state(false);

	const visibleEvents = $derived(
		data.events.filter((e) => (!onlyTwo || e.exactlyTwo) && (showSensitive || !e.sensitive))
	);
	const hiddenSensitive = $derived(data.events.filter((e) => e.sensitive).length);
	const pairTitle = $derived(`${data.persons.low.name} & ${data.persons.high.name}`);
</script>

<svelte:head><title>{pairTitle} – RelaTable</title></svelte:head>

<Topbar title={pairTitle} back={{ href: '/graph', label: 'Graph' }} />

<div class="flex min-h-0 flex-1">
	<!-- Desktop graph context (decorative) -->
	<div class="relative hidden flex-1 bg-bg md:block">
		<svg viewBox="0 0 260 300" class="h-full w-full" preserveAspectRatio="xMidYMid meet">
			<defs>
				<clipPath id="pair-clip-low"><circle cx="80" cy="110" r="26" /></clipPath>
				<clipPath id="pair-clip-high"><circle cx="180" cy="190" r="26" /></clipPath>
			</defs>
			<line x1="80" y1="110" x2="180" y2="190" stroke={data.color} stroke-width="5" />
			{#each [{ p: data.persons.low, cx: 80, cy: 110, clip: 'pair-clip-low' }, { p: data.persons.high, cx: 180, cy: 190, clip: 'pair-clip-high' }] as { p, cx, cy, clip }}
				<g class="cursor-pointer" role="link" tabindex="-1"
					oncontextmenu={(e) => { e.preventDefault(); goto(`/personen/${p.id}/bearbeiten`); }}>
					<circle {cx} {cy} r="26" fill="#fff" />
					{#if p.image}
						<image href={p.image} x={cx - 26} y={cy - 26} width="52" height="52"
							preserveAspectRatio="xMidYMid slice" clip-path="url(#{clip})" />
					{:else}
						<!-- Generic person glyph fallback -->
						<g fill={data.color}>
							<circle cx={cx} cy={cy - 7} r="8" />
							<path d="M{cx - 13} {cy + 18} a13 13 0 0 1 26 0 z" />
						</g>
					{/if}
					<circle {cx} {cy} r="26" fill="none" stroke={data.color} stroke-width="3" />
					<text x={cx} y={cy + 45} text-anchor="middle" font-size="11" fill="currentColor">{p.name.split(' ')[0]}</text>
				</g>
			{/each}
		</svg>
	</div>

	<!-- Panel -->
	<div class="flex w-full flex-col border-l border-line bg-card md:w-[420px] md:flex-none">
		<div class="flex items-center gap-2 border-b border-line bg-bg/40 px-3 py-2.5">
			<Avatar person={{ name: data.persons.low.name, profileImageUrl: data.persons.low.image }} size={30} />
			<span class="-ml-3"><Avatar person={{ name: data.persons.high.name, profileImageUrl: data.persons.high.image }} size={30} /></span>
			<b class="ml-1.5">{pairTitle}</b>
		</div>

		<div class="overflow-auto p-3">
			{#if true}
				<div class="flex items-center gap-2">
					{#if data.current}
						<span class="inline-block rounded-full border px-2.5 py-0.5 text-[11px]" style="border-color:{data.color};color:{data.color}">
							Aktuell: {data.current}
						</span>
					{:else if data.exists}
						<span class="chip">Keine aktive Beziehung</span>
					{:else}
						<span class="chip">Noch keine Verbindung</span>
					{/if}
					<span class="flex-1"></span>
					<a class="btn btn-sm" href={`/ereignisse/neu?with=${data.persons.low.id},${data.persons.high.id}`}>+ Event</a>
				</div>

				<!-- Action menu (rule-enforced relationship actions) -->
				<PairActions catalog={data.catalog} persons={data.persons} activePeriods={data.activePeriods} hasRomance={data.hasRomance} {form} />

				{#if data.exists}
					<form method="POST" action="?/deleteConnection" use:enhance
						onsubmit={(e) => { if (!confirm('Verbindung versehentlich angelegt? Sie wird komplett gelöscht, ohne Eintrag im Verlauf.')) e.preventDefault(); }}>
						<button class="btn btn-sm mt-2 text-warn" type="submit">Verbindung ohne Eintrag beenden</button>
					</form>
				{/if}

				<!-- Tabs -->
				<div class="mt-3 flex overflow-hidden rounded-md border border-line text-xs">
					<button class="flex-1 py-1.5 {tab === 'verlauf' ? 'bg-line/60 font-semibold' : ''}" onclick={() => (tab = 'verlauf')}>Verlauf</button>
					<button class="flex-1 border-l border-line py-1.5 {tab === 'events' ? 'bg-line/60 font-semibold' : ''}" onclick={() => (tab = 'events')}>Events</button>
					<button class="flex-1 border-l border-line py-1.5 {tab === 'tagebuch' ? 'bg-line/60 font-semibold' : ''}" onclick={() => (tab = 'tagebuch')}>Tagebuch</button>
				</div>

				{#if tab === 'verlauf'}
					<div class="mt-3">
						<h4 class="mb-1.5 text-[13px] font-semibold">Beziehungsverlauf</h4>
						<ol class="ml-1.5 border-l-2 border-line pl-3">
							{#each data.history as h}
								<li class="relative mb-2.5">
									<span class="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-mut"></span>
									{#if h.who}<span class="text-mut">{h.who} ist</span>{/if}
									<b>{h.type}</b>
									<span class="text-mut"> · {h.to ? `${h.from} – ${h.to}` : `seit ${h.from}`}{h.active ? ' (aktiv)' : ''}</span>
								</li>
							{:else}
								<li class="text-xs text-mut">Kein Verlauf.</li>
							{/each}
						</ol>
						{#if data.history.length > 0}
							<form method="POST" action="?/clearHistory" use:enhance
								onsubmit={(e) => { if (!confirm('Verlauf komplett leeren? Alle Beziehungsphasen dieser Verbindung werden unwiderruflich gelöscht.')) e.preventDefault(); }}>
								<button class="btn btn-sm mt-2 text-warn" type="submit">Verlauf leeren</button>
							</form>
						{/if}
					</div>
				{:else if tab === 'events'}
					<div class="mt-3">
						<div class="mb-2 flex overflow-hidden rounded-md border border-line text-[11px]">
							<button class="px-2.5 py-1 {!onlyTwo ? 'bg-line/60 font-semibold' : ''}" onclick={() => (onlyTwo = false)}>Alle gemeinsamen</button>
							<button class="border-l border-line px-2.5 py-1 {onlyTwo ? 'bg-line/60 font-semibold' : ''}" onclick={() => (onlyTwo = true)}>Nur exakt diese zwei</button>
						</div>
						{#if hiddenSensitive > 0}
							<button class="chip mb-2" onclick={() => (showSensitive = !showSensitive)}>⊙ Sensible: {showSensitive ? 'an' : 'aus'}</button>
						{/if}
						<ol class="ml-1.5 border-l-2 border-line pl-3">
							{#each visibleEvents as e (e.id)}
								<li class="relative mb-2.5">
									<span class="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-mut"></span>
									{#if e.sensitive}🔒 {/if}<b>{e.name}</b>
									<span class="text-mut"> · {e.when} · {e.exactlyTwo ? 'nur diese zwei' : `+${e.others} weitere`}</span>
								</li>
							{:else}
								<li class="text-xs text-mut">Keine gemeinsamen Ereignisse.</li>
							{/each}
							{#if hiddenSensitive > 0 && !showSensitive}
								<li class="text-xs text-mut">🔒 {hiddenSensitive} sensibles Ereignis verborgen</li>
							{/if}
						</ol>
					</div>
				{:else}
					<div class="mt-3">
						<h4 class="mb-1.5 text-[13px] font-semibold">Beziehungstagebuch</h4>
						<ol class="ml-1.5 border-l-2 border-line pl-3">
							{#each data.journal as j}
								<li class="relative mb-2.5">
									<span class="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-mut"></span>
									<b>{j.title}</b> <span class="text-mut">· {j.when}</span>
									{#if j.note}<div class="text-xs text-mut">{j.note}</div>{/if}
								</li>
							{:else}
								<li class="text-xs text-mut">Keine Tagebucheinträge.</li>
							{/each}
						</ol>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
