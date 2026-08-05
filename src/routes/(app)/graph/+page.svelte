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
	let engine = $state<'cytoscape' | 'forcegraph'>(
		browser ? ((localStorage.getItem('graph.engine') as 'forcegraph' | null) ?? 'cytoscape') : 'cytoscape'
	);
	// Filter: Personen ohne jede Verbindung (degree 0) ausblenden.
	let hideIsolated = $state(browser ? localStorage.getItem('graph.hideIsolated') === '1' : false);
	function visibleNodes() {
		return hideIsolated ? data.graph.nodes.filter((n) => n.degree > 0) : data.graph.nodes;
	}
	function toggleHideIsolated() {
		hideIsolated = !hideIsolated;
		localStorage.setItem('graph.hideIsolated', hideIsolated ? '1' : '0');
	}
	// Force-Layout: Abstoßung zwischen Personen + Verbindungslänge, einstellbar
	// damit sich Profilbilder bei vielen Beziehungen nicht gegenseitig verdecken.
	const DEFAULT_CHARGE = -30;
	const DEFAULT_LINK_DISTANCE = 30;
	let chargeStrength = $state(
		browser ? Number(localStorage.getItem('graph.chargeStrength') ?? DEFAULT_CHARGE) : DEFAULT_CHARGE
	);
	let linkDistance = $state(
		browser ? Number(localStorage.getItem('graph.linkDistance') ?? DEFAULT_LINK_DISTANCE) : DEFAULT_LINK_DISTANCE
	);
	let forceSettingsOpen = $state(false);
	function applyForceSettings() {
		if (!fgInstance) return;
		fgInstance.d3Force('charge')?.strength(chargeStrength);
		fgInstance.d3Force('link')?.distance(linkDistance);
		fgInstance.d3ReheatSimulation();
	}
	function onChargeInput() {
		localStorage.setItem('graph.chargeStrength', String(chargeStrength));
		applyForceSettings();
	}
	function onLinkDistanceInput() {
		localStorage.setItem('graph.linkDistance', String(linkDistance));
		applyForceSettings();
	}
	function resetForceSettings() {
		chargeStrength = DEFAULT_CHARGE;
		linkDistance = DEFAULT_LINK_DISTANCE;
		localStorage.setItem('graph.chargeStrength', String(DEFAULT_CHARGE));
		localStorage.setItem('graph.linkDistance', String(DEFAULT_LINK_DISTANCE));
		applyForceSettings();
	}
	const basePos = new Map<string, { x: number; y: number }>(); // layout positions, restored before each focus
	let layoutName = $state('circle');
	let panel = $state<null | { id: number; name: string; city: string | null; degree: number; x: number; y: number }>(null);
	let menu = $state<null | { id: number; name: string; x: number; y: number }>(null);
	let legendDimmed = $state(false);

	let searchOpen = $state(false);
	let searchQ = $state('');
	let searchInput: HTMLInputElement;
	let searchTimer: ReturnType<typeof setTimeout>;
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let suppressTapUntil = 0;
	let mergeDialog = $state<null | {
		sourceId: number;
		sourceName: string;
		candidates: { id: number; name: string; aliases: string[]; score: number }[];
		selectedId: number | null;
	}>(null);

	// Filter only after the user pauses typing for 500ms.
	function onSearchInput() {
		clearTimeout(searchTimer);
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
		const nodes = visibleNodes().map((n) => ({
			data: { id: String(n.id), name: n.name, aliases: n.aliases, image: n.image, degree: n.degree, isolated: n.degree === 0 }
		}));
		const edges = data.graph.edges.map((e) => ({
			data: { id: e.id, source: String(e.source), target: String(e.target), color: e.color }
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
		cy.on('tap', (evt: any) => {
			if (evt.target === cy) {
				panel = null;
				menu = null;
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
			data.graph.edges.map((e) => `${e.source}-${e.target}-${e.color}`).join(',') +
			'|' +
			hideIsolated
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
			nodes: visibleNodes().map((n) => ({ id: n.id, name: n.name, val: Math.max(1, n.degree), img: n.image })),
			links: data.graph.edges.map((e) => ({ source: e.source, target: e.target, color: e.color }))
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

		fgInstance = ForceGraph()(container)
			.width(container.clientWidth)
			.height(container.clientHeight)
			.backgroundColor('transparent')
			.graphData(buildFgData())
			.nodeLabel(() => '')
			.nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, gs: number) => {
				const r = nodeRadius(node.val || 1);
				const x: number = node.x, y: number = node.y;

				// Glow ring
				ctx.shadowBlur = 14;
				ctx.shadowColor = '#7aa040';
				ctx.beginPath();
				ctx.arc(x, y, r + 1.5, 0, 2 * Math.PI);
				ctx.strokeStyle = '#8aaa50';
				ctx.lineWidth = 1.5;
				ctx.stroke();
				ctx.shadowBlur = 0;

				// Photo clipped to circle (fallback: dark fill)
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

				// Name label
				const fs = Math.max(6, 9 / gs);
				ctx.font = `${fs}px system-ui,sans-serif`;
				ctx.fillStyle = 'rgba(172,188,162,0.9)';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				ctx.fillText(String(node.name), x, y + r + 2 / gs);
			})
			.nodePointerAreaPaint((node: any, color: string, ctx: CanvasRenderingContext2D) => {
				const r = nodeRadius(node.val || 1);
				ctx.beginPath();
				ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
				ctx.fillStyle = color;
				ctx.fill();
			})
			.linkColor((l: any) => l.color || 'rgba(255,255,255,0.18)')
			.linkWidth(0.8)
			.onNodeClick((node: any, event: MouseEvent) => {
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
			.onBackgroundClick(() => { panel = null; menu = null; mergeDialog = null; });
		applyForceSettings();
		graphReady = true;
		graphSig = graphSignature();
	}

	function destroyEngines() {
		cy?.destroy(); cy = null;
		try { fgInstance?._destructor?.(); } catch { /* ignore */ }
		fgInstance = null;
		if (container) container.innerHTML = '';
		graphReady = false;
	}

	async function setEngine(e: 'cytoscape' | 'forcegraph') {
		if (e === engine) return;
		engine = e;
		localStorage.setItem('graph.engine', e);
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
		if (!cy) return;
		cy.nodes().removeClass('hidden faded focus dim');
		cy.edges().removeClass('hidden dim focus-edge');
		cy.nodes().removeStyle('border-color border-width'); // clear any leftover flare from a previous focus
		if (id == null) {
			runLayout();
			return;
		}
		const node = cy.getElementById(String(id));
		if (node.empty()) return;
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

	// Ctrl/Cmd+F → slide-in search. Non-destructive: dim non-matches + pan/zoom the camera onto the
	// hits (no node repositioning — moving nodes per keystroke piled them onto the centre).
	function applySearch(raw: string) {
		if (!cy) return;
		const q = raw.trim().toLowerCase();
		cy.nodes().removeClass('dim search-hit');
		cy.edges().removeClass('dim');
		if (!q) {
			applyFocus(focusId); // restore normal/focus view
			return;
		}
		const hits = cy.nodes().filter((n: any) => String(n.data('name')).toLowerCase().includes(q));
		if (hits.empty()) return; // no match → leave the graph as-is (already un-dimmed above)
		// Exactly one match → focus it directly.
		if (hits.length === 1) {
			clearTimeout(searchTimer);
			searchOpen = false;
			searchQ = '';
			focusOn(Number(hits[0].id()));
			return;
		}
		// Multiple matches: dim everything else (connections stay visible but dimmed), highlight the
		// hits and bring them into the centre of the screen by moving the camera, not the nodes.
		cy.nodes().addClass('dim');
		cy.edges().addClass('dim');
		hits.removeClass('dim').addClass('search-hit');
		cy.animate({ fit: { eles: hits, padding: 90 }, duration: 450, easing: 'ease-in-out' });
	}
	function openSearch() {
		searchOpen = true;
		queueMicrotask(() => searchInput?.focus());
	}
	function closeSearch() {
		clearTimeout(searchTimer);
		searchOpen = false;
		searchQ = '';
		cy?.nodes().removeClass('search-hit');
		applyFocus(focusId);
	}

	function zoomBy(factor: number) {
		if (!cy) return;
		cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: container.clientWidth / 2, y: container.clientHeight / 2 } });
	}
	function fit() {
		cy?.fit(undefined, 40);
	}

	// React to focus param + layout changes.
	$effect(() => {
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
			} else if (e.key === 'Escape' && searchOpen) {
				closeSearch();
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

<div class="graph-scene relative flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if focusId && focusName}
		<Topbar title={`Fokus: ${focusName}`}>
			<button class="btn btn-sm" onclick={clearFocus}>‹ Zurück</button>
		</Topbar>
	{:else}
		<Topbar title="Graph" subtitle={`${data.graph.nodes.length} Personen`}>
			<div class="flex items-center gap-3">
				{#if engine === 'cytoscape'}
					<label class="flex items-center gap-1 text-xs text-mut">
						Layout
						<select class="inp btn-sm w-auto" bind:value={layoutName}>
							<option value="circle">Kreis</option>
							<option value="concentric">Konzentrisch</option>
							<option value="grid">Raster</option>
						</select>
					</label>
				{/if}
				<div class="flex overflow-hidden rounded border border-line text-xs">
					<button
						class="px-2 py-1 transition-colors {engine === 'cytoscape' ? 'bg-accent/20 text-ink' : 'text-mut hover:text-ink'}"
						onclick={() => setEngine('cytoscape')}
					>Cyto</button>
					<button
						class="border-l border-line px-2 py-1 transition-colors {engine === 'forcegraph' ? 'bg-accent/20 text-ink' : 'text-mut hover:text-ink'}"
						onclick={() => setEngine('forcegraph')}
					>Force</button>
				</div>
				<button
					class="rounded border border-line px-2 py-1 text-xs transition-colors {hideIsolated ? 'bg-accent/20 text-ink' : 'text-mut hover:text-ink'}"
					onclick={toggleHideIsolated}
					title="Personen ohne jede Beziehung ausblenden"
				>Isolierte ausblenden</button>
				{#if engine === 'forcegraph'}
					<button
						class="rounded border border-line px-2 py-1 text-xs transition-colors {forceSettingsOpen ? 'bg-accent/20 text-ink' : 'text-mut hover:text-ink'}"
						onclick={() => (forceSettingsOpen = !forceSettingsOpen)}
						title="Kraft-Einstellungen (Abstand der Personen)"
					>⚙ Kräfte</button>
				{/if}
			</div>
		</Topbar>
	{/if}

	{#if engine === 'forcegraph' && forceSettingsOpen}
		<div
			class="absolute right-2.5 top-14 z-30 w-64 rounded-lg border border-line bg-card p-3 text-xs shadow-lg backdrop-blur-md"
			transition:fly={{ y: -10, duration: 150 }}
		>
			<div class="mb-2 flex items-center justify-between">
				<b>Kraft-Einstellungen</b>
				<button class="text-mut hover:text-ink" onclick={() => (forceSettingsOpen = false)} aria-label="Schließen">✕</button>
			</div>
			<label class="flex flex-col gap-1">
				<span class="text-mut">Abstoßung (Abstand zwischen Personen)</span>
				<input
					type="range"
					min="-400"
					max="-5"
					step="5"
					bind:value={chargeStrength}
					oninput={onChargeInput}
				/>
			</label>
			<label class="mt-2.5 flex flex-col gap-1">
				<span class="text-mut">Verbindungslänge</span>
				<input
					type="range"
					min="10"
					max="250"
					step="5"
					bind:value={linkDistance}
					oninput={onLinkDistanceInput}
				/>
			</label>
			<button class="btn btn-sm mt-3 w-full" onclick={resetForceSettings}>Zurücksetzen</button>
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="graph-canvas-wrap relative min-h-0 flex-1 overflow-hidden" oncontextmenu={(e) => e.preventDefault()}>
	<div class="graph-bg-text" aria-hidden="true">GRAPH</div>
	<div bind:this={container} class="absolute inset-0" style="touch-action: none"></div>

	<!-- Ctrl+F search: slides in top-centre, pulls name matches to the middle live -->
	{#if searchOpen}
		<div class="absolute left-1/2 top-3 z-30 -translate-x-1/2" transition:fly={{ y: -30, duration: 220 }}>
			<div class="flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 shadow-lg backdrop-blur-md">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-mut">
					<circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
				</svg>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					bind:this={searchInput}
					bind:value={searchQ}
					oninput={onSearchInput}
					placeholder="Name suchen…"
					class="w-48 bg-transparent text-sm outline-none"
					aria-label="Personen im Graph suchen"
				/>
				<button class="text-mut hover:text-ink" onclick={closeSearch} aria-label="Suche schließen">✕</button>
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
			<a class="block px-3 py-2 hover:bg-bg" href={`/karte?person=${menu!.id}`}>Auf Karte</a>
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
