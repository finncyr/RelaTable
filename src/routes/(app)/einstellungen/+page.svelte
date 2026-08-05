<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import Topbar from '$lib/components/Topbar.svelte';
	import { applyThemeWithReveal, type Theme } from '$lib/theme';
	import { toast } from '$lib/toast.svelte';

	let { data, form } = $props();

	let theme = $state<Theme>(data.theme as Theme);
	let hideSensitive = $state(data.hideSensitive);
	let addingType = $state(false);
	let addingEvent = $state(false);
	let importJsonText = $state('');
	let importMode = $state<'preview' | 'apply'>('preview');
	let importing = $state(false);

	let aiKey = $state(''); // immer leer geladen — der Key kommt nie zum Client
	let aiKeySet = $state(data.aiKeySet);
	let aiModel = $state(data.aiModel || 'anthropic/claude-sonnet-4.5');
	let aiAutoApprove = $state(data.aiAutoApprove);
	let aiPragmaticMode = $state(data.aiPragmaticMode);
	let groqKey = $state('');
	let groqKeySet = $state(data.groqKeySet);

	onMount(() => {
		const sync = (event: Event) => {
			theme = (event as CustomEvent<{ theme: Theme }>).detail.theme;
		};
		window.addEventListener('relatable:theme-change', sync);
		return () => window.removeEventListener('relatable:theme-change', sync);
	});

	async function saveAi() {
		if (!aiAutoApprove) aiPragmaticMode = false;
		if (aiKey.trim()) {
			await setSetting('openRouterApiKey', aiKey.trim());
			aiKeySet = true;
			aiKey = '';
		}
		if (groqKey.trim()) {
			await setSetting('groqApiKey', groqKey.trim());
			groqKeySet = true;
			groqKey = '';
		}
		await setSetting('openRouterModel', aiModel.trim());
		await setSetting('narrateAutoApprove', String(aiAutoApprove));
		await setSetting('narratePragmaticMode', String(aiAutoApprove && aiPragmaticMode));
		toast('Einstellungen gespeichert');
	}

	const reportRows: { key: string; label: string }[] = [
		{ key: 'personsCreated', label: 'Personen neu' },
		{ key: 'personsReused', label: 'Personen vorhanden' },
		{ key: 'socialAccountsCreated', label: 'Social Accounts' },
		{ key: 'connectionsCreated', label: 'Verbindungen neu' },
		{ key: 'connectionsReused', label: 'Verbindungen vorhanden' },
		{ key: 'periodsCreated', label: 'Beziehungs-Zeiträume' },
		{ key: 'journalCreated', label: 'Tagebuch-Einträge' },
		{ key: 'eventsCreated', label: 'Ereignisse' },
		{ key: 'skipped', label: 'Übersprungen' }
	];

	async function setSetting(key: string, value: string) {
		await fetch('/api/setting', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ key, value })
		}).catch(() => {});
	}

	function chooseTheme(t: Theme, e: MouseEvent) {
		theme = t;
		// Circular reveal from the clicked button (Telegram-style).
		applyThemeWithReveal(t, e.clientX, e.clientY);
		setSetting('themePreference', t);
	}
	function toggleSensitive() {
		hideSensitive = !hideSensitive;
		setSetting('hideSensitiveByDefault', String(hideSensitive));
	}
</script>

<svelte:head><title>Einstellungen – RelaTable</title></svelte:head>

<Topbar title="Einstellungen" />

