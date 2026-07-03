<script lang="ts">
	import 'leaflet/dist/leaflet.css';
	import 'leaflet.markercluster/dist/MarkerCluster.css';
	import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Topbar from '$lib/components/Topbar.svelte';

	let { data } = $props();

	let mapEl: HTMLDivElement;
	let legendEl = $state<HTMLDivElement | undefined>();
	let L: any = null;
	let map: any = null;
	let personCluster: any = null;
	let personDirectLayer: any = null;
	let eventCluster: any = null;
	let connectionLayer: any = null;

	let showPersons = $state(true);
	let showEvents = $state(true);
	let showSensitive = $state(false);
	let eventType = $state('');
	let filterOpen = $state(false); // mobile bottom-sheet
	let showConnectionsOnly = $state(false);
	let legendDimmed = $state(false);
	let showLegend = $state(true);

	const PERSON_COLOR = '#3a6ea5';
	const EVENT_COLOR = '#b06a2c';

	const eventTypes = $derived([...new Set(data.eventMarkers.map((e) => e.typeName))]);

	// Shared with graph's ?focus= / localStorage('graph.focus'), so a person focused in the graph
	// shows up here too — with just her own connections, at whatever zoom fits her network (no zoom-in).
	let focusId = $state<number | null>(null);
	const focusName = $derived(data.personMarkers.find((p) => p.id === focusId)?.name ?? null);
	const focusNeighborIds = $derived.by(() => {
		if (focusId == null) return null;
		const ids = new Set<number>([focusId]);
		for (const c of data.connectionSegments) {
			if (c.sourceId === focusId) ids.add(c.targetId);
			if (c.targetId === focusId) ids.add(c.sourceId);
		}
		return ids;
	});
	const visiblePersons = $derived(focusNeighborIds ? data.personMarkers.filter((p) => focusNeighborIds.has(p.id)) : data.personMarkers);
	const visibleConnections = $derived(
		focusNeighborIds ? data.connectionSegments.filter((c) => c.sourceId === focusId || c.targetId === focusId) : data.connectionSegments
	);
	// Focus behaves like "nur Verbindungen", just scoped to one person's network instead of all of them.
	const connectionsMode = $derived(showConnectionsOnly || focusId != null);
	const overlayVisible = $derived(connectionsMode || data.missing.persons > 0 || data.missing.events > 0);

	function setFocus(id: number) {
		focusId = id;
		localStorage.setItem('graph.focus', String(id));
		goto(`/karte?focus=${id}`, { noScroll: true, keepFocus: true, replaceState: true });
		// Bring the focused network into view, same "fit, don't zoom in tight" rule as the initial load.
		if (map && visiblePersons.length) {
			map.fitBounds(visiblePersons.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 11 });
		}
	}
	function clearFocus() {
		focusId = null;
		localStorage.removeItem('graph.focus');
		goto('/karte', { noScroll: true, keepFocus: true, replaceState: true });
	}

	// Search: same idea as the graph's Ctrl/Cmd+F — filter people by name, single hit focuses
	// directly, multiple hits list below and pan/zoom the map to fit them.
	let searchOpen = $state(false);
	let searchQ = $state('');
	let searchResults = $state<typeof data.personMarkers>([]);
	let searchActiveIdx = $state(-1);
	let searchInput = $state<HTMLInputElement | undefined>();
	let searchListEl = $state<HTMLDivElement | undefined>();
	let searchTimer: ReturnType<typeof setTimeout>;

	function navIdx(cur: number, total: number, d: number) {
		return total === 0 ? -1 : (cur + d + total) % total;
	}
	function scrollActive(listEl: HTMLDivElement | undefined, idx: number) {
		queueMicrotask(() => (listEl?.children[idx] as HTMLElement)?.scrollIntoView({ block: 'nearest' }));
	}
	function selectSearchHit(id: number) {
		closeSearch();
		setFocus(id);
	}
	function applySearch(raw: string) {
		const q = raw.trim().toLowerCase();
		if (!q) {
			searchResults = [];
			return;
		}
		const hits = data.personMarkers.filter(
			(p) => p.name.toLowerCase().includes(q) || p.aliases.some((a) => a.toLowerCase().includes(q))
		);
		if (!hits.length) {
			searchResults = [];
			return;
		}
		if (hits.length === 1) {
			selectSearchHit(hits[0].id);
			return;
		}
		searchResults = hits;
		map?.fitBounds(hits.map((p) => [p.lat, p.lng]), { padding: [60, 60], maxZoom: 10 });
	}
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchActiveIdx = -1;
		searchTimer = setTimeout(() => applySearch(searchQ), 300);
	}
	function openSearch() {
		searchOpen = true;
		queueMicrotask(() => searchInput?.focus());
	}
	function closeSearch() {
		clearTimeout(searchTimer);
		searchOpen = false;
		searchQ = '';
		searchResults = [];
		searchActiveIdx = -1;
	}

	function isPointInsideRect(x: number, y: number, rect: DOMRect) {
		return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
	}

	function markerSignature() {
		return (
			data.personMarkers.map((p) => `${p.id}:${p.name}:${p.city}:${p.lat}:${p.lng}`).join(',') +
			'|' +
			data.eventMarkers.map((e) => `${e.id}:${e.name}:${e.typeName}:${e.sensitive}:${e.when}:${e.lat}:${e.lng}`).join(',') +
			'|' +
			data.connectionSegments.map((c) => `${c.id}:${c.sourceId}:${c.targetId}:${c.typeName}:${c.color}`).join(',')
		);
	}

	function pinIcon(color: string) {
		return L.divIcon({
			className: '',
			html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
			iconSize: [22, 22],
			iconAnchor: [11, 22],
			popupAnchor: [0, -20]
		});
	}

	function avatarPinIcon(person: { name: string; image?: string | null }) {
		const initials = person.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
		const inner = person.image
			? `<img src="${esc(person.image)}" alt="${esc(person.name)}" style="width:100%;height:100%;object-fit:cover;display:block" />`
			: `<span style="font-size:11px;font-weight:700;color:#fff;line-height:1">${initials}</span>`;
		return L.divIcon({
			className: '',
			html: `<div style="width:30px;height:30px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);background:${PERSON_COLOR}">${inner}</div>`,
			iconSize: [30, 30],
			iconAnchor: [15, 15],
			popupAnchor: [0, -16]
		});
	}

	function esc(s: string) {
		return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
	}

	function rebuild() {
		if (!map) return;
		personCluster.clearLayers();
		personDirectLayer.clearLayers();
		eventCluster.clearLayers();
		connectionLayer.clearLayers();

		// Focus (from graph or a marker click) narrows to just that person's own network.
		const persons = focusId != null ? visiblePersons : data.personMarkers;
		const connections = focusId != null ? visibleConnections : data.connectionSegments;

		// Zoom-aware spiral: pixel radius stays constant on screen at any zoom level,
		// so avatars at the same coordinate stay visually separated instead of a fixed ~250m that vanishes when zoomed out.
		const degPerPixel = 360 / (256 * Math.pow(2, map.getZoom()));
		const jitter = new Map<number, [number, number]>();
		{
			const cnt: Record<string, number> = {};
			for (const p of persons) {
				const key = `${p.lat},${p.lng}`;
				const i = cnt[key] ?? 0;
				cnt[key] = i + 1;
				const a = (i * 137.5 * Math.PI) / 180;
				const r = i === 0 ? 0 : (18 + i * 4) * degPerPixel;
				jitter.set(p.id, [r * Math.cos(a), r * Math.sin(a)]);
			}
		}

		if (showPersons || connectionsMode) {
			for (const p of persons) {
				const [dlat, dlng] = jitter.get(p.id) ?? [0, 0];
				const m = L.marker([p.lat + dlat, p.lng + dlng], {
					icon: avatarPinIcon(p)
				});
				const focusLabel = p.id === focusId ? '' : `<br><button data-focus-id="${p.id}" class="btn btn-sm mt-1">🎯 Fokussieren</button>`;
				m.bindPopup(
					`<b>${esc(p.name)}</b><br><span style="color:#777">${esc(p.city ?? 'Stadt')}</span><br><a href="/personen/${p.id}">Profil ↗</a>${focusLabel}`
				);
				// Verbindungsmodus/Fokus: nie clustern, sonst verschwinden Personen als Zahlen-Bubble statt Avatar+Linie.
				(connectionsMode ? personDirectLayer : personCluster).addLayer(m);
			}
		}
		if (showEvents && !connectionsMode) {
			for (const e of data.eventMarkers) {
				if (e.sensitive && !showSensitive) continue;
				if (eventType && e.typeName !== eventType) continue;
				const m = L.marker([e.lat, e.lng], { icon: pinIcon(EVENT_COLOR) });
				m.bindPopup(
					`<b>${e.sensitive ? '🔒 ' : ''}${esc(e.name)}</b><br><span style="color:#777">${esc(e.typeName)} · ${esc(e.when)}</span><br><a href="/personen/${e.id}">Event ↗</a>`
				);
				eventCluster.addLayer(m);
			}
		}

		if (connectionsMode) {
			for (const connection of connections) {
				const [f0, f1] = jitter.get(connection.sourceId) ?? [0, 0];
				const [t0, t1] = jitter.get(connection.targetId) ?? [0, 0];
				const line = L.polyline(
					[
						[connection.from.lat + f0, connection.from.lng + f1],
						[connection.to.lat + t0, connection.to.lng + t1]
					],
					{
						color: connection.color,
						weight: 4,
						opacity: 0.9
					}
				);
				connectionLayer.addLayer(line);
			}
		}

		updateLegendTransparency();
	}

	function updateLegendTransparency() {
		if (!map || !legendEl) {
			legendDimmed = false;
			return;
		}
		const rect = legendEl.getBoundingClientRect();
		const mapRect = mapEl.getBoundingClientRect();
		let covered = false;
		for (const marker of data.personMarkers) {
			const point = map.latLngToContainerPoint([marker.lat, marker.lng]);
			const x = point.x + mapRect.left;
			const y = point.y + mapRect.top;
			if (isPointInsideRect(x, y, rect)) {
				covered = true;
				break;
			}
		}
		if (!covered && !connectionsMode) {
			for (const marker of data.eventMarkers) {
				if (marker.sensitive && !showSensitive) continue;
				if (eventType && marker.typeName !== eventType) continue;
				const point = map.latLngToContainerPoint([marker.lat, marker.lng]);
				const x = point.x + mapRect.left;
				const y = point.y + mapRect.top;
				if (isPointInsideRect(x, y, rect)) {
					covered = true;
					break;
				}
			}
		}
		legendDimmed = covered;
	}

	async function initMap() {
		L = (await import('leaflet')).default;
		await import('leaflet.markercluster');

		map = L.map(mapEl, { zoomControl: false }).setView([51.3, 10.4], 6);
		L.control.zoom({ position: 'bottomright' }).addTo(map); // ponytail: topleft default is hidden under the filter panel
		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '© OpenStreetMap',
			maxZoom: 19
		}).addTo(map);

		personCluster = L.markerClusterGroup({ iconCreateFunction: clusterIcon(PERSON_COLOR) });
		personDirectLayer = L.layerGroup();
		eventCluster = L.markerClusterGroup({ iconCreateFunction: clusterIcon(EVENT_COLOR) });
		connectionLayer = L.layerGroup();
		map.addLayer(connectionLayer);
		map.addLayer(personCluster);
		map.addLayer(personDirectLayer);
		map.addLayer(eventCluster);
		map.on('move zoom resize', updateLegendTransparency);
		map.on('zoomend', rebuild);
		// Clicking "🎯 Fokussieren" in a popup focuses that person — popups render inside mapEl, so one delegated listener covers all of them.
		mapEl.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-focus-id]');
			if (btn) setFocus(Number(btn.dataset.focusId));
		});

		// ?focus=ID (from graph, or set here) → shared with graph's own localStorage('graph.focus'),
		// so a person focused in the graph shows up focused here too, on the next map visit.
		const urlFocus = Number($page.url.searchParams.get('focus'));
		focusId = urlFocus || Number(localStorage.getItem('graph.focus')) || null;

		rebuild();
		// Focus: fit to that person's own network — never a tight zoom-in, just whatever bounds fit everyone involved.
		// ponytail: only persons with stored coordinates can be shown; those without fall back to fit-all.
		const all = focusId != null ? visiblePersons : [...data.personMarkers, ...data.eventMarkers];
		if (all.length) {
			map.fitBounds(all.map((m) => [m.lat, m.lng]), { padding: [40, 40], maxZoom: 11 });
		}
		mapReady = true;
	}

	function clusterIcon(color: string) {
		return (cluster: any) =>
			L.divIcon({
				html: `<div style="background:${color}e6;color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:600;border:2px solid #fff">${cluster.getChildCount()}</div>`,
				className: '',
				iconSize: [36, 36]
			});
	}

	// Nach einem Schreibvorgang über die Erzählfunktion ruft VoiceButton invalidateAll();
	// das aktualisiert `data` → hier die Leaflet-Layer neu aufbauen (Karte "live").
	let mapReady = false;
	$effect(() => {
		markerSignature(); // tracks marker data from load()
		showPersons;
		showEvents;
		showSensitive;
		eventType;
		showConnectionsOnly;
		focusId;
		if (!map || !mapReady) return;
		rebuild();
	});

	$effect(() => {
		showConnectionsOnly;
		if (!showConnectionsOnly) return;
		showPersons = true;
		showEvents = false;
	});

	onMount(() => {
		initMap();
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
				e.preventDefault();
				openSearch();
			} else if (e.key === 'Escape') {
				if (searchOpen) closeSearch();
				else if (focusId != null) clearFocus();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			map?.remove();
		};
	});
