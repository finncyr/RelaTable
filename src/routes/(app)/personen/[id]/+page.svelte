<script lang="ts">
	import { enhance } from '$app/forms';
	import Topbar from '$lib/components/Topbar.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { ageFromDob } from '$lib/domain/time';

	let { data, form } = $props();

	let confirmDelete = $state(false);
	let deleteAck = $state(false);
	let showSensitive = $state(false);
	let addingAccount = $state(false);
	let addingInterest = $state(false);
	let addingFood = $state(false);
	let addingGift = $state(false);
	let addingNote = $state(false);

	const INTEREST_CATEGORIES = ['Film', 'Buch', 'Serie', 'Sonstiges'];
	const FOOD_CATEGORIES = ['Allergie', 'Unverträglichkeit', 'Diät'];
	let interestCategory = $state(INTEREST_CATEGORIES[0]);
	let foodCategory = $state(FOOD_CATEGORIES[0]);

	// Zerlegt Text an http(s)-URLs, damit Notizen Links enthalten können, ohne die URL separat zu speichern.
	const URL_RE = /(https?:\/\/[^\s]+)/g;
	function linkify(text: string): { text: string; link: boolean }[] {
		const parts: { text: string; link: boolean }[] = [];
		let last = 0;
		for (const m of text.matchAll(URL_RE)) {
			const i = m.index ?? 0;
			if (i > last) parts.push({ text: text.slice(last, i), link: false });
			parts.push({ text: m[0], link: true });
			last = i + m[0].length;
		}
		if (last < text.length) parts.push({ text: text.slice(last), link: false });
		return parts;
	}

	const age = $derived(
		data.person.dateOfBirth ? ageFromDob(new Date(data.person.dateOfBirth)) : null
	);
	const subtitle = $derived(
		[age !== null ? `${age} Jahre` : null, data.person.city].filter(Boolean).join(' · ')
	);
	const visibleEvents = $derived(data.events.filter((e) => showSensitive || !e.sensitive));
	const hiddenSensitive = $derived(data.events.filter((e) => e.sensitive).length);
</script>

<svelte:head><title>{data.person.name} – RelaTable</title></svelte:head>

<Topbar title={data.person.name} back={{ href: '/personen', label: 'Personen' }}>
	<a class="btn btn-sm" href={`/personen/${data.person.id}/review`}>Review</a>
	<a class="btn btn-sm" href={`/personen/${data.person.id}/bearbeiten`}>Bearbeiten</a>
	<button class="btn btn-warn btn-sm" onclick={() => { confirmDelete = true; deleteAck = false; }}>Löschen</button>
</Topbar>

