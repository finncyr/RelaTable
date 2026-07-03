<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import Topbar from '$lib/components/Topbar.svelte';
	let { data, form } = $props();

	let container: HTMLDivElement;
	let legendEl = $state<HTMLDivElement | undefined>();
	let cy: any = null;
	let fgInstance: any = null;
	// Plain mutable object read by canvas callbacks every frame (not Svelte state)
	const fgMut = { focusId: null as number | null, neighborIds: new Set<number>(), searchHits: new Set<number>() };
	let engine = $state<'cytoscape' | 'forcegraph'>(
		browser ? ((localStorage.getItem('graph.engine') as 'forcegraph' | null) ?? 'forcegraph') : 'forcegraph'
	);
	let searchAutoSwitched = false;
	const basePos = new Map<string, { x: number; y: number }>(); // layout positions, restored before each focus
	let layoutName = $state('circle');
	let panel = $state<null | { id: number; name: string; city: string | null; degree: number; x: number; y: number }>(null);
	let menu = $state<null | { id: number; name: string; x: number; y: number }>(null);
	let legendDimmed = $state(false);

	let searchOpen = $state(false);
	let searchQ = $state('');
	let searchResults = $state<{ id: number; name: string; city: string | null; image: string | null }[]>([]);
	let searchInput: HTMLInputElement;
	let searchTimer: ReturnType<typeof setTimeout>;
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let suppressTapUntil = 0;
	let edgeMenu = $state<null | { source: number; target: number; typeName: string | null; x: number; y: number }>(null);
	let mergeDialog = $state<null | {
		sourceId: number;
		sourceName: string;
		candidates: { id: number; name: string; aliases: string[]; score: number }[];
		selectedId: number | null;
	}>(null);

	type QCStep =
		| { step: 1 }
		| { step: 2; sourceId: number; sourceName: string }
		| { step: 3; sourceId: number; sourceName: string; typeId: number; typeName: string };
	let quickConnect = $state<QCStep | null>(null);
	let qcSearch = $state('');
	let qcTargets = $state<Set<number>>(new Set());
	let qcError = $state<string | null>(null);
	let qcForm = $state<HTMLFormElement | undefined>();
	let qcInput1 = $state<HTMLInputElement | undefined>();
	let qcInput3 = $state<HTMLInputElement | undefined>();
	let searchActiveIdx = $state(-1);
	let qcActiveIdx = $state(-1);
	let searchListEl = $state<HTMLDivElement | undefined>();
	let qcList1El = $state<HTMLDivElement | undefined>();
	let qcList3El = $state<HTMLDivElement | undefined>();

	type QLStep = { step: 1 } | { step: 2; city: string };
	let quickLocation = $state<QLStep | null>(null);
	let qlSearch = $state('');
	let qlTargets = $state<Set<number>>(new Set());
	let qlActiveIdx = $state(-1);
	let qlInput1 = $state<HTMLInputElement | undefined>();
	let qlInput2 = $state<HTMLInputElement | undefined>();
	let qlList1El = $state<HTMLDivElement | undefined>();
	let qlList2El = $state<HTMLDivElement | undefined>();

	// Matches on the real name or any stored alias/nickname, so "Bulle" finds "Christian Müller" if that's an alias.
	function matchesQuery(name: string, aliases: readonly string[] | undefined, q: string) {
		return name.toLowerCase().includes(q) || (aliases ?? []).some((a) => a.toLowerCase().includes(q));
	}
	function navIdx(cur: number, total: number, d: number) { return total === 0 ? -1 : (cur + d + total) % total; }
	function scrollActive(listEl: HTMLDivElement | undefined, idx: number) {
		queueMicrotask(() => (listEl?.children[idx] as HTMLElement)?.scrollIntoView({ block: 'nearest' }));
	}

	$effect(() => {
		if (quickConnect?.step === 1) queueMicrotask(() => qcInput1?.focus());
		if (quickConnect?.step === 3) queueMicrotask(() => qcInput3?.focus());
	});
	$effect(() => { qcSearch; quickConnect?.step; qcActiveIdx = -1; });

	$effect(() => {
		if (quickLocation?.step === 1) queueMicrotask(() => qlInput1?.focus());
		if (quickLocation?.step === 2) queueMicrotask(() => qlInput2?.focus());
	});
	$effect(() => { qlSearch; quickLocation?.step; qlActiveIdx = -1; });

	const allCities = $derived([...new Set(data.graph.nodes.map((n) => n.city).filter(Boolean) as string[])].sort());
	const qlFilteredCities = $derived.by(() => {
		const q = qlSearch.trim().toLowerCase();
		return q ? allCities.filter((c) => c.toLowerCase().includes(q)) : allCities;
	});
	const qlFilteredPersons = $derived.by(() => {
		if (!quickLocation || quickLocation.step !== 2) return [];
		const q = qlSearch.trim().toLowerCase();
		return data.graph.nodes.filter((n) => !q || matchesQuery(n.name, n.aliases, q));
	});

	function openQuickLocation() {
		quickLocation = { step: 1 };
		qlSearch = '';
		qlTargets = new Set();
		qlActiveIdx = -1;
		qlSelectedCity = '';
		menu = null; panel = null; searchOpen = false;
	}
	function closeQuickLocation() {
		quickLocation = null;
		qlSearch = '';
		qlTargets = new Set();
		qlActiveIdx = -1;
		qlSelectedCity = '';
	}
	function qlPickCity(city: string) {
		qlSelectedCity = city;
		quickLocation = { step: 2, city };
		qlSearch = '';
		qlActiveIdx = -1;
	}
	let qlSelectedCity = $state(''); // confirmed city from step 1 (either existing or typed new)

	const qcFilteredPersons = $derived.by(() => {
		if (!quickConnect) return [];
		const q = qcSearch.trim().toLowerCase();
		const excludeId = 'sourceId' in quickConnect ? quickConnect.sourceId : -1;
		return data.graph.nodes
			.filter((n) => n.id !== excludeId && (!q || matchesQuery(n.name, n.aliases, q)))
			.slice(0, 60);
	});

	function openQuickConnect() {
		quickConnect = { step: 1 };
		qcSearch = '';
		qcTargets = new Set();
		qcError = null;
		menu = null; panel = null; searchOpen = false;
	}
	function closeQuickConnect() {
		quickConnect = null;
		qcSearch = '';
		qcTargets = new Set();
		qcError = null;
	}

	// Filter only after the user pauses typing for 500ms.
	// On first keystroke while focused: immediately clear focus state + fit camera.
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchActiveIdx = -1;
		if (focusId != null) {
			localStorage.removeItem('graph.focus');
			goto('/graph', { replaceState: true, noScroll: true, keepFocus: true });
		}
		searchTimer = setTimeout(() => applySearch(searchQ), 500);
	}

	const focusId = $derived.by(() => {
		const f = $page.url.searchParams.get('focus');
		return f && /^\d+$/.test(f) ? Number(f) : null;
	});
	const focusName = $derived(data.graph.nodes.find((n) => n.id === focusId)?.name ?? null);

	function normalizeName(value: string) {
		return value
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}
	function bigrams(value: string) {
		if (value.length < 2) return value ? [value] : [];
		const grams: string[] = [];
		for (let i = 0; i < value.length - 1; i += 1) grams.push(value.slice(i, i + 2));
		return grams;
	}
	function diceCoefficient(a: string, b: string) {
		const left = bigrams(a);
		const right = bigrams(b);
		if (!left.length || !right.length) return 0;
		const counts = new Map<string, number>();
		for (const gram of left) counts.set(gram, (counts.get(gram) ?? 0) + 1);
		let overlap = 0;
		for (const gram of right) {
			const remaining = counts.get(gram) ?? 0;
			if (remaining > 0) {
				overlap += 1;
				counts.set(gram, remaining - 1);
			}
		}
		return (2 * overlap) / (left.length + right.length);
	}
	function similarity(a: string, b: string) {
		const na = normalizeName(a);
		const nb = normalizeName(b);
		if (!na || !nb) return 0;
		if (na === nb) return 1;
		if (na.includes(nb) || nb.includes(na)) return 0.9;
		const aParts = na.split(' ');
		const bParts = nb.split(' ');
		const firstA = aParts[0] ?? na;
		const firstB = bParts[0] ?? nb;
		const lastA = aParts.at(-1) ?? na;
		const lastB = bParts.at(-1) ?? nb;
		const prefix = firstA.startsWith(firstB) || firstB.startsWith(firstA) || lastA.startsWith(lastB) || lastB.startsWith(lastA) ? 0.82 : 0;
		return Math.max(diceCoefficient(na, nb), prefix, diceCoefficient(firstA, firstB) * 0.7 + diceCoefficient(lastA, lastB) * 0.3);
	}
	function isInteractiveNode(node: any) {
		if (focusId == null) return true;
		const focused = cy?.getElementById(String(focusId));
		if (!focused || focused.empty()) return true;
		return node.id() === String(focusId) || focused.neighborhood('node').contains(node);
	}
	function isInteractiveEdge(edge: any) {
		if (focusId == null) return true;
		const focused = cy?.getElementById(String(focusId));
		if (!focused || focused.empty()) return true;
		return focused.closedNeighborhood('edge').contains(edge);
	}
	function openMergeDialog(sourceId: number) {
		const source = data.graph.nodes.find((node) => node.id === sourceId);
		if (!source) return;
		const sourceTerms = [source.name, ...source.aliases];
		const candidates = data.graph.nodes
			.filter((node) => node.id !== sourceId)
			.map((node) => {
				const nodeTerms = [node.name, ...node.aliases];
				const score = Math.max(...sourceTerms.flatMap((left) => nodeTerms.map((right) => similarity(left, right))));
				return { id: node.id, name: node.name, aliases: node.aliases, score };
			})
			.filter((node) => node.score >= 0.34)
			.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
			.slice(0, 8);
		mergeDialog = {
			sourceId,
			sourceName: source.name,
			candidates,
			selectedId: candidates[0]?.id ?? null
		};
		menu = null;
		panel = null;
	}
	function updateFloatingPositions() {
		if (!cy) return;
		if (panel) {
			const node = cy.getElementById(String(panel.id));
			if (!node.empty()) {
				const p = node.renderedPosition();
				panel = { ...panel, x: p.x, y: p.y };
			}
		}
		if (menu) {
			const node = cy.getElementById(String(menu.id));
			if (!node.empty()) {
				const p = node.renderedPosition();
				menu = { ...menu, x: p.x, y: p.y };
			}
		}
	}

	function buildElements() {
		const nodes = data.graph.nodes.map((n) => ({
			data: { id: String(n.id), name: n.name, aliases: n.aliases, image: n.image, degree: n.degree, isolated: n.degree === 0 }
		}));
		const edges = data.graph.edges.map((e) => ({
			data: { id: e.id, source: String(e.source), target: String(e.target), color: e.color, typeName: e.typeName }
		}));
		return [...nodes, ...edges];
	}

	function styles(_cytoscape: any): any[] {
		return [
			{ selector: 'core', style: { 'background-color': 'transparent' } },
			{
				selector: 'node',
				style: {
					width: 'data(degree)',
					height: 'data(degree)',
					'background-color': '#0a1410',
					'background-image': 'data(image)',
					'background-fit': 'cover',
					'background-image-crossorigin': 'anonymous',
					'border-width': 1.5,
					'border-color': '#8aaa50',
					label: 'data(name)',
					'font-size': 9,
					color: '#7a9880',
					'text-valign': 'bottom',
					'text-margin-y': 3,
					'text-wrap': 'wrap',
					'text-max-width': '90px',
					'shadow-blur': 10,
					'shadow-color': '#7aa040',
					'shadow-opacity': 0.4,
					'shadow-offset-x': 0,
					'shadow-offset-y': 0,
					'transition-property': 'opacity, border-width, border-color, overlay-opacity',
					'transition-duration': '0.35s',
					'transition-timing-function': 'ease-in-out'
				}
			},
			// Size from degree (mapped at element build via degree number); ensure a floor.
			{ selector: 'node[degree < 6]', style: { width: 26, height: 26 } },
			{ selector: 'node[?isolated]', style: { 'border-style': 'dashed', 'border-color': '#2a3d2a', 'background-color': '#080e08' } },
			{ selector: 'node.faded', style: { opacity: 0.12 } },
			// Spotlight: smooth fade, keeps node in place. Non-neighbours in focus
			// mode must not show Cytoscape's tap overlay or receive events.
			{ selector: 'node.dim', style: { opacity: 0.06, events: 'no', 'overlay-opacity': 0 } },
			{ selector: 'node.hidden', style: { display: 'none' } },
			{ selector: 'node.search-hit', style: { 'border-color': '#c8d850', 'border-width': 3, 'z-index': 30, 'shadow-color': '#c0d040', 'shadow-opacity': 0.75 } },
			{
				selector: 'edge',
				style: {
					width: 1,
					'line-color': 'data(color)',
					'curve-style': 'bezier',
					opacity: 0.5,
					'transition-property': 'opacity, width',
					'transition-duration': '0.35s'
				}
			},
			// Inactive edges in focus mode should be visual context only.
			{ selector: 'edge.dim', style: { opacity: 0.04, events: 'no', 'overlay-opacity': 0 } },
			{ selector: 'edge.focus-edge', style: { width: 2, opacity: 0.85 } },
			{ selector: 'edge.hidden', style: { display: 'none' } }
		];
	}

	function nodeSize(degree: number) {
		return Math.min(60, 26 + degree * 4);
	}
	function clamp(value: number, min: number, max: number) {
		return Math.min(Math.max(value, min), max);
	}
	function isPointInsideRect(x: number, y: number, rect: DOMRect) {
		return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
	}
	function updateLegendTransparency() {
		if (!cy || !legendEl || !container) {
			legendDimmed = false;
			return;
		}
		const rect = legendEl.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		let covered = false;
		cy.nodes(':visible').forEach((node: any) => {
			if (covered) return;
			const point = node.renderedPosition();
			const x = containerRect.left + point.x;
			const y = containerRect.top + point.y;
			if (isPointInsideRect(x, y, rect)) covered = true;
		});
		legendDimmed = covered;
	}

	function setVoiceButtonDimmed(dimmed: boolean) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent('graph-voice-button-dim', { detail: { dimmed } }));
	}

	function updateVoiceButtonTransparency() {
		if (!cy) {
			setVoiceButtonDimmed(false);
			return;
		}
		const fab = document.querySelector('[data-testid="voice-fab"]');
		if (!(fab instanceof HTMLElement)) {
			setVoiceButtonDimmed(false);
			return;
		}
		const rect = fab.getBoundingClientRect();
		const containerRect = container?.getBoundingClientRect();
		if (!containerRect) {
			setVoiceButtonDimmed(false);
			return;
		}
		let covered = false;
		cy.nodes(':visible').forEach((node: any) => {
			if (covered) return;
			const point = node.renderedPosition();
			const x = containerRect.left + point.x;
			const y = containerRect.top + point.y;
			if (isPointInsideRect(x, y, rect)) covered = true;
		});
		setVoiceButtonDimmed(covered);
	}

	async function initCy() {
		const cytoscape = (await import('cytoscape')).default;
		// Pre-size nodes (degree value becomes the px size).
		const els = buildElements().map((el: any) =>
			el.data.source ? el : { data: { ...el.data, degree: nodeSize(el.data.degree) } }
		);
		cy = cytoscape({
			container,
			elements: els,
			style: styles(cytoscape),
			minZoom: 0.2,
			maxZoom: 3,
			wheelSensitivity: 0.2
		});

		cy.on('tap', 'node', (evt: any) => {
			if (Date.now() < suppressTapUntil) return;
			const n = evt.target;
			if (!isInteractiveNode(n)) return;
			const id = Number(n.id());
			const meta = data.graph.nodes.find((x) => x.id === id)!;
			const pos = n.renderedPosition();
			panel = { id, name: meta.name, city: meta.city, degree: meta.degree, x: pos.x, y: pos.y };
			menu = null;
		});
		cy.on('dbltap', 'node', (evt: any) => {
			if (!isInteractiveNode(evt.target)) return;
			focusOn(Number(evt.target.id()));
		});
		cy.on('dbltap', (evt: any) => {
			if (evt.target === cy && focusId != null) {
				clearFocus();
			}
		});
		// Right-click opens the context menu (browser menu suppressed on the wrapper div).
		const openMenu = (evt: any) => {
			if (!isInteractiveNode(evt.target)) return;
			const id = Number(evt.target.id());
			const meta = data.graph.nodes.find((x) => x.id === id)!;
			const pos = evt.target.renderedPosition();
			menu = { id, name: meta.name, x: pos.x, y: pos.y };
			panel = null;
		};
		const clearLongPress = () => {
			if (longPressTimer) clearTimeout(longPressTimer);
			longPressTimer = null;
		};
		cy.on('tapstart', 'node', (evt: any) => {
			clearLongPress();
			longPressTimer = setTimeout(() => {
				suppressTapUntil = Date.now() + 700;
				openMenu(evt);
				longPressTimer = null;
			}, 550);
		});
		cy.on('tapend tapdrag', clearLongPress);
		cy.on('cxttap', 'node', openMenu);
		cy.on('taphold', 'node', (evt: any) => {
			clearLongPress();
			suppressTapUntil = Date.now() + 700;
			openMenu(evt);
		});
		cy.on('tap', 'edge', (evt: any) => {
			if (!isInteractiveEdge(evt.target)) return;
			const e = evt.target;
			goto(`/pair/${e.data('source')}-${e.data('target')}`);
		});
		cy.on('cxttap', 'edge', (evt: any) => {
			if (!isInteractiveEdge(evt.target)) return;
			const e = evt.target;
			const pos = evt.renderedPosition;
			edgeMenu = { source: Number(e.data('source')), target: Number(e.data('target')), typeName: e.data('typeName'), x: pos.x, y: pos.y };
			menu = null; panel = null;
		});
		cy.on('tap', (evt: any) => {
			if (evt.target === cy) {
				panel = null;
				menu = null;
				edgeMenu = null;
				mergeDialog = null;
			}
		});
		cy.on('pan zoom resize', () => {
			updateFloatingPositions();
			updateLegendTransparency();
			updateVoiceButtonTransparency();
		});

		// On first load with a focus, settle positions synchronously so applyFocus reads final
		// coordinates (animated layout would leave it reading mid-flight positions → wrong ring/zoom).
		if (focusId != null) {
			cy.layout({ name: layoutName, animate: false, fit: false, padding: 40 }).run();
			saveBase();
			applyFocus(focusId);
		} else {
			runLayout();
		}
		graphSig = graphSignature(); // baseline: don't let the rebuild effect fire on first pass
		graphReady = true;
		updateLegendTransparency();
		updateVoiceButtonTransparency();
	}

	// Cheap content signature: focus navigation (?focus=…) re-runs the server load → `data.graph`
	// gets a fresh reference even though nothing changed. Comparing content lets us skip the rebuild
	// (which tore nodes down mid-animation and called applyFocus a *second* time → double zoom,
	// lost ring flare, scrambled neighbour ring). Only a real change (voice write) rebuilds.
	function graphSignature() {
		return (
			data.graph.nodes.map((n) => `${n.id}:${n.name}:${n.aliases.join('|')}:${n.image}:${n.degree}`).join(',') +
			'|' +
			data.graph.edges.map((e) => `${e.source}-${e.target}-${e.color}`).join(',')
		);
	}

	// Nach einem Schreibvorgang über die Erzählfunktion ruft VoiceButton invalidateAll();
	// das aktualisiert `data` → hier die Elemente neu aufbauen (Graph "live").
	let graphReady = false;
	let graphSig = '';
	$effect(() => {
		const sig = graphSignature(); // tracks data.graph
		if (!graphReady || sig === graphSig) return;
		graphSig = sig;
		if (engine === 'forcegraph' && fgInstance) {
			fgInstance.graphData(buildFgData());
			return;
		}
		if (!cy) return;
		const els = buildElements().map((el: any) =>
			el.data.source ? el : { data: { ...el.data, degree: nodeSize(el.data.degree) } }
		);
		cy.elements().remove();
		cy.add(els);
		if (focusId != null) {
			cy.layout({ name: layoutName, animate: false, fit: false, padding: 40 }).run();
			saveBase();
		} else {
			runLayout();
			return;
		}
		applyFocus(focusId);
	});

	function buildFgData() {
		return {
			nodes: data.graph.nodes.map((n) => ({ id: n.id, name: n.name, val: Math.max(1, n.degree), img: n.image })),
			links: data.graph.edges.map((e) => ({ source: e.source, target: e.target, color: e.color, typeName: e.typeName }))
		};
	}

	// Preload images so canvas drawing is synchronous (no flicker on first render).
	function preloadFgImages(): Map<number, HTMLImageElement> {
		const cache = new Map<number, HTMLImageElement>();
		for (const n of data.graph.nodes) {
			if (!n.image) continue;
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.src = n.image;
			cache.set(n.id, img);
		}
		return cache;
	}

	async function initForceGraph() {
		const ForceGraph = (await import('force-graph')).default;
		const imgCache = preloadFgImages();

		function nodeRadius(val: number) {
			return Math.max(8, Math.min(26, 8 + val * 1.4));
		}

		let lastClickId = -1, lastClickTime = 0;

		fgInstance = ForceGraph()(container)
			.width(container.clientWidth)
			.height(container.clientHeight)
			.backgroundColor('transparent')
			.graphData(buildFgData())
			.nodeLabel(() => '')
			.nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, gs: number) => {
				const r = nodeRadius(node.val || 1);
				const x: number = node.x, y: number = node.y;

				const inFocus = fgMut.focusId != null;
				const inSearch = fgMut.searchHits.size > 0;
				const active = inFocus ? fgMut.neighborIds.has(node.id) : inSearch ? fgMut.searchHits.has(node.id) : true;
				ctx.globalAlpha = active ? 1 : 0.06;

				const isHit = fgMut.searchHits.has(node.id);
				ctx.shadowBlur = 14;
				ctx.shadowColor = '#7aa040';
				ctx.beginPath();
				ctx.arc(x, y, r + 1.5, 0, 2 * Math.PI);
				ctx.strokeStyle = isHit ? '#c8d850' : '#8aaa50';
				ctx.lineWidth = isHit ? 2.5 : 1.5;
				ctx.stroke();
				ctx.shadowBlur = 0;

				ctx.save();
				ctx.beginPath();
				ctx.arc(x, y, r, 0, 2 * Math.PI);
				ctx.clip();
				const img = imgCache.get(node.id);
				if (img && img.complete && img.naturalWidth > 0) {
					ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
				} else {
					ctx.fillStyle = '#0a1410';
					ctx.fill();
				}
				ctx.restore();

				const fs = Math.max(6, 9 / gs);
				ctx.font = `${fs}px system-ui,sans-serif`;
				ctx.fillStyle = 'rgba(172,188,162,0.9)';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				ctx.fillText(String(node.name), x, y + r + 2 / gs);
				ctx.globalAlpha = 1;
			})
			.nodePointerAreaPaint((node: any, color: string, ctx: CanvasRenderingContext2D) => {
				const r = nodeRadius(node.val || 1);
				ctx.beginPath();
				ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
				ctx.fillStyle = color;
				ctx.fill();
			})
			.linkColor((l: any) => {
				if (fgMut.focusId != null) {
					const src = typeof l.source === 'object' ? l.source.id : l.source;
					const tgt = typeof l.target === 'object' ? l.target.id : l.target;
					return fgMut.neighborIds.has(src) && fgMut.neighborIds.has(tgt) ? (l.color || 'rgba(255,255,255,0.5)') : 'rgba(255,255,255,0.03)';
				}
				return l.color || 'rgba(255,255,255,0.18)';
			})
			.linkWidth(0.8)
			.onNodeClick((node: any, event: MouseEvent) => {
				const now = Date.now();
				if (node.id === lastClickId && now - lastClickTime < 300) {
					lastClickId = -1; lastClickTime = 0;
					focusOn(node.id); return;
				}
				lastClickId = node.id; lastClickTime = now;
				const meta = data.graph.nodes.find((n) => n.id === node.id)!;
				panel = { id: node.id, name: meta.name, city: meta.city, degree: meta.degree, x: event.offsetX, y: event.offsetY };
				menu = null;
			})
			.onNodeRightClick((node: any, event: MouseEvent) => {
				event.preventDefault();
				const meta = data.graph.nodes.find((n) => n.id === node.id)!;
				menu = { id: node.id, name: meta.name, x: event.offsetX, y: event.offsetY };
				panel = null;
			})
			.onLinkClick((link: any) => {
				const src = typeof link.source === 'object' ? link.source.id : link.source;
				const tgt = typeof link.target === 'object' ? link.target.id : link.target;
				goto(`/pair/${src}-${tgt}`);
			})
			.onLinkRightClick((link: any, event: MouseEvent) => {
				event.preventDefault();
				const src = typeof link.source === 'object' ? link.source.id : link.source;
				const tgt = typeof link.target === 'object' ? link.target.id : link.target;
				edgeMenu = { source: Number(src), target: Number(tgt), typeName: link.typeName ?? null, x: event.offsetX, y: event.offsetY };
				menu = null; panel = null;
			})
			.onBackgroundClick(() => { panel = null; menu = null; edgeMenu = null; mergeDialog = null; });
		graphReady = true;
		graphSig = graphSignature();
		if (focusId != null) applyFocusForce(focusId);
	}

	function applyFocusForce(id: number | null) {
		if (!fgInstance) return;
		fgMut.focusId = id;
		fgMut.searchHits = new Set();
		if (id == null) {
			fgMut.neighborIds = new Set();
			fgInstance.refresh?.();
			fgInstance.zoomToFit?.(400, 40);
			return;
		}
		const neighbors = new Set<number>([id]);
		for (const e of data.graph.edges) {
			if (e.source === id) neighbors.add(e.target);
			else if (e.target === id) neighbors.add(e.source);
		}
		fgMut.neighborIds = neighbors;
		fgInstance.refresh?.();
		const node = fgInstance.graphData().nodes.find((n: any) => n.id === id);
		if (node) {
			fgInstance.centerAt?.(node.x, node.y, 600);
			fgInstance.zoom?.(3, 600);
		}
	}

	function applySearchForce(raw: string) {
		const q = raw.trim().toLowerCase();
		if (!q) {
			fgMut.searchHits = new Set();
			fgMut.focusId = null;
			fgMut.neighborIds = new Set();
			searchResults = [];
			fgInstance?.refresh?.();
			fgInstance?.zoomToFit?.(350, 40);
			return;
		}
		const hits = data.graph.nodes.filter((n) => matchesQuery(n.name, n.aliases, q));
		if (!hits.length) { searchResults = []; return; }
		fgMut.searchHits = new Set(hits.map((h) => h.id));
		fgMut.focusId = null;
		fgMut.neighborIds = new Set();
		searchResults = hits.map((h) => ({ id: h.id, name: h.name, city: h.city, image: h.image }));
		fgInstance?.refresh?.();
		if (hits.length === 1) {
			clearTimeout(searchTimer);
			searchOpen = false; searchQ = ''; searchResults = [];
			fgMut.searchHits = new Set();
			focusOn(hits[0].id);
		}
	}

	function destroyEngines() {
		cy?.destroy(); cy = null;
		try { fgInstance?._destructor?.(); } catch { /* ignore */ }
		fgInstance = null;
		fgMut.focusId = null; fgMut.neighborIds = new Set(); fgMut.searchHits = new Set();
		if (container) container.innerHTML = '';
		graphReady = false;
	}

	async function setEngine(e: 'cytoscape' | 'forcegraph', save = true) {
		if (e === engine) return;
		engine = e;
		if (save) localStorage.setItem('graph.engine', e);
		destroyEngines();
		if (e === 'cytoscape') await initCy();
		else await initForceGraph();
	}

	function saveBase() {
		basePos.clear();
		cy.nodes().forEach((n: any) => basePos.set(n.id(), { ...n.position() }));
	}
	function restoreBase() {
		cy.nodes().forEach((n: any) => {
			const p = basePos.get(n.id());
			if (p) n.position(p);
		});
	}

	function runLayout() {
		if (!cy) return;
		const lay = cy.nodes(':visible').layout({ name: layoutName, animate: true, animationDuration: 500, fit: true, padding: 40 });
		lay.on('layoutstop', saveBase); // remember the resting positions so focus can restore them
		lay.run();
	}

	function applyFocus(id: number | null) {
		if (engine === 'forcegraph') { applyFocusForce(id); return; }
		if (!cy) return;
		cy.nodes().removeClass('hidden faded focus dim search-hit');
		cy.edges().removeClass('hidden dim focus-edge');
		cy.nodes().removeStyle('border-color border-width'); // clear any leftover flare from a previous focus
		if (id == null) {
			runLayout();
			return;
		}
		const node = cy.getElementById(String(id));
		if (node.empty()) return;
		// Guard: if layout hasn't settled yet (e.g. search fired before layoutstop), snapshot now.
		if (basePos.size === 0) {
			cy.layout({ name: layoutName, animate: false, fit: false, padding: 40 }).run();
			saveBase();
		}
		restoreBase(); // reset to layout positions first, so refocusing never piles nodes up
		const neighborhood = node.closedNeighborhood(); // node + direct contacts + connecting edges (depth 1)
		const others = cy.elements().difference(neighborhood);

		others.addClass('dim');
		neighborhood.edges().addClass('focus-edge');

		// Warm gold ring lights up immediately (on the click), holds 400ms, fades in 200ms → no lasting ring.
		node
			.animate({ style: { 'border-color': '#d4c870', 'border-width': 2.5 }, duration: 120, easing: 'ease-out' })
			.delay(400)
			.animate({
				style: { 'border-color': '#8aaa50', 'border-width': 1.5 },
				duration: 200,
				easing: 'ease-in',
				complete: () => node.removeStyle('border-color border-width')
			});

		// Pull the contacts onto a tight ring around the focus → short edges, then zoom in close.
		const center = node.position();
		const ns = neighborhood.nodes().not(node);
		const r = 120 + ns.length * 8; // model units; grows a little so many contacts don't overlap
		ns.forEach((n: any, i: number) => {
			const a = (2 * Math.PI * i) / ns.length - Math.PI / 2;
			n.animate({ position: { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) }, duration: 500, easing: 'ease-in-out-cubic' });
		});
		// Zoom so the ring fills ~42% from centre (closer when fewer contacts → "relative" zoom). ×1.2 = tighter.
		const view = Math.min(container.clientWidth, container.clientHeight);
		const zoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), (view * 0.42 * 1.2) / (r + 50)));
		cy.animate({ zoom, center: { eles: node }, duration: 600, easing: 'ease-in-out-cubic' });
	}

	function focusOn(id: number) {
		if (focusId != null) {
			const node = cy?.getElementById(String(id));
			if (node && !node.empty() && !isInteractiveNode(node)) return;
		}
		searchOpen = false;
		searchQ = '';
		searchResults = [];
		cy?.nodes().removeClass('search-hit');
		panel = null;
		menu = null;
		mergeDialog = null;
		localStorage.setItem('graph.focus', String(id)); // remember across navigation
		goto(`/graph?focus=${id}`, { noScroll: true, keepFocus: true });
	}
	function clearFocus() {
		localStorage.removeItem('graph.focus');
		mergeDialog = null;
		goto('/graph', { noScroll: true, keepFocus: true });
	}

	// Ctrl/Cmd+F → slide-in search. Resets to full circle view on every call so no focus artefacts bleed in.
	function applySearch(raw: string) {
		if (engine === 'forcegraph') { applySearchForce(raw); return; }
		if (!cy) return;
		const q = raw.trim().toLowerCase();
		// Full reset: stop any running layout/focus animation, restore positions, clear classes.
		cy.stop(true, true);
		cy.nodes().removeClass('hidden faded focus dim search-hit');
		cy.edges().removeClass('hidden dim focus-edge');
		cy.nodes().removeStyle('border-color border-width');
		if (basePos.size > 0) restoreBase();
		if (!q) {
			cy.animate({ fit: { eles: cy.nodes(':visible'), padding: 40 }, duration: 350, easing: 'ease-in-out' });
			return;
		}
		const hits = cy.nodes().filter((n: any) => matchesQuery(String(n.data('name')), n.data('aliases'), q));
		if (hits.empty()) return; // no match → leave the graph as-is
		// Single match → goto updates focusId → topbar shows name, $effect fires applyFocus.
		if (hits.length === 1) {
			clearTimeout(searchTimer);
			searchOpen = false; searchQ = ''; searchResults = [];
			cy.nodes().removeClass('search-hit');
			const id = Number(hits[0].id());
			localStorage.setItem('graph.focus', String(id));
			goto(`/graph?focus=${id}`, { noScroll: true, keepFocus: true });
			return;
		}
		cy.nodes().addClass('dim');
		cy.edges().addClass('dim');
		hits.removeClass('dim').addClass('search-hit');
		searchResults = hits.map((n: any) => {
			const meta = data.graph.nodes.find((x) => x.id === Number(n.id()))!;
			return { id: meta.id, name: meta.name, city: meta.city, image: meta.image };
		});
		// list only, no node movement / zoom
	}
	function openSearch() {
		if (engine === 'forcegraph') {
			searchAutoSwitched = true;
			layoutName = 'grid';
			setEngine('cytoscape', false).then(() => {
				searchOpen = true;
				queueMicrotask(() => searchInput?.focus());
			});
			return;
		}
		searchOpen = true;
		queueMicrotask(() => searchInput?.focus());
	}
	function closeSearch() {
		clearTimeout(searchTimer);
		searchOpen = false;
		searchQ = '';
		searchResults = [];
		cy?.nodes().removeClass('search-hit');
		if (searchAutoSwitched) {
			searchAutoSwitched = false;
			setEngine('forcegraph', false);
			return;
		}
		applyFocus(focusId);
	}

	function zoomBy(factor: number) {
		if (engine === 'forcegraph') { fgInstance?.zoom?.(fgInstance.zoom() * factor, 200); return; }
		if (!cy) return;
		cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: container.clientWidth / 2, y: container.clientHeight / 2 } });
	}
	function fit() {
		if (engine === 'forcegraph') { fgInstance?.zoomToFit?.(400, 40); return; }
		cy?.fit(undefined, 40);
	}

	// React to focus param + layout changes.
	let prevFocusId: number | null = null;
	$effect(() => {
		const wasFocused = prevFocusId != null;
		prevFocusId = focusId;
		if (focusId == null && wasFocused && searchAutoSwitched && !searchOpen) {
			searchAutoSwitched = false;
			setEngine('forcegraph', false);
			return;
		}
		applyFocus(focusId);
	});
	$effect(() => {
		layoutName;
		if (cy && focusId == null) runLayout();
	});
	$effect(() => {
		focusId;
		panel;
		menu;
		if (!cy) return;
		queueMicrotask(() => {
			updateLegendTransparency();
			updateVoiceButtonTransparency();
		});
	});

	onMount(() => {
		// Restore last focus when arriving without an explicit ?focus (e.g. via nav after editing).
		// Await the URL change first so initCy sees focusId set and settles positions before focusing.
		const saved = localStorage.getItem('graph.focus');
		(async () => {
			if (focusId == null && saved && data.graph.nodes.some((n) => n.id === Number(saved))) {
				await goto(`/graph?focus=${saved}`, { replaceState: true, noScroll: true, keepFocus: true });
			}
			if (engine === 'forcegraph') await initForceGraph();
			else await initCy();
		})();
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
				e.preventDefault();
				openSearch();
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
				const active = document.activeElement;
				const hasInputSel = (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.selectionStart !== active.selectionEnd;
				if (!hasInputSel && !window.getSelection()?.toString()) {
					e.preventDefault();
					if (searchOpen) closeSearch();
					openQuickConnect();
				}
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
				e.preventDefault();
				if (searchOpen) closeSearch();
				openQuickLocation();
			} else if (e.key === 'Escape') {
				if (quickConnect) closeQuickConnect();
				else if (quickLocation) closeQuickLocation();
				else if (searchOpen) closeSearch();
				else if (focusId != null) clearFocus();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			if (longPressTimer) clearTimeout(longPressTimer);
			setVoiceButtonDimmed(false);
			cy?.destroy();
			try { fgInstance?._destructor?.(); } catch { /* ignore */ }
		};
	});