</script>

<svelte:head><title>Karte – RelaTable</title></svelte:head>

{#if focusId && focusName}
	<Topbar title={`Fokus: ${focusName}`}>
		<button class="btn btn-sm" onclick={openSearch} aria-label="Suchen">🔍</button>
		<button class="btn btn-sm" onclick={clearFocus}>‹ Zurück</button>
	</Topbar>
{:else}
	<Topbar title="Karte">
		<button class="btn btn-sm" onclick={openSearch} aria-label="Suchen">🔍</button>
		<button class="btn btn-sm md:hidden" onclick={() => (filterOpen = !filterOpen)}>Filter</button>
	</Topbar>
{/if}

<div class="relative flex-1 overflow-hidden">
	<div bind:this={mapEl} class="absolute inset-0 z-0"></div>

	<!-- Ctrl+F search: slides in top-centre -->
	{#if searchOpen}
		<div class="absolute left-1/2 top-3 z-[800] -translate-x-1/2" transition:fly={{ y: -30, duration: 220 }}>
			<div class="flex flex-col gap-1">
				<div class="flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 shadow-lg backdrop-blur-md">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-mut">
						<circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
					</svg>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:this={searchInput}
						bind:value={searchQ}
						oninput={onSearchInput}
						onkeydown={(e) => {
							if (e.key === 'ArrowDown') { e.preventDefault(); searchActiveIdx = navIdx(searchActiveIdx, searchResults.length, 1); scrollActive(searchListEl, searchActiveIdx); return; }
							if (e.key === 'ArrowUp') { e.preventDefault(); searchActiveIdx = navIdx(searchActiveIdx, searchResults.length, -1); scrollActive(searchListEl, searchActiveIdx); return; }
							if (e.key !== 'Enter') return;
							const target = searchActiveIdx >= 0 ? searchResults[searchActiveIdx] : searchResults[0];
							if (target) selectSearchHit(target.id);
						}}
						placeholder="Name suchen…"
						class="w-48 bg-transparent text-sm outline-none"
						aria-label="Personen auf der Karte suchen"
					/>
					<button class="text-mut hover:text-ink" onclick={closeSearch} aria-label="Suche schließen">✕</button>
				</div>
				{#if searchResults.length}
					<div bind:this={searchListEl} class="max-h-72 overflow-y-auto rounded-xl border border-line bg-card shadow-lg backdrop-blur-md">
						{#each searchResults as r, i}
							<button
								class="flex w-full items-center justify-between border-b border-line px-4 py-2 text-left last:border-0 hover:bg-accent/10 outline-none {i === searchActiveIdx ? 'bg-accent/15' : ''}"
								onclick={() => selectSearchHit(r.id)}
							>
								<span class="text-sm font-medium">{r.name}</span>
								<span
									class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-bg bg-cover bg-center text-[10px] text-mut"
									style={r.image ? `background-image:url('${r.image}')` : ''}
								>{r.image ? '' : r.name[0]}</span>
								<span class="ml-3 shrink-0 text-xs text-mut">{r.city ?? '–'}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Filter panel (desktop) -->
	{#if !focusId}
		<div class="absolute left-2.5 top-2.5 z-[500] hidden w-48 rounded-lg border border-line bg-card p-2.5 text-xs shadow md:block">
			<label class="mb-2 flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1.5">
				<span class="text-[11px] font-medium leading-tight">Nur Personen + Verbindungen</span>
				<input type="checkbox" aria-label="Nur Personen und Verbindungen" bind:checked={showConnectionsOnly} />
			</label>
			<b>Layer</b>
			<label class="mt-1 flex items-center justify-between">
				<span><span class="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style="background:{PERSON_COLOR}"></span>Personen</span>
				<input type="checkbox" aria-label="Layer Personen" bind:checked={showPersons} disabled={showConnectionsOnly} />
			</label>
			<label class="mt-1 flex items-center justify-between">
				<span><span class="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style="background:{EVENT_COLOR}"></span>Ereignisse</span>
				<input type="checkbox" aria-label="Layer Ereignisse" bind:checked={showEvents} disabled={showConnectionsOnly} />
			</label>
			<hr class="my-1.5 border-line" />
			<b>Filter</b>
			<label class="mt-1 block">Eventtyp
				<select class="inp mt-1" bind:value={eventType} disabled={showConnectionsOnly}>
					<option value="">Alle</option>
					{#each eventTypes as t}<option value={t}>{t}</option>{/each}
				</select>
			</label>
			<label class="mt-1.5 flex items-center justify-between">
				<span>⊙ Sensible</span>
				<input type="checkbox" bind:checked={showSensitive} disabled={showConnectionsOnly} />
			</label>
			{#if overlayVisible}
				<hr class="my-1.5 border-line" />
				<label class="flex items-center justify-between">
					<span>Legende</span>
					<input type="checkbox" aria-label="Legende anzeigen" bind:checked={showLegend} />
				</label>
			{/if}
		</div>
	{/if}

	{#if overlayVisible && showLegend}
		<div
			bind:this={legendEl}
			data-testid="map-legend-overlay"
			class={`legend-overlay absolute left-2.5 md:left-auto md:right-2.5 z-[500] w-[180px] max-w-[calc(100%-1.25rem)] overflow-y-auto rounded-lg border border-line bg-card/95 p-2 text-[11px] shadow-sm transition-opacity duration-200 ${legendDimmed ? 'opacity-20' : 'opacity-100'}`}
		>
			{#if connectionsMode}
				<b>Legende</b>
				<div class="mt-1 space-y-1">
					{#each data.connectionLegend as item}
						<div class="flex items-center gap-2">
							<span class="inline-block h-0.5 w-4 rounded-full" style={`background:${item.color}`}></span>
							<span>{item.label}</span>
						</div>
					{/each}
				</div>
			{/if}
			{#if data.missing.persons > 0 || data.missing.events > 0}
				<div class={connectionsMode ? 'mt-2 border-t border-line pt-2' : ''}>
					<b>Ohne Standort</b>
					<p class="mt-1 text-mut">Werden nicht falsch verortet, sondern separat gelistet:</p>
					<p class="mt-1">
						• {data.missing.persons} Personen ohne Ort<br />
						• {data.missing.events} Ereignisse ohne Ort
					</p>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Mobile filter sheet -->
	{#if filterOpen}
		<div class="absolute inset-0 z-[600] bg-black/30 md:hidden" role="button" tabindex="-1" aria-label="Schließen" onclick={() => (filterOpen = false)} onkeydown={() => {}}></div>
		<div class="absolute inset-x-0 bottom-0 z-[700] rounded-t-2xl border-t border-line bg-card p-4 text-sm md:hidden">
			<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-line"></div>
			<label class="flex items-center justify-between py-1.5">
				<span>Nur Personen + Verbindungen</span>
				<input type="checkbox" aria-label="Mobil nur Personen und Verbindungen" bind:checked={showConnectionsOnly} />
			</label>
			<label class="flex items-center justify-between py-1.5"><span>Personen</span><input type="checkbox" bind:checked={showPersons} disabled={showConnectionsOnly} /></label>
			<label class="flex items-center justify-between py-1.5"><span>Ereignisse</span><input type="checkbox" bind:checked={showEvents} disabled={showConnectionsOnly} /></label>
			<label class="flex items-center justify-between py-1.5"><span>Sensible</span><input type="checkbox" bind:checked={showSensitive} disabled={showConnectionsOnly} /></label>
			{#if overlayVisible}
				<label class="flex items-center justify-between py-1.5"><span>Legende</span><input type="checkbox" aria-label="Legende anzeigen" bind:checked={showLegend} /></label>
			{/if}
			<button class="btn mt-2 w-full justify-center" onclick={() => (filterOpen = false)}>Schließen</button>
		</div>
	{/if}
</div>

<style>
	.legend-overlay {
		top: calc(3.5rem + env(safe-area-inset-top, 0px) + 0.75rem);
		max-height: calc(
			100dvh - 3.5rem - env(safe-area-inset-top, 0px) - var(--mobile-tab-bar-height, 4rem) -
				env(safe-area-inset-bottom, 0px) - 2rem
		);
		overscroll-behavior: contain;
		touch-action: pan-y;
	}

	@media (min-width: 768px) {
		.legend-overlay {
			top: 0.625rem;
			max-height: min(45vh, 24rem);
		}
	}
</style>
