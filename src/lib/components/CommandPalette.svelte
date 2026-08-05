<script lang="ts">
	import { goto } from '$app/navigation';
	import { fade, scale } from 'svelte/transition';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';

	type PersonHit = { id: number; name: string; city: string | null; image: string | null; aliases: string[] };
	type Command = { label: string; hint: string; icon: IconName; href: string };

	const COMMANDS: Command[] = [
		{ label: 'Graph', hint: 'Ansicht', icon: 'graph', href: '/graph' },
		{ label: 'Personen', hint: 'Ansicht', icon: 'people', href: '/personen' },
		{ label: 'Ereignisse', hint: 'Ansicht', icon: 'events', href: '/ereignisse' },
		{ label: 'Karte', hint: 'Ansicht', icon: 'map', href: '/karte' },
		{ label: 'Einstellungen', hint: 'Ansicht', icon: 'settings', href: '/einstellungen' },
		{ label: 'Neue Person', hint: 'Anlegen', icon: 'plus', href: '/personen/neu' },
		{ label: 'Neues Ereignis', hint: 'Anlegen', icon: 'plus', href: '/ereignisse/neu' },
		{ label: 'Neue Verbindung', hint: 'Anlegen', icon: 'plus', href: '/verbindung/neu' }
	];

	let open = $state(false);
	let q = $state('');
	let activeIdx = $state(0);
	let inputEl = $state<HTMLInputElement | undefined>();
	let listEl = $state<HTMLDivElement | undefined>();
	let persons = $state<PersonHit[] | null>(null); // lazy, fetched on first open

	const nq = $derived(q.trim().toLowerCase());
	const cmdHits = $derived(nq ? COMMANDS.filter((c) => c.label.toLowerCase().includes(nq)) : COMMANDS);
	const personHits = $derived.by(() => {
		if (!persons) return [];
		if (!nq) return [];
		return persons
			.filter(
				(p) =>
					p.name.toLowerCase().includes(nq) ||
					p.aliases.some((a) => a.toLowerCase().includes(nq)) ||
					(p.city ?? '').toLowerCase().includes(nq)
			)
			.slice(0, 8);
	});
	// Flat result list: persons first (they're what you usually search), then commands.
	const results = $derived([
		...personHits.map((p) => ({ kind: 'person' as const, person: p })),
		...cmdHits.map((c) => ({ kind: 'command' as const, command: c }))
	]);

	$effect(() => {
		nq;
		activeIdx = 0;
	});

	async function openPalette() {
		open = true;
		q = '';
		activeIdx = 0;
		queueMicrotask(() => inputEl?.focus());
		if (!persons) {
			try {
				persons = await (await fetch('/api/persons')).json();
			} catch {
				persons = [];
			}
		}
	}
	function close() {
		open = false;
		q = '';
	}
	function pick(i: number) {
		const r = results[i];
		if (!r) return;
		close();
		goto(r.kind === 'person' ? `/personen/${r.person.id}` : r.command.href);
	}
	function onWindowKey(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			if (open) close();
			else openPalette();
		}
	}
	function onInputKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation(); // keep page-level Esc handlers (graph focus etc.) out of this
			close();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIdx = results.length ? (activeIdx + 1) % results.length : 0;
			scrollActive();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIdx = results.length ? (activeIdx - 1 + results.length) % results.length : 0;
			scrollActive();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			pick(activeIdx);
		}
	}
	function scrollActive() {
		queueMicrotask(() => (listEl?.querySelector('[data-active="true"]') as HTMLElement)?.scrollIntoView({ block: 'nearest' }));
	}
</script>

<svelte:window onkeydown={onWindowKey} />

{#if open}
	<div
		class="fixed inset-0 z-[850] bg-black/40 backdrop-blur-[2px]"
		role="button"
		tabindex="-1"
		aria-label="Schließen"
		onclick={close}
		onkeydown={(e) => e.key === 'Escape' && close()}
		transition:fade={{ duration: 150 }}
	></div>
	<div class="pointer-events-none fixed inset-x-0 top-[14vh] z-[860] flex justify-center px-4">
		<div
			class="pointer-events-auto w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-card shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-label="Schnellsuche"
			transition:scale={{ duration: 180, start: 0.96 }}
		>
			<div class="flex items-center gap-2.5 border-b border-line px-4 py-3">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-mut">
					<circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
				</svg>
				<input
					bind:this={inputEl}
					bind:value={q}
					onkeydown={onInputKey}
					placeholder="Person suchen oder Befehl…"
					class="flex-1 bg-transparent text-sm outline-none placeholder:text-mut"
					aria-label="Suche"
				/>
				<kbd class="rounded border border-line px-1.5 py-0.5 text-[10px] text-mut">Esc</kbd>
			</div>
			<div bind:this={listEl} class="max-h-[50vh] overflow-y-auto p-1.5">
				{#if nq && persons === null}
					<p class="px-3 py-2 text-xs text-mut">Lade Personen…</p>
				{/if}
				{#each results as r, i (r.kind === 'person' ? `p${r.person.id}` : r.command.href)}
					{#if i === personHits.length && personHits.length > 0}
						<div class="mx-2 my-1 border-t border-line"></div>
					{/if}
					<button
						class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors {i === activeIdx
							? 'bg-accent/10 text-accent'
							: 'text-ink hover:bg-bg'}"
						data-active={i === activeIdx}
						onclick={() => pick(i)}
						onmouseenter={() => (activeIdx = i)}
					>
						{#if r.kind === 'person'}
							<span
								class="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-line bg-rail bg-cover bg-center text-[10px] text-mut"
								style={r.person.image ? `background-image:url('${r.person.image}')` : ''}
							>{r.person.image ? '' : r.person.name[0]}</span>
							<span class="min-w-0 flex-1 truncate font-medium">{r.person.name}</span>
							<span class="flex-none text-xs text-mut">{r.person.city ?? ''}</span>
						{:else}
								<span class="flex h-7 w-7 flex-none items-center justify-center" aria-hidden="true"><Icon name={r.command.icon} size={18} /></span>
							<span class="min-w-0 flex-1 truncate">{r.command.label}</span>
							<span class="flex-none text-[11px] text-mut">{r.command.hint}</span>
						{/if}
					</button>
				{:else}
					{#if nq}
						<p class="px-3 py-4 text-center text-sm text-mut">Nichts gefunden für „{q}"</p>
					{/if}
				{/each}
			</div>
			<div class="flex items-center gap-3 border-t border-line px-4 py-2 text-[10px] text-mut">
				<span><kbd class="rounded border border-line px-1">↑↓</kbd> wählen</span>
				<span><kbd class="rounded border border-line px-1">↵</kbd> öffnen</span>
				<span class="ml-auto">Strg+K</span>
			</div>
		</div>
	</div>
{/if}