</script>

<svelte:head><title>Graph – RelaTable</title></svelte:head>

<div class="graph-scene flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if focusId && focusName}
		<Topbar title={`Fokus: ${focusName}`}>
			<button class="btn btn-sm" onclick={clearFocus}>‹ Zurück</button>
		</Topbar>
	{:else}
		<Topbar title="Graph" subtitle={`${data.graph.nodes.length} Personen`} />
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="graph-canvas-wrap relative min-h-0 flex-1 overflow-hidden" oncontextmenu={(e) => e.preventDefault()}>
	<div class="graph-bg-text" aria-hidden="true">GRAPH</div>
	<div bind:this={container} class="absolute inset-0" style="touch-action: none"></div>

	<!-- Ctrl+F search: slides in top-centre -->
	{#if searchOpen}
		<div class="absolute left-1/2 top-3 z-30 -translate-x-1/2" transition:fly={{ y: -30, duration: 220 }}>
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
							if (searchActiveIdx >= 0 && searchResults[searchActiveIdx]) {
								const id = searchResults[searchActiveIdx].id;
								searchOpen = false; searchQ = ''; searchResults = []; searchActiveIdx = -1;
								localStorage.setItem('graph.focus', String(id));
								goto(`/graph?focus=${id}`, { noScroll: true, keepFocus: true });
								return;
							}
							const target = searchResults[0] ?? null;
							if (!target) return;
							searchOpen = false; searchQ = ''; searchResults = []; searchActiveIdx = -1;
							localStorage.setItem('graph.focus', String(target.id));
							goto(`/graph?focus=${target.id}`, { noScroll: true, keepFocus: true });
						}}
						placeholder="Name suchen…"
						class="w-48 bg-transparent text-sm outline-none"
						aria-label="Personen im Graph suchen"
					/>
					<button class="text-mut hover:text-ink" onclick={closeSearch} aria-label="Suche schließen">✕</button>
				</div>
				{#if searchResults.length}
					<div bind:this={searchListEl} class="search-results max-h-72 overflow-y-auto rounded-xl border border-line bg-card shadow-lg backdrop-blur-md">
						{#each searchResults as r, i}
							<button
								class="flex w-full items-center justify-between border-b border-line px-4 py-2 text-left last:border-0 hover:bg-accent/10 outline-none {i === searchActiveIdx ? 'bg-accent/15' : ''}"
								onclick={() => {
									const id = r.id;
									searchOpen = false; searchQ = ''; searchResults = []; searchActiveIdx = -1;
									localStorage.setItem('graph.focus', String(id));
									goto(`/graph?focus=${id}`, { noScroll: true, keepFocus: true });
								}}
							>
								<span class="text-sm font-medium">{r.name}</span>
								<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-bg bg-cover bg-center text-[10px] text-mut" style={r.image ? `background-image:url('${r.image}')` : ''}>{r.image ? '' : r.name[0]}</span>
								<span class="ml-3 shrink-0 text-xs text-mut">{r.city ?? '–'}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if data.graph.nodes.length === 0}
		<div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
			<span class="text-mut">Noch keine Verbindungen</span>
			<a class="btn btn-primary pointer-events-auto" href="/personen/neu">+ Person/Connection</a>
		</div>
	{/if}

	<!-- Legend (SCR-020 ②) -->
	<div
		bind:this={legendEl}
		data-testid="graph-legend-overlay"
		class={`absolute right-2.5 top-2.5 rounded-lg border border-line bg-card p-2 text-[11px] shadow-sm backdrop-blur-md transition-opacity duration-200 ${legendDimmed ? 'opacity-20' : 'opacity-100'}`}
	>
		<b>Legende</b>
		{#each data.legend as l}
			<div class="mt-0.5 flex items-center gap-1.5">
				<span class="inline-block h-0.5 w-4" style="background:{l.color}"></span>{l.label}
			</div>
		{/each}
	</div>

	<!-- Zoom controls -->
	<div class="absolute bottom-2.5 left-2.5 flex flex-col overflow-hidden rounded-md border border-line bg-card backdrop-blur-md">
		<button class="h-7 w-8 border-b border-line text-ink/70 hover:text-ink" onclick={() => zoomBy(1.25)} aria-label="Vergrößern">+</button>
		<button class="h-7 w-8 border-b border-line text-ink/70 hover:text-ink" onclick={() => zoomBy(0.8)} aria-label="Verkleinern">−</button>
		<button class="h-7 w-8 text-ink/70 hover:text-ink" onclick={fit} aria-label="Einpassen">⤢</button>
	</div>

	<!-- Node panel (single click) -->
	{#if panel}
		<div class="absolute z-20 w-52 rounded-lg border border-line bg-card p-2.5 shadow-lg backdrop-blur-md"
			style="left:{Math.min(panel.x + 12, (container?.clientWidth ?? 300) - 220)}px; top:{Math.min(panel.y + 12, (container?.clientHeight ?? 300) - 110)}px">
			<div class="flex items-center justify-between">
				<div>
					<b class="text-[13px]">{panel.name}</b>
					<div class="text-[11px] text-mut">{panel.city ?? 'Kein Ort'} · {panel.degree} Verbindungen</div>
				</div>
				<button class="text-mut hover:text-ink" onclick={() => (panel = null)} aria-label="Schließen">✕</button>
			</div>
			<div class="mt-2 flex gap-1.5">
				<a class="btn btn-sm flex-1 justify-center" href={`/personen/${panel.id}`}>Profil</a>
				<button class="btn btn-primary btn-sm flex-1 justify-center" onclick={() => panel && focusOn(panel.id)}>Fokus</button>
			</div>
		</div>
	{/if}

	<!-- Right-click / long-press context menu -->
	{#if menu}
		<div class="absolute z-20 w-44 overflow-hidden rounded-lg border border-line bg-card text-sm shadow-lg backdrop-blur-md"
			style="left:{clamp(menu.x - 88, 8, (container?.clientWidth ?? 300) - 184)}px; top:{menu.y}px">
			<a class="block border-b border-line px-3 py-2 hover:bg-bg" href={`/personen/${menu!.id}/bearbeiten?return=graph`}>Profil bearbeiten</a>
			<a class="block border-b border-line px-3 py-2 hover:bg-bg" href={`/personen/${menu!.id}/bearbeiten?pick=1&return=graph`}>Bild ändern</a>
			<a class="block border-b border-line px-3 py-2 hover:bg-bg" href={`/personen/${menu!.id}/review`}>Review Verbindung</a>
			<button class="block w-full border-b border-line px-3 py-2 text-left hover:bg-bg" onclick={() => openMergeDialog(menu!.id)}>Personen zusammenführen</button>
			<button class="block w-full border-b border-line px-3 py-2 text-left hover:bg-bg" onclick={() => menu && focusOn(menu.id)}>Fokussieren</button>
			<a
				class="block px-3 py-2 hover:bg-bg"
				href={`/karte?focus=${menu!.id}`}
				onclick={() => localStorage.setItem('graph.focus', String(menu!.id))}
			>Auf Karte</a>
		</div>
	{/if}

	{#if edgeMenu}
		<div class="absolute z-20 w-48 overflow-hidden rounded-lg border border-line bg-card text-sm shadow-lg backdrop-blur-md"
			style="left:{clamp(edgeMenu.x - 96, 8, (container?.clientWidth ?? 300) - 200)}px; top:{Math.min(edgeMenu.y, (container?.clientHeight ?? 300) - 200)}px">
			<div class="border-b border-line px-3 py-1.5 text-[11px] text-mut">Verbindungstyp ändern</div>
			{#each data.types as t}
				<form method="POST" action="?/changeType" use:enhance={() => async ({ result, update }) => {
					if (result.type !== 'failure') edgeMenu = null;
					await update();
				}}>
					<input type="hidden" name="low" value={edgeMenu.source} />
					<input type="hidden" name="high" value={edgeMenu.target} />
					<input type="hidden" name="typeId" value={t.id} />
					<button type="submit" class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg {edgeMenu.typeName === t.name ? 'font-semibold text-ink' : 'text-mut'}">
						<span class="inline-block h-2 w-2 shrink-0 rounded-full" style="background:{t.color}"></span>
						{t.name}
						{#if edgeMenu.typeName === t.name}<span class="ml-auto text-[10px] opacity-50">aktiv</span>{/if}
					</button>
				</form>
			{/each}
		</div>
	{/if}

	{#if mergeDialog}
		<div class="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-4">
			<div class="w-full max-w-lg rounded-xl border border-line bg-card shadow-xl">
				<div class="border-b border-line p-4">
					<b>Personen zusammenführen</b>
					<p class="mt-1 text-sm text-mut">Quelle: {mergeDialog.sourceName}. Die Zielperson bleibt bestehen und übernimmt Daten, Verbindungen und Alias-Namen.</p>
				</div>
				<form method="POST" action="?/merge" use:enhance={() => async ({ result, update }) => {
						if (result.type === 'redirect') { mergeDialog = null; }
						else { await update(); }
					}}>
					<input type="hidden" name="sourceId" value={mergeDialog.sourceId} />
					<div class="max-h-[50vh] overflow-auto p-4">
						{#if mergeDialog.candidates.length}
							<div class="space-y-2">
								{#each mergeDialog.candidates as candidate}
									<label class="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-bg">
										<input type="radio" name="targetId" value={candidate.id} bind:group={mergeDialog.selectedId} />
										<span class="min-w-0 flex-1">
											<b class="block">{candidate.name}</b>
											<span class="block text-xs text-mut">Ähnlichkeit: {Math.round(candidate.score * 100)}%</span>
											{#if candidate.aliases.length}
												<span class="mt-1 block text-xs text-mut">Alias: {candidate.aliases.join(', ')}</span>
											{/if}
										</span>
									</label>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-mut">Keine ähnlichen Namen gefunden. Lege sonst erst einen Alias an und versuche es erneut.</p>
						{/if}
						{#if form?.mergeError}
							<p class="mt-3 text-sm text-warn">{form.mergeError}</p>
						{/if}
					</div>
					<div class="flex justify-end gap-2 border-t border-line p-4">
						<button type="button" class="btn" onclick={() => (mergeDialog = null)}>Abbrechen</button>
						<button class="btn btn-primary" disabled={!mergeDialog.selectedId}>Zusammenführen</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	{#if quickLocation}
		<div class="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-4" transition:fly={{ y: -20, duration: 200 }}>
			<div class="w-full max-w-md rounded-xl border border-line bg-card shadow-xl">
				<div class="flex items-center justify-between border-b border-line px-4 py-3">
					<div>
						<b class="text-[13px]">Ort verwalten</b>
						<div class="mt-0.5 flex items-center gap-2 text-[11px] text-mut">
							{#each ([{ n: 1, label: 'Stadt' }, { n: 2, label: 'Personen' }] as const) as item}
								<span class="flex items-center gap-1 {quickLocation.step === item.n ? 'text-ink' : 'opacity-40'}">
									<span class="flex h-4 w-4 items-center justify-center rounded-full border text-[10px] {quickLocation.step === item.n ? 'border-accent bg-accent/20 text-ink' : 'border-line'}">{item.n}</span>
									{item.label}
								</span>
								{#if item.n < 2}<span class="opacity-30">›</span>{/if}
							{/each}
						</div>
					</div>
					<button class="text-mut hover:text-ink" onclick={closeQuickLocation} aria-label="Schließen">✕</button>
				</div>

				{#if quickLocation.step === 1}
					{@const newCity = qlSearch.trim()}
					{@const isNew = newCity.length > 0 && !allCities.some((c) => c.toLowerCase() === newCity.toLowerCase())}
					<div class="p-3">
						<input
							bind:this={qlInput1}
							bind:value={qlSearch}
							placeholder="Stadt suchen oder neu eingeben…"
							class="inp w-full text-sm"
							aria-label="Stadt suchen oder neu eingeben"
							onkeydown={(e) => {
								if (e.key === 'ArrowDown') { e.preventDefault(); qlActiveIdx = navIdx(qlActiveIdx, qlFilteredCities.length, 1); scrollActive(qlList1El, qlActiveIdx); return; }
								if (e.key === 'ArrowUp') { e.preventDefault(); qlActiveIdx = navIdx(qlActiveIdx, qlFilteredCities.length, -1); scrollActive(qlList1El, qlActiveIdx); return; }
								if (e.key === 'Enter') {
									e.preventDefault();
									if (isNew) { qlPickCity(newCity); return; }
									const c = qlActiveIdx >= 0 ? qlFilteredCities[qlActiveIdx] : qlFilteredCities[0];
									if (c) qlPickCity(c);
								}
							}}
						/>
					</div>
					<div bind:this={qlList1El} class="max-h-64 overflow-y-auto">
						{#if isNew}
							<button
								class="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left hover:bg-accent/10 outline-none"
								onclick={() => qlPickCity(newCity)}
							>
								<span class="text-xs text-accent">+ Neu</span>
								<span class="text-sm font-medium">{newCity}</span>
							</button>
						{/if}
						{#each qlFilteredCities as city, idx}
							<button
								class="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-accent/10 outline-none {idx === qlActiveIdx ? 'bg-accent/15' : ''}"
								onclick={() => qlPickCity(city)}
							>
								<span class="text-sm font-medium">{city}</span>
								<span class="ml-auto text-xs text-mut">{data.graph.nodes.filter((n) => n.city === city).length} Pers.</span>
							</button>
						{:else}
							{#if !isNew}<p class="px-4 py-3 text-sm text-mut">Keine Stadt – oben neue eingeben.</p>{/if}
						{/each}
					</div>

				{:else if quickLocation.step === 2}
					{@const ql2 = quickLocation}
					<form method="POST" action="?/assignCity" use:enhance={() => async ({ result, update }) => {
						if (result.type === 'failure') {
							alert((result.data as any)?.assignCityError ?? 'Fehler');
						} else {
							closeQuickLocation();
							await update();
						}
					}}>
						<input type="hidden" name="city" value={ql2.city} />
						{#each qlTargets as tid}
							<input type="hidden" name="personId" value={tid} />
						{/each}

						<div class="p-3">
							<p class="mb-2 text-[11px] text-mut">Stadt: <b class="text-ink">{ql2.city}</b></p>
							<input
								bind:this={qlInput2}
								bind:value={qlSearch}
								placeholder="Personen filtern…"
								class="inp w-full text-sm"
								aria-label="Personen filtern"
								onkeydown={(e) => {
									if (e.key === 'ArrowDown') { e.preventDefault(); qlActiveIdx = navIdx(qlActiveIdx, qlFilteredPersons.length, 1); scrollActive(qlList2El, qlActiveIdx); return; }
									if (e.key === 'ArrowUp') { e.preventDefault(); qlActiveIdx = navIdx(qlActiveIdx, qlFilteredPersons.length, -1); scrollActive(qlList2El, qlActiveIdx); return; }
									if (e.key === ' ' && qlActiveIdx >= 0) { e.preventDefault(); const p = qlFilteredPersons[qlActiveIdx]; if (p) { const next = new Set(qlTargets); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); qlTargets = next; } return; }
									if (e.key === 'Backspace' && qlSearch === '') { e.preventDefault(); quickLocation = { step: 1 }; qlSearch = ''; }
								}}
							/>
						</div>
						<div bind:this={qlList2El} class="max-h-60 overflow-y-auto border-t border-line">
							{#each qlFilteredPersons as p, idx}
								<label class="flex cursor-pointer items-center gap-3 border-b border-line px-4 py-2 last:border-0 hover:bg-bg {idx === qlActiveIdx ? 'bg-accent/10' : ''}">
									<input
										type="checkbox"
										checked={qlTargets.has(p.id)}
										onchange={(e) => {
											const next = new Set(qlTargets);
											if ((e.target as HTMLInputElement).checked) next.add(p.id); else next.delete(p.id);
											qlTargets = next;
										}}
										class="accent-accent"
									/>
									<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-bg bg-cover bg-center text-[10px] text-mut" style={p.image ? `background-image:url('${p.image}')` : ''}>{p.image ? '' : p.name[0]}</span>
									<span class="flex-1 text-sm">{p.name}</span>
									<span class="text-xs text-mut">{p.city ?? '–'}</span>
								</label>
							{:else}
								<p class="px-4 py-3 text-sm text-mut">Keine Person gefunden.</p>
							{/each}
						</div>

						<div class="flex items-center justify-between border-t border-line p-3">
							<button type="button" class="text-xs text-mut hover:text-ink" onclick={() => { quickLocation = { step: 1 }; qlSearch = ''; }}>‹ Zurück</button>
							<button class="btn btn-primary btn-sm" disabled={qlTargets.size === 0}>
								{qlTargets.size} Person{qlTargets.size !== 1 ? 'en' : ''} zuweisen
							</button>
						</div>
					</form>
				{/if}
			</div>
		</div>
	{/if}

	{#if quickConnect}
		<div class="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-4" transition:fly={{ y: -20, duration: 200 }}>
			<div class="w-full max-w-md rounded-xl border border-line bg-card shadow-xl">
				<!-- Header -->
				<div class="flex items-center justify-between border-b border-line px-4 py-3">
					<div>
						<b class="text-[13px]">Verbindung anlegen</b>
						<div class="mt-0.5 flex items-center gap-2 text-[11px] text-mut">
							{#each ([{ n: 1, label: 'Person' }, { n: 2, label: 'Typ' }, { n: 3, label: 'Ziele' }] as const) as item}
								<span class="flex items-center gap-1 {quickConnect.step === item.n ? 'text-ink' : 'opacity-40'}">
									<span class="flex h-4 w-4 items-center justify-center rounded-full border text-[10px] {quickConnect.step === item.n ? 'border-accent bg-accent/20 text-ink' : 'border-line'}">{item.n}</span>
									{item.label}
								</span>
								{#if item.n < 3}<span class="opacity-30">›</span>{/if}
							{/each}
						</div>
					</div>
					<button class="text-mut hover:text-ink" onclick={closeQuickConnect} aria-label="Schließen">✕</button>
				</div>

				{#if quickConnect.step === 1}
					<!-- Step 1: pick source -->
					<div class="p-3">
						<input
							bind:this={qcInput1}
							bind:value={qcSearch}
							placeholder="Person suchen…"
							class="inp w-full text-sm"
							aria-label="Quellperson suchen"
							onkeydown={(e) => {
								if (e.key === 'ArrowDown') { e.preventDefault(); qcActiveIdx = navIdx(qcActiveIdx, qcFilteredPersons.length, 1); scrollActive(qcList1El, qcActiveIdx); return; }
								if (e.key === 'ArrowUp') { e.preventDefault(); qcActiveIdx = navIdx(qcActiveIdx, qcFilteredPersons.length, -1); scrollActive(qcList1El, qcActiveIdx); return; }
								if (e.key === 'Enter') {
									e.preventDefault();
									const p = qcActiveIdx >= 0 ? qcFilteredPersons[qcActiveIdx] : qcFilteredPersons[0];
									if (p) { quickConnect = { step: 2, sourceId: p.id, sourceName: p.name }; qcSearch = ''; qcActiveIdx = -1; }
								}
							}}
						/>
					</div>
					<div bind:this={qcList1El} class="max-h-64 overflow-y-auto">
						{#each qcFilteredPersons as p, idx}
							<button
							class="flex w-full items-center justify-between border-b border-line px-4 py-2 text-left last:border-0 hover:bg-accent/10 outline-none {idx === qcActiveIdx ? 'bg-accent/15' : ''}"
							onclick={() => { quickConnect = { step: 2, sourceId: p.id, sourceName: p.name }; qcSearch = ''; qcActiveIdx = -1; }}
							>
								<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-bg bg-cover bg-center text-[10px] text-mut" style={p.image ? `background-image:url('${p.image}')` : ''}>{p.image ? '' : p.name[0]}</span>
								<span class="text-sm font-medium">{p.name}</span>
								<span class="text-xs text-mut">{p.city ?? '–'}</span>
							</button>
						{:else}
							<p class="px-4 py-3 text-sm text-mut">Keine Person gefunden.</p>
						{/each}
					</div>

				{:else if quickConnect.step === 2}
					<!-- Step 2: pick type -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div class="p-4" role="group" onkeydown={(e) => { if (e.key === 'Backspace' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); quickConnect = { step: 1 }; qcSearch = ''; } }}>
						<p class="mb-3 text-sm text-mut">Quelle: <b class="text-ink">{quickConnect.sourceName}</b></p>
						<div class="grid grid-cols-2 gap-2">
							{#each data.types as t}
								<button
									class="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-left text-sm hover:bg-bg"
									onclick={() => {
										if (quickConnect?.step === 2) {
											quickConnect = { step: 3, sourceId: quickConnect.sourceId, sourceName: quickConnect.sourceName, typeId: t.id, typeName: t.name };
											qcSearch = '';
											qcTargets = new Set();
										}
									}}
								>
									<span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style="background:{t.color}"></span>
									{t.name}
								</button>
							{/each}
						</div>
						<button class="mt-3 text-xs text-mut hover:text-ink" onclick={() => { quickConnect = { step: 1 }; qcSearch = ''; }}>‹ Zurück</button>
					</div>

				{:else if quickConnect.step === 3}
					{@const qc3 = quickConnect}
					<!-- Step 3: multi-select targets -->
					<form bind:this={qcForm} method="POST" action="?/quickConnect" use:enhance={() => async ({ result, update }) => {
						if (result.type === 'failure') {
							qcError = (result.data as any)?.quickConnectError ?? 'Fehler';
						} else {
							closeQuickConnect();
							await update();
						}
					}}>
						<input type="hidden" name="sourceId" value={qc3.sourceId} />
						<input type="hidden" name="typeId" value={qc3.typeId} />
						{#each qcTargets as tid}
							<input type="hidden" name="targetId" value={tid} />
						{/each}

						<div class="p-3">
							<p class="mb-2 text-[11px] text-mut">
								<b class="text-ink">{qc3.sourceName}</b>
								<span class="mx-1">›</span>
								<span class="inline-flex items-center gap-1"><span class="inline-block h-2 w-2 rounded-full" style="background:{data.types.find(t=>t.id===qc3.typeId)?.color}"></span>{qc3.typeName}</span>
								<span class="mx-1">›</span>
								{qcTargets.size} gewählt
							</p>
							<input
								bind:this={qcInput3}
								bind:value={qcSearch}
								placeholder="Personen filtern…"
								class="inp w-full text-sm"
								aria-label="Zielpersonen filtern"
								onkeydown={(e) => {
									if (e.key === 'ArrowDown') { e.preventDefault(); qcActiveIdx = navIdx(qcActiveIdx, qcFilteredPersons.length, 1); scrollActive(qcList3El, qcActiveIdx); return; }
									if (e.key === 'ArrowUp') { e.preventDefault(); qcActiveIdx = navIdx(qcActiveIdx, qcFilteredPersons.length, -1); scrollActive(qcList3El, qcActiveIdx); return; }
									if (e.key === ' ') { e.preventDefault(); const p = qcActiveIdx >= 0 ? qcFilteredPersons[qcActiveIdx] : qcFilteredPersons[0]; if (p) { const next = new Set(qcTargets); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); qcTargets = next; } return; }
									if (e.key === 'Enter') { e.preventDefault(); if (qcTargets.size > 0) qcForm?.requestSubmit(); return; }
									if (e.key === 'Backspace' && qcSearch === '' && qc3) {
										e.preventDefault();
										quickConnect = { step: 2, sourceId: qc3.sourceId, sourceName: qc3.sourceName };
										qcSearch = '';
									}
								}}
							/>
						</div>
						<div bind:this={qcList3El} class="max-h-56 overflow-y-auto border-t border-line">
							{#each qcFilteredPersons as p, idx}
								<label class="flex cursor-pointer items-center gap-3 border-b border-line px-4 py-2 last:border-0 hover:bg-bg {idx === qcActiveIdx ? 'bg-accent/10' : ''}">
									<input
										type="checkbox"
										checked={qcTargets.has(p.id)}
										onchange={(e) => {
											const next = new Set(qcTargets);
											if ((e.target as HTMLInputElement).checked) next.add(p.id); else next.delete(p.id);
											qcTargets = next;
										}}
										class="accent-accent"
									/>
								<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-bg bg-cover bg-center text-[10px] text-mut" style={p.image ? `background-image:url('${p.image}')` : ''}>{p.image ? '' : p.name[0]}</span>
									<span class="flex-1 text-sm">{p.name}</span>
									<span class="text-xs text-mut">{p.city ?? '–'}</span>
								</label>
							{:else}
								<p class="px-4 py-3 text-sm text-mut">Keine Person gefunden.</p>
							{/each}
						</div>

						{#if qcError}
							<p class="px-4 py-2 text-sm text-warn">{qcError}</p>
						{/if}

						<div class="flex items-center justify-between border-t border-line p-3">
							<button type="button" class="text-xs text-mut hover:text-ink" onclick={() => {
								if (quickConnect?.step === 3) quickConnect = { step: 2, sourceId: quickConnect.sourceId, sourceName: quickConnect.sourceName };
								qcSearch = '';
							}}>‹ Zurück</button>
							<button class="btn btn-primary btn-sm" disabled={qcTargets.size === 0}>
								{qcTargets.size} Verbindung{qcTargets.size !== 1 ? 'en' : ''} anlegen
							</button>
						</div>
					</form>
				{/if}
			</div>
		</div>
	{/if}

	</div>
</div>

<style>
	/* ── Cinematic graph scene ───────────────────────────────────────────────────
	   CSS custom properties cascade to all children incl. Topbar, overlays, btns.
	   Scoped to .graph-scene so the rest of the app is untouched.
	──────────────────────────────────────────────────────────────────────────── */
	.graph-scene {
		--c-ink: 172 188 162;
		--c-mut: 78 95 82;
		--c-line: 32 48 36;
		--c-bg: 5 8 6;
		--c-card: 10 16 12;
		--c-rail: 8 13 10;
		--c-accent: 120 158 72;
	}

	/* Near-black star-field canvas behind Cytoscape */
	.graph-canvas-wrap {
		background-color: #050908;
		/* Four layers of sparse "stars" at prime-number tile sizes for even distribution */
		background-image:
			radial-gradient(circle, rgba(242, 248, 228, 0.92) 0.7px, transparent 0),
			radial-gradient(circle, rgba(196, 228, 166, 0.65) 0.7px, transparent 0),
			radial-gradient(circle, rgba(176, 212, 148, 0.45) 1px, transparent 0),
			radial-gradient(circle, rgba(222, 242, 202, 0.32) 0.5px, transparent 0);
		background-size: 211px 197px, 347px 283px, 503px 431px, 157px 173px;
		background-position: 37px 71px, 127px 43px, 89px 156px, 63px 29px;
	}

	/* Subtle large background word — depth layer, not a headline */
	.graph-bg-text {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		z-index: 0;
		overflow: hidden;
		color: rgba(98, 152, 68, 0.038);
		font-size: min(22vw, 25vh);
		font-weight: 900;
		letter-spacing: -0.03em;
		user-select: none;
		white-space: nowrap;
		font-family: system-ui, sans-serif;
	}

	.search-results::-webkit-scrollbar { width: 4px; }
	.search-results::-webkit-scrollbar-track { background: transparent; }
	.search-results::-webkit-scrollbar-thumb { background: rgba(120, 158, 72, 0.45); border-radius: 2px; }

	/* Glass panels: semi-transparent so backdrop-blur shows the star field through */
	:global(.graph-scene .backdrop-blur-md) {
		background-color: rgba(10, 16, 12, 0.82) !important;
	}

	/* Topbar in the graph scene: lighter weight, techno spacing */
	:global(.graph-scene header) {
		background-color: rgba(8, 13, 10, 0.92);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}
	:global(.graph-scene header b) {
		font-weight: 500;
		letter-spacing: 0.06em;
		font-size: 12px;
		text-transform: uppercase;
		opacity: 0.85;
	}
	:global(.graph-scene header span.text-mut) {
		letter-spacing: 0.03em;
	}
</style>
