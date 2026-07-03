<script lang="ts">
	import { enhance } from '$app/forms';
	import Topbar from '$lib/components/Topbar.svelte';
	import { applyTheme, type Theme } from '$lib/theme';

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
	let aiSaved = $state(false);

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
		aiSaved = true;
		setTimeout(() => (aiSaved = false), 2000);
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

	function chooseTheme(t: Theme) {
		theme = t;
		applyTheme(t);
		setSetting('themePreference', t);
	}
	function toggleSensitive() {
		hideSensitive = !hideSensitive;
		setSetting('hideSensitiveByDefault', String(hideSensitive));
	}
</script>

<svelte:head><title>Einstellungen – RelaTable</title></svelte:head>

<Topbar title="Einstellungen" />

<div class="flex-1 overflow-auto p-3.5">
	<div class="mx-auto flex max-w-4xl flex-col gap-5">
		<!-- Relationship types + exclusion rules (SCR-081) -->
		<section class="flex flex-wrap gap-4">
			<div class="min-w-[300px] flex-1">
				<b class="text-[13px]">Kategorien &amp; Typen</b>
				<div class="card mt-1.5 p-3 text-[13px]">
					{#each data.byCategory as cat}
						<div class="mb-2">
							<div class="text-mut">{cat.name}</div>
							<div>
								{#each cat.types as t, i}{i > 0 ? ' · ' : ''}<span class={t.isActive ? '' : 'text-mut line-through'}>{t.name}</span>{/each}
							</div>
						</div>
					{/each}
					{#if addingType}
						<form method="POST" action="?/addContextType" use:enhance={() => async ({ update }) => { await update(); addingType = false; }} class="mt-2 flex gap-2">
							<input name="name" class="inp" placeholder="Neuer Kontext-Typ" required />
							<button class="btn btn-sm btn-primary">Anlegen</button>
						</form>
						{#if form?.typeError}<p class="mt-1 text-[11px] text-warn">{form.typeError}</p>{/if}
					{:else}
						<button class="btn btn-sm mt-1" onclick={() => (addingType = true)}>+ Kontext-Typ</button>
					{/if}
				</div>
			</div>
			<div class="min-w-[300px] flex-1">
				<b class="text-[13px]">Ausschlussregeln</b>
				<div class="card mt-1.5 p-3 text-[13px] leading-7">
					{#each data.ruleText as r}<div>• {r}</div>{/each}
					<div class="mt-1 text-mut">• „Sex" ist ein Ereignis und ändert den Status nicht.</div>
					<p class="mt-2 text-[11px] text-mut">Typ in Nutzung wird deaktiviert statt gelöscht; Historie bleibt gültig (AC-120).</p>
				</div>
			</div>
		</section>

		<!-- Event types, theme, sensitive, backup (SCR-082) -->
		<section class="flex flex-wrap gap-4">
			<div class="min-w-[260px] flex-1">
				<b class="text-[13px]">Ereignistypen</b>
				<div class="card mt-1.5 p-3 text-[13px]">
					{#each data.eventTypes as et (et.id)}
						<div class="flex items-center justify-between py-0.5">
							<span class={et.sensitivity === 'sensitive' ? 'text-warn' : ''}>{et.name}{#if et.sensitivity === 'sensitive'}<span class="text-mut"> (sensibel)</span>{/if}</span>
							<form method="POST" action="?/toggleEventSensitivity" use:enhance>
								<input type="hidden" name="id" value={et.id} />
								<button class="text-[11px] text-mut underline">{et.sensitivity === 'sensitive' ? 'normal' : 'sensibel'}</button>
							</form>
						</div>
					{/each}
					{#if addingEvent}
						<form method="POST" action="?/addEventType" use:enhance={() => async ({ update }) => { await update(); addingEvent = false; }} class="mt-2">
							<input name="name" class="inp" placeholder="Neuer Ereignistyp" required />
							<label class="mt-1 flex items-center gap-2 text-[11px]"><input type="checkbox" name="sensitive" /> als sensibel markieren</label>
							<div class="mt-1 flex justify-end gap-2"><button type="button" class="btn btn-sm" onclick={() => (addingEvent = false)}>Abbrechen</button><button class="btn btn-sm btn-primary">Anlegen</button></div>
						</form>
						{#if form?.eventError}<p class="mt-1 text-[11px] text-warn">{form.eventError}</p>{/if}
					{:else}
						<button class="btn btn-sm mt-1.5" onclick={() => (addingEvent = true)}>+ Ereignistyp</button>
					{/if}
				</div>
			</div>

			<div class="min-w-[240px] flex-1">
				<b class="text-[13px]">Theme</b>
				<div class="card mt-1.5 p-3">
					<div class="flex overflow-hidden rounded-md border border-line text-xs">
						{#each ['System', 'Light', 'Dark'] as t}
							<button class="flex-1 border-r border-line py-1.5 last:border-r-0 {theme === t ? 'bg-line/60 font-semibold' : ''}" onclick={() => chooseTheme(t as Theme)}>
								{t === 'System' ? 'System' : t === 'Light' ? 'Hell' : 'Dunkel'}
							</button>
						{/each}
					</div>
					<p class="mt-1.5 text-[11px] text-mut">folgt System bis manuell gewählt (DEC-015)</p>
				</div>

				<b class="mt-2.5 block text-[13px]">Sensible Inhalte</b>
				<div class="card mt-1.5 flex items-center justify-between p-3 text-[13px]">
					<span>Standard verbergen</span>
					<button
						class="relative h-[18px] w-[34px] rounded-full {hideSensitive ? 'bg-[#3a6ea5]' : 'bg-line'}"
						onclick={toggleSensitive}
						aria-pressed={hideSensitive}
						aria-label="Sensible Inhalte standardmäßig verbergen"
					>
						<span class="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all {hideSensitive ? 'left-[18px]' : 'left-0.5'}"></span>
					</button>
				</div>
			</div>

			<div class="min-w-[240px] flex-1">
				<b class="text-[13px]">Backup / Restore</b>
				<div class="card mt-1.5 p-3 text-[13px]">
					<a class="btn btn-sm" href="/api/backup" download>Backup erstellen</a>
					<span class="ml-1.5 text-[11px] text-mut">DB + Bilder als ein Paket</span>
					<p class="mt-2 text-[11px] text-mut">Restore: Paket nach <code>data/</code> entpacken &amp; App neu starten. Niedrige Priorität (DEC-031).</p>
				</div>
				<b class="mt-2.5 block text-[13px]">Notion-Import</b>
				<div class="card mt-1.5 p-3 text-[11px] text-mut">
					Notion-Import erfolgt einmalig &amp; programmatisch: <code>npm run import:notion</code> (DEC-024/003).
				</div>
			</div>
		</section>

		<!-- KI / Erzählung (Mikrofon → OpenRouter) -->
		<section>
			<b class="text-[13px]">KI / Erzählung</b>
			<div class="card mt-1.5 flex max-w-md flex-col gap-2 p-3 text-[13px]">
				<p class="text-[11px] text-mut">
					Für die Mikrofon-Erzählung im Graph. API-Key von
					<a class="underline" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.
					Der Key wird nur serverseitig genutzt und nie wieder angezeigt.
				</p>
				<label class="flex flex-col gap-1">
					<span>OpenRouter API-Key {#if aiKeySet}<span class="text-mut">(gesetzt)</span>{/if}</span>
					<input
						type="password"
						bind:value={aiKey}
						autocomplete="off"
						placeholder={aiKeySet ? '•••••••• — leer lassen = unverändert' : 'sk-or-…'}
						class="inp"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span>Groq API-Key <span class="text-[11px] text-mut">(Spracherkennung Desktop)</span> {#if groqKeySet}<span class="text-mut">(gesetzt)</span>{/if}</span>
					<input
						type="password"
						bind:value={groqKey}
						autocomplete="off"
						placeholder={groqKeySet ? '•••••••• — leer lassen = unverändert' : 'gsk_…'}
						class="inp"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span>Modell</span>
					<!-- ponytail: echtes <select>. Neues Modell = eine <option>-Zeile. -->
					<select bind:value={aiModel} class="inp">
						<option value="z-ai/glm-5.2">GLM-5.2 (Zhipu — günstig, stark)</option>
						<option value="moonshotai/kimi-k2.7-code">Kimi K2.7 Code (Moonshot)</option>
						<option value="anthropic/claude-sonnet-4.5">Claude Sonnet 4.5 (Premium)</option>
						{#if aiModel && !['z-ai/glm-5.2', 'moonshotai/kimi-k2.7-code', 'anthropic/claude-sonnet-4.5'].includes(aiModel)}
							<option value={aiModel}>{aiModel} (eigene)</option>
						{/if}
					</select>
				</label>
				<label class="flex items-start gap-2">
					<input
						type="checkbox"
						bind:checked={aiAutoApprove}
						onchange={() => {
							if (!aiAutoApprove) aiPragmaticMode = false;
						}}
						class="mt-0.5"
					/>
					<span>
						Automatisch übernehmen
						<span class="block text-[11px] text-mut">
							An: Die KI legt Personen/Ereignisse direkt an. Aus (Standard): Sie fasst erst
							zusammen, was sie anlegen würde, und fragt um Bestätigung.
						</span>
					</span>
				</label>
				<label class="flex items-start gap-2 {aiAutoApprove ? '' : 'opacity-55'}">
					<input type="checkbox" bind:checked={aiPragmaticMode} disabled={!aiAutoApprove} class="mt-0.5" />
					<span>
						Ohne Rückfragen minimal anlegen
						<span class="block text-[11px] text-mut">
							Nur mit automatischer Übernahme: Die KI fragt fehlende Details nicht ab,
							sondern legt sichere Mindestdaten an und lässt Unbekanntes leer.
						</span>
					</span>
				</label>
				<div class="flex items-center gap-2">
					<button class="btn btn-sm btn-primary" onclick={saveAi}>Speichern</button>
					{#if aiSaved}<span class="text-[11px] text-mut">✓ gespeichert</span>{/if}
				</div>
			</div>
		</section>

		<!-- Instagram-Import -->
		<section>
			<b class="text-[13px]">Instagram-Import</b>
			<div class="card mt-1.5 flex items-center justify-between gap-3 p-3 text-[13px]">
				<p class="text-[11px] text-mut">
					Followings laden, an-/abwählen, auf vorhandene Personen zuordnen — Profilbild &amp; Instagram-Link werden befüllt.
				</p>
				<a href="/import/instagram" class="btn btn-sm flex-none">Öffnen</a>
			</div>
		</section>

		<!-- JSON-Import (Erzählung → JSON) -->
		<section>
			<b class="text-[13px]">JSON-Import</b>
			<div class="card mt-1.5 p-3 text-[13px]">
				<p class="text-[11px] text-mut">
					Personen, Verbindungen (mit Verlauf) und Ereignisse aus einer JSON-Struktur einpflegen. Mit „Vorschau" wird nichts
					geschrieben – nur geprüft und gezählt. Erst „Importieren" schreibt in die Datenbank. Das passende JSON kann aus einer
					Erzählung erzeugt werden (siehe <code>docs/import/</code>).
				</p>
				<form
					method="POST"
					action="?/importJson"
					use:enhance={() => {
						importing = true;
						return async ({ update }) => {
							await update({ reset: false });
							importing = false;
						};
					}}
					class="mt-2"
				>
					<textarea
						name="json"
						bind:value={importJsonText}
						rows="8"
						spellcheck="false"
						class="inp w-full font-mono text-[12px]"
						placeholder={'{\n  "persons": [ … ],\n  "connections": [ … ],\n  "events": [ … ]\n}'}
					></textarea>
					<input type="hidden" name="mode" value={importMode} />
					<div class="mt-2 flex flex-wrap items-center gap-2">
						<button class="btn btn-sm" disabled={importing} onclick={() => (importMode = 'preview')}>Vorschau</button>
						<button class="btn btn-sm btn-primary" disabled={importing} onclick={() => (importMode = 'apply')}>Importieren</button>
						{#if importing}<span class="text-[11px] text-mut">läuft …</span>{/if}
					</div>
				</form>

				{#if form?.import}
					{@const r = form.import as import('$lib/server/jsonImport').ImportResult}
					<div class="mt-3 rounded-md border border-line p-2.5 text-[12px]">
						{#if r.error}
							<p class="text-warn">⚠ {r.error}</p>
						{:else if r.report}
							<p class="font-semibold">
								{r.mode === 'apply' ? '✓ Importiert' : 'Vorschau'} — {r.mode === 'apply' ? 'in die Datenbank geschrieben' : 'nichts geschrieben'}
							</p>
							<div class="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
								{#each reportRows as row}
									<div class="flex justify-between gap-2">
										<span class="text-mut">{row.label}</span>
										<span class="tabular-nums">{r.report[row.key as keyof typeof r.report] ?? 0}</span>
									</div>
								{/each}
							</div>
							{#if r.mode === 'preview' && r.report.personsCreated + r.report.connectionsCreated + r.report.eventsCreated + r.report.periodsCreated > 0}
								<p class="mt-2 text-[11px] text-mut">Sieht gut aus? Dann auf „Importieren" klicken.</p>
							{/if}
						{/if}
						{#if r.warnings?.length}
							<ul class="mt-2 list-disc pl-4 text-[11px] text-warn">
								{#each r.warnings as w}<li>{w}</li>{/each}
							</ul>
						{/if}
					</div>
				{/if}
			</div>
		</section>
	</div>
</div>