<div class="flex-1 scroll-smooth overflow-auto">
	<div class="mx-auto max-w-6xl p-4 sm:p-6">
		<div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-7 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
			<aside class="min-w-0">
				<nav class="settings-nav flex max-w-full gap-1 overflow-x-auto pb-2 lg:sticky lg:top-4 lg:flex-col lg:overflow-visible" aria-label="Einstellungsbereiche">
					{#each [
						['#allgemein', 'Allgemein'],
						['#typen', 'Typen & Regeln'],
						['#datenschutz', 'Datenschutz'],
						['#importe', 'Importe'],
						['#ki', 'KI & Sprache'],
						['#backup', 'Backup']
					] as item}
						<a class="flex min-h-10 flex-none items-center rounded-lg px-3 text-sm text-mut transition-colors hover:bg-card hover:text-ink" href={item[0]}>{item[1]}</a>
					{/each}
				</nav>
			</aside>

			<main class="min-w-0 max-w-3xl space-y-12">
				<section id="allgemein" class="scroll-mt-4">
					<div class="mb-4 flex items-end justify-between gap-3">
						<div><h2 class="text-lg font-semibold">Allgemein</h2><p class="mt-1 text-sm text-mut">Darstellung und Verhalten der App.</p></div>
						<span class="chip">{theme === 'System' ? 'Systemdesign' : theme === 'Light' ? 'Hell' : 'Dunkel'}</span>
					</div>
					<div class="card p-4">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div><b class="text-sm">Erscheinungsbild</b><p class="mt-0.5 text-xs text-mut">„System“ folgt automatisch der Einstellung deines Geräts.</p></div>
							<div class="flex min-w-64 overflow-hidden rounded-lg border border-line text-xs">
								{#each ['System', 'Light', 'Dark'] as t}
									<button class="min-h-10 flex-1 border-r border-line px-3 transition-colors last:border-r-0 {theme === t ? 'bg-accent/10 font-semibold text-accent' : 'hover:bg-bg'}" onclick={(e) => chooseTheme(t as Theme, e)}>
										{t === 'System' ? 'System' : t === 'Light' ? 'Hell' : 'Dunkel'}
									</button>
								{/each}
							</div>
						</div>
					</div>
				</section>

				<section id="typen" class="scroll-mt-4">
					<div class="mb-4 flex items-end justify-between gap-3">
						<div><h2 class="text-lg font-semibold">Typen &amp; Regeln</h2><p class="mt-1 text-sm text-mut">Begriffe, die Graph und Ereignisse strukturieren.</p></div>
						<span class="chip">{data.byCategory.length} Kategorien</span>
					</div>
					<div class="grid gap-4 xl:grid-cols-2">
						<article class="card p-4">
							<h3 class="text-sm font-semibold">Beziehungstypen</h3>
							<div class="mt-3 space-y-3 text-sm">
								{#each data.byCategory as cat}
									<div><div class="text-xs font-medium text-mut">{cat.name}</div><div class="mt-1 leading-6">{#each cat.types as t, i}{i > 0 ? ' · ' : ''}<span class={t.isActive ? '' : 'text-mut line-through'}>{t.name}</span>{/each}</div></div>
								{/each}
							</div>
							{#if addingType}
								<form method="POST" action="?/addContextType" use:enhance={() => async ({ update }) => { await update(); addingType = false; }} class="mt-4 flex flex-col gap-2 sm:flex-row">
									<input name="name" class="inp" placeholder="Neuer Kontext-Typ" required />
									<div class="flex gap-2"><button type="button" class="btn btn-sm" onclick={() => (addingType = false)}>Abbrechen</button><button class="btn btn-sm btn-primary">Anlegen</button></div>
								</form>
								{#if form?.typeError}<p class="mt-2 text-xs text-warn">{form.typeError}</p>{/if}
							{:else}
								<button class="btn btn-sm mt-4" onclick={() => (addingType = true)}>+ Kontext-Typ</button>
							{/if}
						</article>

						<article class="card p-4">
							<h3 class="text-sm font-semibold">Ereignistypen</h3>
							<div class="mt-2 divide-y divide-line text-sm">
								{#each data.eventTypes as et (et.id)}
									<div class="flex min-h-11 items-center justify-between gap-3 py-1.5">
										<span class={et.sensitivity === 'sensitive' ? 'text-warn' : ''}>{et.name}{#if et.sensitivity === 'sensitive'}<span class="text-xs text-mut"> · sensibel</span>{/if}</span>
										<form method="POST" action="?/toggleEventSensitivity" use:enhance>
											<input type="hidden" name="id" value={et.id} />
											<button class="btn btn-sm">{et.sensitivity === 'sensitive' ? 'Als normal markieren' : 'Als sensibel markieren'}</button>
										</form>
									</div>
								{/each}
							</div>
							{#if addingEvent}
								<form method="POST" action="?/addEventType" use:enhance={() => async ({ update }) => { await update(); addingEvent = false; }} class="mt-4 space-y-2">
									<input name="name" class="inp" placeholder="Neuer Ereignistyp" required />
									<label class="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" name="sensitive" /> Als sensibel markieren</label>
									<div class="flex justify-end gap-2"><button type="button" class="btn btn-sm" onclick={() => (addingEvent = false)}>Abbrechen</button><button class="btn btn-sm btn-primary">Anlegen</button></div>
								</form>
								{#if form?.eventError}<p class="mt-2 text-xs text-warn">{form.eventError}</p>{/if}
							{:else}
								<button class="btn btn-sm mt-4" onclick={() => (addingEvent = true)}>+ Ereignistyp</button>
							{/if}
						</article>
					</div>

					<details class="card group mt-4">
						<summary class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium"><span>Ausschlussregeln anzeigen</span><span class="text-mut transition-transform group-open:rotate-180">⌄</span></summary>
						<div class="border-t border-line px-4 py-3 text-sm leading-7 text-mut">
							{#each data.ruleText as r}<div>• {r}</div>{/each}
							<div>• „Sex“ ist ein Ereignis und ändert den Beziehungsstatus nicht.</div>
							<p class="mt-2 text-xs">Bereits verwendete Typen werden beim Entfernen deaktiviert, damit die Historie erhalten bleibt.</p>
						</div>
					</details>
				</section>

				<section id="datenschutz" class="scroll-mt-4">
					<div class="mb-4 flex items-end justify-between gap-3">
						<div><h2 class="text-lg font-semibold">Datenschutz</h2><p class="mt-1 text-sm text-mut">Sensible Einträge beim Öffnen der App schützen.</p></div>
						<span class="chip">{hideSensitive ? 'Standardmäßig verborgen' : 'Standardmäßig sichtbar'}</span>
					</div>
					<div class="card flex items-center justify-between gap-4 p-4">
						<div><b class="text-sm">Sensible Inhalte verbergen</b><p class="mt-0.5 text-xs text-mut">Sie lassen sich in der jeweiligen Ansicht weiterhin gezielt einblenden.</p></div>
						<button class="relative h-11 w-12 flex-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55" onclick={toggleSensitive} aria-pressed={hideSensitive} aria-label="Sensible Inhalte standardmäßig verbergen">
							<span class="absolute left-0 top-2 h-7 w-12 rounded-full transition-colors {hideSensitive ? 'bg-accent' : 'bg-line'}"><span class="absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all {hideSensitive ? 'left-6' : 'left-1'}"></span></span>
						</button>
					</div>
				</section>

				<section id="importe" class="scroll-mt-4">
					<div class="mb-4"><h2 class="text-lg font-semibold">Importe</h2><p class="mt-1 text-sm text-mut">Daten erst prüfen und dann kontrolliert übernehmen.</p></div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="card flex flex-col items-start p-4"><h3 class="text-sm font-semibold">Instagram</h3><p class="mt-1 flex-1 text-xs leading-5 text-mut">Followings auswählen und vorhandenen Personen zuordnen.</p><a href="/import/instagram" class="btn btn-sm mt-4">Import öffnen</a></div>
						<details class="card group"><summary class="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold"><span>Notion</span><span class="text-mut transition-transform group-open:rotate-180">⌄</span></summary><div class="border-t border-line px-4 py-3 text-xs leading-5 text-mut">Der einmalige Notion-Import wird auf dem Server mit <code>npm run import:notion</code> gestartet.</div></details>
					</div>

					<details class="card group mt-4" open={!!form?.import}>
						<summary class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"><span><b class="text-sm">JSON-Import</b><span class="mt-0.5 block text-xs font-normal text-mut">Personen, Verbindungen und Ereignisse mit Vorschau importieren.</span></span><span class="text-mut transition-transform group-open:rotate-180">⌄</span></summary>
						<div class="border-t border-line p-4 text-sm">
							<p class="text-xs leading-5 text-mut">„Vorschau“ prüft und zählt, ohne Daten zu schreiben. Erst „Importieren“ übernimmt den Inhalt.</p>
							<form method="POST" action="?/importJson" use:enhance={() => { importing = true; return async ({ update }) => { await update({ reset: false }); importing = false; }; }} class="mt-3">
								<textarea name="json" bind:value={importJsonText} rows="8" spellcheck="false" class="inp w-full font-mono text-[12px]" placeholder={'{\n  "persons": [ … ],\n  "connections": [ … ],\n  "events": [ … ]\n}'}></textarea>
								<input type="hidden" name="mode" value={importMode} />
								<div class="mt-3 flex flex-wrap items-center gap-2"><button class="btn btn-sm" disabled={importing} onclick={() => (importMode = 'preview')}>Vorschau</button><button class="btn btn-sm btn-primary" disabled={importing} onclick={() => (importMode = 'apply')}>Importieren</button>{#if importing}<span class="text-xs text-mut">Import läuft …</span>{/if}</div>
							</form>
							{#if form?.import}
								{@const r = form.import as import('$lib/server/jsonImport').ImportResult}
								<div class="mt-4 rounded-lg border border-line p-3 text-xs">
									{#if r.error}<p class="text-warn">⚠ {r.error}</p>{:else if r.report}<p class="font-semibold">{r.mode === 'apply' ? '✓ Importiert' : 'Vorschau abgeschlossen'} — {r.mode === 'apply' ? 'Daten wurden übernommen' : 'noch nichts geschrieben'}</p><div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">{#each reportRows as row}<div class="flex justify-between gap-2"><span class="text-mut">{row.label}</span><span class="tabular-nums">{r.report[row.key as keyof typeof r.report] ?? 0}</span></div>{/each}</div>{/if}
									{#if r.warnings?.length}<ul class="mt-3 list-disc pl-4 text-warn">{#each r.warnings as w}<li>{w}</li>{/each}</ul>{/if}
								</div>
							{/if}
						</div>
					</details>
				</section>

				<section id="ki" class="scroll-mt-4">
					<div class="mb-4 flex items-end justify-between gap-3"><div><h2 class="text-lg font-semibold">KI &amp; Sprache</h2><p class="mt-1 text-sm text-mut">Dienste für die Mikrofon-Erzählung im Graph.</p></div><span class="chip">{aiKeySet ? 'OpenRouter verbunden' : 'Nicht eingerichtet'}</span></div>
					<details class="card group" open={!aiKeySet}>
						<summary class="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold"><span>Verbindungen konfigurieren</span><span class="text-mut transition-transform group-open:rotate-180">⌄</span></summary>
						<div class="space-y-3 border-t border-line p-4 text-sm">
							<p class="text-xs leading-5 text-mut">Schlüssel werden nur serverseitig verwendet und nach dem Speichern nicht mehr angezeigt. OpenRouter-Schlüssel erhältst du unter <a class="underline hover:text-ink" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.</p>
							<label class="block"><span class="label mb-1">OpenRouter API-Key {aiKeySet ? '· gesetzt' : ''}</span><input type="password" bind:value={aiKey} autocomplete="off" placeholder={aiKeySet ? 'Leer lassen = unverändert' : 'sk-or-…'} class="inp" /></label>
							<label class="block"><span class="label mb-1">Groq API-Key {groqKeySet ? '· gesetzt' : '· für Desktop-Spracherkennung'}</span><input type="password" bind:value={groqKey} autocomplete="off" placeholder={groqKeySet ? 'Leer lassen = unverändert' : 'gsk_…'} class="inp" /></label>
							<label class="block"><span class="label mb-1">Modell</span><select bind:value={aiModel} class="inp"><option value="z-ai/glm-5.2">GLM-5.2 (Zhipu — günstig, stark)</option><option value="moonshotai/kimi-k2.7-code">Kimi K2.7 Code (Moonshot)</option><option value="anthropic/claude-sonnet-4.5">Claude Sonnet 4.5 (Premium)</option>{#if aiModel && !['z-ai/glm-5.2', 'moonshotai/kimi-k2.7-code', 'anthropic/claude-sonnet-4.5'].includes(aiModel)}<option value={aiModel}>{aiModel} (eigenes Modell)</option>{/if}</select></label>
							<label class="flex min-h-11 items-start gap-3 py-1"><input type="checkbox" bind:checked={aiAutoApprove} onchange={() => { if (!aiAutoApprove) aiPragmaticMode = false; }} class="mt-1" /><span>Automatisch übernehmen<span class="mt-0.5 block text-xs leading-5 text-mut">Aus (empfohlen): Änderungen werden vor dem Schreiben zusammengefasst und bestätigt.</span></span></label>
							<label class="flex min-h-11 items-start gap-3 py-1 {aiAutoApprove ? '' : 'opacity-55'}"><input type="checkbox" bind:checked={aiPragmaticMode} disabled={!aiAutoApprove} class="mt-1" /><span>Ohne Rückfragen minimal anlegen<span class="mt-0.5 block text-xs leading-5 text-mut">Fehlende Details bleiben leer, statt den Vorgang zu unterbrechen.</span></span></label>
							<button class="btn btn-primary" onclick={saveAi}>KI-Einstellungen speichern</button>
						</div>
					</details>
				</section>

				<section id="backup" class="scroll-mt-4 pb-8">
					<div class="mb-4"><h2 class="text-lg font-semibold">Backup</h2><p class="mt-1 text-sm text-mut">Datenbank und Profilbilder als ein Paket sichern.</p></div>
					<div class="card flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><b class="text-sm">Vollständige Sicherung</b><p class="mt-0.5 text-xs text-mut">Enthält deine Datenbank und alle lokal gespeicherten Bilder.</p></div><a class="btn btn-primary flex-none" href="/api/backup" download>Backup herunterladen</a></div>
				</section>
			</main>
		</div>
	</div>
</div>

<style>
	.settings-nav {
		scrollbar-width: none;
	}
	.settings-nav::-webkit-scrollbar {
		display: none;
	}
</style>