<div class="flex-1 overflow-auto p-3.5">
	<!-- Header -->
	<div class="mb-4 flex items-center gap-3">
		<Avatar person={{ name: data.person.name, profileImageUrl: data.person.image }} size={64} />
		<div>
			<b class="text-lg">{data.person.name}</b>
			<div class="text-xs text-mut">{subtitle || '—'}{data.person.gender ? ` · ${data.person.gender}` : ''}</div>
			{#if data.person.aliases.length}
				<div class="mt-1 flex flex-wrap gap-1">
					{#each data.person.aliases as alias}
						<span class="chip text-[11px]">Alias: {alias}</span>
					{/each}
				</div>
			{/if}
			<a class="btn btn-sm mt-1.5" href={`/graph?focus=${data.person.id}`}>Im Graph fokussieren</a>
		</div>
	</div>

	{#if data.person.notes}
		<p class="mb-4 whitespace-pre-wrap rounded-lg border border-line bg-card p-3 text-sm">{data.person.notes}</p>
	{/if}

	<div class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5">
		<!-- Persönliches: Interessen, Essen & Allergien, Geschenkideen -->
		<section>
			<b class="text-[13px]">Persönliches</b>
			<div class="mt-2 flex flex-col gap-4">
				<!-- Interessen (Filme/Bücher/Serien) -->
				<div>
					<div class="flex items-center gap-2">
						<span class="label">Interessen</span>
						<span class="flex-1"></span>
						<button class="text-mut hover:text-ink" title="Interesse hinzufügen" onclick={() => (addingInterest = !addingInterest)}>+</button>
					</div>
					<div class="mt-1.5 flex flex-wrap gap-1.5">
						{#each data.interests as i (i.id)}
							<span class="chip gap-1 text-[11px]">
								{i.category}: {i.title}
								{#if i.note}
									<span class="text-mut">—</span>
									{#each linkify(i.note) as part}
										{#if part.link}<a href={part.text} target="_blank" rel="noopener" class="underline hover:text-ink">{part.text}</a>{:else}{part.text}{/if}
									{/each}
								{/if}
								<form method="POST" action="?/deleteInterest" use:enhance>
									<input type="hidden" name="interestId" value={i.id} />
									<button class="text-mut hover:text-warn" title="Entfernen">✕</button>
								</form>
							</span>
						{:else}
							<p class="text-xs italic text-mut">Keine Interessen erfasst.</p>
						{/each}
					</div>
					{#if addingInterest}
						<form method="POST" action="?/addInterest" use:enhance={() => async ({ update }) => { await update(); addingInterest = false; interestCategory = INTEREST_CATEGORIES[0]; }} class="mt-1.5 rounded-lg border border-dashed border-line p-2">
							<input type="hidden" name="category" value={interestCategory} />
							<div class="flex flex-wrap gap-1">
								{#each INTEREST_CATEGORIES as c}
									<button type="button" class="chip hover:text-ink {interestCategory === c ? 'border-ink font-medium text-ink' : ''}" onclick={() => (interestCategory = c)}>{c}</button>
								{/each}
							</div>
							<div class="mt-1.5 flex gap-2">
								<input name="title" class="inp" placeholder="Titel" required />
							</div>
							<input name="note" class="inp mt-1.5" placeholder="Notiz, auch mit Link (optional)" />
							<div class="mt-1.5 flex justify-end">
								<button class="btn btn-primary btn-sm">Hinzufügen</button>
							</div>
							{#if form?.interestError}<p class="mt-1 text-[11px] text-warn">{form.interestError}</p>{/if}
						</form>
					{/if}
				</div>

				<!-- Essen & Allergien -->
				<div>
					<div class="flex items-center gap-2">
						<span class="label">Essen &amp; Allergien</span>
						<span class="flex-1"></span>
						<button class="text-mut hover:text-ink" title="Allergie/Diät hinzufügen" onclick={() => (addingFood = !addingFood)}>+</button>
					</div>
					<div class="mt-1.5 flex flex-wrap gap-1.5">
						{#each data.foodNotes as i (i.id)}
							<span class="chip gap-1 text-[11px] {i.category === 'Diät' ? '' : 'border-warn text-warn'}">
								{i.category}: {i.title}
								{#if i.note}
									<span>—</span>
									{#each linkify(i.note) as part}
										{#if part.link}<a href={part.text} target="_blank" rel="noopener" class="underline">{part.text}</a>{:else}{part.text}{/if}
									{/each}
								{/if}
								<form method="POST" action="?/deleteInterest" use:enhance>
									<input type="hidden" name="interestId" value={i.id} />
									<button class="text-mut hover:text-warn" title="Entfernen">✕</button>
								</form>
							</span>
						{:else}
							<p class="text-xs italic text-mut">Keine Allergien/Unverträglichkeiten erfasst.</p>
						{/each}
					</div>
					{#if addingFood}
						<form method="POST" action="?/addInterest" use:enhance={() => async ({ update }) => { await update(); addingFood = false; foodCategory = FOOD_CATEGORIES[0]; }} class="mt-1.5 rounded-lg border border-dashed border-line p-2">
							<input type="hidden" name="category" value={foodCategory} />
							<div class="flex flex-wrap gap-1">
								{#each FOOD_CATEGORIES as c}
									<button type="button" class="chip hover:text-ink {foodCategory === c ? 'border-ink font-medium text-ink' : ''}" onclick={() => (foodCategory = c)}>{c}</button>
								{/each}
							</div>
							<div class="mt-1.5 flex gap-2">
								<input name="title" class="inp" placeholder="z.B. Laktoseintoleranz" required />
								<input name="note" class="inp" placeholder="Notiz, auch mit Link (optional)" />
							</div>
							<div class="mt-1.5 flex justify-end">
								<button class="btn btn-primary btn-sm">Hinzufügen</button>
							</div>
							{#if form?.interestError}<p class="mt-1 text-[11px] text-warn">{form.interestError}</p>{/if}
						</form>
					{/if}
				</div>

				<!-- Geschenkideen -->
				<div>
					<div class="flex items-center gap-2">
						<span class="label">Geschenkideen</span>
						<span class="flex-1"></span>
						<button class="text-mut hover:text-ink" title="Geschenkidee hinzufügen" onclick={() => (addingGift = !addingGift)}>+</button>
					</div>
					<div class="mt-1.5 flex flex-col gap-1.5">
						{#each data.giftIdeas as g (g.id)}
							<div class="flex items-center gap-2.5 rounded-lg border border-line bg-card p-2">
								<form method="POST" action="?/toggleGiftIdea" use:enhance>
									<input type="hidden" name="giftIdeaId" value={g.id} />
									<button type="submit" class="text-mut" title={g.isFulfilled ? 'Als offen markieren' : 'Als erledigt markieren'}>
										{g.isFulfilled ? '☑' : '☐'}
									</button>
								</form>
								<span class="min-w-0 flex-1">
									<b class="block truncate text-[13px] {g.isFulfilled ? 'text-mut line-through' : ''}">{g.title}</b>
									{#if g.note}
										<span class="block truncate text-[11px] text-mut">
											{#each linkify(g.note) as part}
												{#if part.link}<a href={part.text} target="_blank" rel="noopener" class="underline hover:text-ink">{part.text}</a>{:else}{part.text}{/if}
											{/each}
										</span>
									{/if}
								</span>
								<form method="POST" action="?/deleteGiftIdea" use:enhance>
									<input type="hidden" name="giftIdeaId" value={g.id} />
									<button class="text-mut hover:text-warn" title="Entfernen">✕</button>
								</form>
							</div>
						{:else}
							<p class="text-xs italic text-mut">Keine Geschenkideen erfasst.</p>
						{/each}
					</div>
					{#if addingGift}
						<form method="POST" action="?/addGiftIdea" use:enhance={() => async ({ update }) => { await update(); addingGift = false; }} class="mt-1.5 rounded-lg border border-dashed border-line p-2">
							<div class="flex gap-2">
								<input name="title" class="inp" placeholder="Geschenkidee" required />
								<input name="note" class="inp" placeholder="Notiz, auch mit Link (optional)" />
							</div>
							<div class="mt-1.5 flex justify-end">
								<button class="btn btn-primary btn-sm">Hinzufügen</button>
							</div>
							{#if form?.giftError}<p class="mt-1 text-[11px] text-warn">{form.giftError}</p>{/if}
						</form>
					{/if}
				</div>

				<!-- Notizen (optional abhakbar) -->
				<div>
					<div class="flex items-center gap-2">
						<span class="label">Notizen</span>
						<span class="flex-1"></span>
						<button class="text-mut hover:text-ink" title="Notiz hinzufügen" onclick={() => (addingNote = !addingNote)}>+</button>
					</div>
					<div class="mt-1.5 flex flex-col gap-1.5">
						{#each data.personNotes as n (n.id)}
							<div class="flex items-center gap-2.5 rounded-lg border border-line bg-card p-2">
								{#if n.isChecklist}
									<form method="POST" action="?/toggleNote" use:enhance>
										<input type="hidden" name="noteId" value={n.id} />
										<button type="submit" class="text-mut" title={n.isDone ? 'Als offen markieren' : 'Als erledigt markieren'}>
											{n.isDone ? '☑' : '☐'}
										</button>
									</form>
								{/if}
								<span class="min-w-0 flex-1 truncate text-[13px] {n.isDone ? 'text-mut line-through' : ''}">
									{#each linkify(n.text) as part}
										{#if part.link}<a href={part.text} target="_blank" rel="noopener" class="underline hover:text-ink">{part.text}</a>{:else}{part.text}{/if}
									{/each}
								</span>
								<form method="POST" action="?/deleteNote" use:enhance>
									<input type="hidden" name="noteId" value={n.id} />
									<button class="text-mut hover:text-warn" title="Entfernen">✕</button>
								</form>
							</div>
						{:else}
							<p class="text-xs italic text-mut">Keine Notizen erfasst.</p>
						{/each}
					</div>
					{#if addingNote}
						<form method="POST" action="?/addNote" use:enhance={() => async ({ update }) => { await update(); addingNote = false; }} class="mt-1.5 rounded-lg border border-dashed border-line p-2">
							<input name="text" class="inp" placeholder="Notiz, auch mit Link" required />
							<label class="mt-1.5 flex items-center gap-1.5 text-xs text-mut">
								<input type="checkbox" name="isChecklist" /> Als abhakbare Checkliste
							</label>
							<div class="mt-1.5 flex justify-end">
								<button class="btn btn-primary btn-sm">Hinzufügen</button>
							</div>
							{#if form?.noteError}<p class="mt-1 text-[11px] text-warn">{form.noteError}</p>{/if}
						</form>
					{/if}
				</div>
			</div>
		</section>

		<!-- Social accounts -->
		<section>
			<div class="flex items-center gap-2">
				<b class="text-[13px]">Social Accounts</b>
				<span class="flex-1"></span>
				<button class="text-mut hover:text-ink" title="Account hinzufügen" onclick={() => (addingAccount = !addingAccount)}>+</button>
			</div>
			<div class="mt-2 flex flex-col gap-2">
				{#each data.socialAccounts as acc (acc.id)}
					<div class="flex items-center gap-2.5 rounded-lg border border-line bg-card p-2">
						<span class="avatar h-7 w-7 text-[11px]">{acc.platform.slice(0, 2).toUpperCase()}</span>
						<span class="min-w-0 flex-1">
							<b class="block truncate text-[13px]">{acc.handle}</b>
							<span class="block truncate text-[11px] text-mut">{acc.platform}</span>
						</span>
						{#if acc.url}<a href={acc.url} target="_blank" rel="noopener" class="text-mut" title="Öffnen">↗</a>{/if}
						<form method="POST" action="?/deleteAccount" use:enhance>
							<input type="hidden" name="accountId" value={acc.id} />
							<button class="text-mut hover:text-warn" title="Entfernen">✕</button>
						</form>
					</div>
				{:else}
					<p class="text-xs italic text-mut">Keine Accounts.</p>
				{/each}

				{#if addingAccount}
					<form method="POST" action="?/addAccount" use:enhance={() => async ({ update }) => { await update(); addingAccount = false; }} class="rounded-lg border border-dashed border-line p-2">
						<div class="flex gap-2">
							<input name="platform" class="inp" placeholder="Plattform" required />
							<input name="handle" class="inp" placeholder="@handle" required />
						</div>
						<input name="url" class="inp mt-2" placeholder="https://… (optional)" />
						{#if form?.accountError}<p class="mt-1 text-[11px] text-warn">{form.accountError}</p>{/if}
						<div class="mt-2 flex justify-end gap-2">
							<button type="button" class="btn btn-sm" onclick={() => (addingAccount = false)}>Abbrechen</button>
							<button class="btn btn-primary btn-sm">Hinzufügen</button>
						</div>
					</form>
				{/if}
			</div>
		</section>

		<!-- Relationships (engste zuerst) -->
		<section>
			<div class="flex items-center gap-2">
				<b class="text-[13px]">Beziehungen</b> <span class="text-[11px] text-mut">(engste zuerst)</span>
				<span class="flex-1"></span>
				<a class="btn btn-sm" href={`/verbindung/neu?from=${data.person.id}`}>+ Verbindung</a>
			</div>
			<div class="mt-2 flex flex-col gap-2">
				{#each data.relationships as r (r.connectionId)}
					<a href={`/pair/${data.person.id}-${r.other.id}`} class="flex items-center gap-2.5 rounded-lg border border-line bg-card p-2 hover:bg-bg">
						<Avatar person={{ name: r.other.name, profileImageUrl: r.other.image }} size={26} />
						<span class="min-w-0 flex-1">
							<b class="block truncate text-[13px]">{r.other.name}</b>
							<span class="flex items-center gap-1.5 text-[11px] text-mut">
								<span class="inline-block h-2 w-2 rounded-full" style="background:{r.color}"></span>
								{r.typeName ?? 'Verbindung'}
							</span>
						</span>
						<span class="text-mut">›</span>
					</a>
				{:else}
					<p class="text-xs italic text-mut">Keine Beziehungen.</p>
				{/each}
			</div>
		</section>
	</div>

	<!-- Events chronological -->
	<section class="mt-4">
		<div class="flex items-center gap-2">
			<b class="text-[13px]">Ereignisse (chronologisch)</b>
			{#if hiddenSensitive > 0}
				<button class="chip" onclick={() => (showSensitive = !showSensitive)}>
					{showSensitive ? 'Sensible verbergen' : `Sensible anzeigen (${hiddenSensitive})`}
				</button>
			{/if}
			<span class="flex-1"></span>
			<a class="btn btn-sm" href={`/ereignisse/neu?with=${data.person.id}`}>+ Event</a>
		</div>
		<div class="mt-1.5 flex flex-col gap-1.5">
			{#each visibleEvents as e (e.id)}
				<div class="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm">
					{#if e.sensitive}<span title="sensibel">🔒</span>{/if}
					<b>{e.name}</b>
					<span class="text-xs text-mut">· {e.typeName} · {e.when}</span>
				</div>
			{:else}
				<p class="text-xs text-mut">Keine Ereignisse.</p>
			{/each}
			{#if hiddenSensitive > 0 && !showSensitive}
				<p class="text-xs text-mut">🔒 {hiddenSensitive} sensibles Ereignis verborgen</p>
			{/if}
		</div>
	</section>
</div>

<!-- Delete dialog (SCR-013) -->
{#if confirmDelete}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
		<div class="card w-full max-w-md">
			<div class="border-b border-line p-3.5 font-semibold">Person löschen: „{data.person.name}"?</div>
			<div class="p-3.5">
				<div class="rounded-md border border-warn bg-warn/10 p-2.5 text-[13px] text-warn">
					Betroffen: <b>{data.dependencies.connections} Beziehungen</b>,
					<b>{data.dependencies.eventParticipations} Ereignis-Teilnahmen</b>,
					<b>{data.dependencies.journal} Tagebuch-Einträge</b>.
				</div>
				<p class="mt-2.5 text-xs text-mut">
					Beziehungen, an denen nur {data.person.name} beteiligt ist, werden entfernt. Ereignisse bleiben, verlieren aber {data.person.name} als Teilnehmer.
				</p>
				<label class="mt-2.5 flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={deleteAck} /> Ich verstehe die Auswirkungen.
				</label>
			</div>
			<div class="flex justify-end gap-2 border-t border-line p-3.5">
				<button class="btn" onclick={() => (confirmDelete = false)}>Abbrechen</button>
				<form method="POST" action="?/delete" use:enhance>
					<button class="btn btn-warn" disabled={!deleteAck}>Endgültig löschen</button>
				</form>
			</div>
		</div>
	</div>
{/if}
