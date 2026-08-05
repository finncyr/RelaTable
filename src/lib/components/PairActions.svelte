<script lang="ts">
	import { enhance } from '$app/forms';
	import ImpreciseTimeInput from './ImpreciseTimeInput.svelte';

	interface Catalog {
		closeness: { id: number; name: string }[];
		context: { id: number; name: string }[];
		family: { id: number; name: string }[];
		romanceId: number | null;
		friendshipPlusId: number | null;
	}
	interface Props {
		catalog: Catalog;
		persons: { low: { id: number; name: string }; high: { id: number; name: string } };
		activePeriods: { id: number; typeName: string }[];
		hasRomance: boolean;
		form?: { error?: string } | null;
	}
	let { catalog, persons, activePeriods, hasRomance, form }: Props = $props();
	let familyPersonId = $state<number | null>(null);

	let open = $state(false);
	let action = $state('closeness');

	// Close the panel only after a successful submit; keep it open (with the error) on failure.
	const onSubmit = () => async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
		await update();
		if (result.type === 'success' || result.type === 'redirect') open = false;
	};

	const actions = $derived([
		{ k: 'closeness', label: 'Nähegrad setzen / ändern' },
		...(hasRomance ? [{ k: 'romance-end', label: 'Romantik beenden' }] : [{ k: 'romance-start', label: 'Romantik beginnen' }]),
		{ k: 'fplus', label: 'Freundschaft Plus beginnen' },
		...(catalog.context.length ? [{ k: 'context', label: 'Kontext-Typ hinzufügen' }] : []),
		...(catalog.family.length ? [{ k: 'family', label: 'Familienbeziehung hinzufügen' }] : []),
		...(activePeriods.length ? [{ k: 'end', label: 'Aktiven Typ beenden' }] : []),
		{ k: 'journal', label: 'Tagebucheintrag' }
	]);
</script>

<div class="mt-2">
	<button class="btn btn-primary btn-sm" onclick={() => (open = !open)} aria-expanded={open}>Aktion ▾</button>

	{#if open}
		<div class="mt-2 rounded-lg border border-line bg-bg/40 p-3">
			<label class="label" for="pair-action">Aktion</label>
			<select id="pair-action" class="inp mt-1" bind:value={action}>
				{#each actions as a}<option value={a.k}>{a.label}</option>{/each}
			</select>

			{#if form?.error}<p class="mt-2 rounded border border-warn bg-warn/10 px-2 py-1 text-[12px] text-warn">{form.error}</p>{/if}

			<div class="mt-3">
				{#if action === 'closeness'}
					<form method="POST" action="?/setType" use:enhance={onSubmit}>
						<label class="label" for="cl">Nähegrad</label>
						<select id="cl" name="typeId" class="inp mt-1">
							{#each catalog.closeness as t}<option value={t.id}>{t.name}</option>{/each}
						</select>
						<div class="mt-2"><ImpreciseTimeInput prefix="when" label="Gültig ab" /></div>
						<div class="mt-2 flex justify-end"><button class="btn btn-primary btn-sm">Speichern</button></div>
					</form>
				{:else if action === 'romance-start'}
					<form method="POST" action="?/setType" use:enhance={onSubmit}>
						<input type="hidden" name="typeId" value={catalog.romanceId} />
						<p class="text-[12px] text-mut">Beendet automatisch aktiven Nähegrad &amp; Freundschaft Plus.</p>
						<div class="mt-2"><ImpreciseTimeInput prefix="when" label="Beginn" /></div>
						<div class="mt-2 flex justify-end"><button class="btn btn-primary btn-sm">Bestätigen</button></div>
					</form>
				{:else if action === 'romance-end'}
					<form method="POST" action="?/endRomance" use:enhance={onSubmit}>
						<div><ImpreciseTimeInput prefix="when" label="Endzeitpunkt" /></div>
						<label class="label mt-2" for="follow">Folge-Nähegrad (Pflicht)</label>
						<select id="follow" name="followClosenessTypeId" class="inp mt-1">
							<option value="">kein Nähegrad</option>
							{#each catalog.closeness as t}<option value={t.id}>{t.name}</option>{/each}
						</select>
						<label class="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="activateEx" /> „Ex-Partner/in" aktivieren (parallel)</label>
						<div class="mt-2 flex justify-end"><button class="btn btn-primary btn-sm">Beenden</button></div>
					</form>
				{:else if action === 'fplus'}
					<form method="POST" action="?/setType" use:enhance={onSubmit}>
						<input type="hidden" name="typeId" value={catalog.friendshipPlusId} />
						<p class="text-[12px] text-mut">Läuft parallel zum Nähegrad; bei aktiver Romantik gesperrt.</p>
						<div class="mt-2"><ImpreciseTimeInput prefix="when" label="Beginn" /></div>
						<div class="mt-2 flex justify-end"><button class="btn btn-primary btn-sm">Starten</button></div>
					</form>
				{:else if action === 'context'}
					<form method="POST" action="?/setType" use:enhance={onSubmit}>
						<label class="label" for="ctx">Kontext-Typ</label>
						<select id="ctx" name="typeId" class="inp mt-1">
							{#each catalog.context as t}<option value={t.id}>{t.name}</option>{/each}
						</select>
						<div class="mt-2"><ImpreciseTimeInput prefix="when" label="Beginn" /></div>
						<div class="mt-2 flex justify-end"><button class="btn btn-primary btn-sm">Hinzufügen</button></div>
					</form>
				{:else if action === 'family'}
					<form method="POST" action="?/setFamily" use:enhance={onSubmit}>
						<p class="text-[12px] text-mut">Ersetzt einen aktiven Nähegrad. Die Gegenrolle der anderen Person (z. B. Onkel → Neffe/Nichte) wird automatisch aus deren Geschlecht abgeleitet.</p>
						<label class="label mt-2" for="fam-person">Person</label>
						<select id="fam-person" name="personId" class="inp mt-1" bind:value={familyPersonId}>
							<option value={persons.low.id}>{persons.low.name}</option>
							<option value={persons.high.id}>{persons.high.name}</option>
						</select>
						<label class="label mt-2" for="fam-role">Rolle</label>
						<select id="fam-role" name="typeId" class="inp mt-1">
							{#each catalog.family as t}<option value={t.id}>{t.name}</option>{/each}
						</select>
						<div class="mt-2"><ImpreciseTimeInput prefix="when" label="Beginn" /></div>
						<div class="mt-2 flex justify-end"><button class="btn btn-primary btn-sm">Hinzufügen</button></div>
					</form>
				{:else if action === 'end'}
					<form method="POST" action="?/endPeriod" use:enhance={onSubmit}>
						<label class="label" for="per">Aktiver Typ</label>
						<select id="per" name="periodId" class="inp mt-1">
							{#each activePeriods as p}<option value={p.id}>{p.typeName}</option>{/each}
						</select>
						<div class="mt-2"><ImpreciseTimeInput prefix="when" label="Endzeitpunkt" /></div>
						<div class="mt-2 flex justify-end"><button class="btn btn-primary btn-sm">Beenden</button></div>
					</form>
				{:else if action === 'journal'}
					<form method="POST" action="?/addJournal" use:enhance={onSubmit}>
						<label class="label" for="jt">Titel</label>
						<input id="jt" name="title" class="inp mt-1" required placeholder="z. B. Tiefes Gespräch" />
						<label class="label mt-2" for="jn">Notiz (optional)</label>
						<textarea id="jn" name="note" class="inp mt-1" rows="2"></textarea>
						<div class="mt-2"><ImpreciseTimeInput prefix="when" label="Wann" /></div>
						<div class="mt-2 flex justify-end"><button class="btn btn-primary btn-sm">Eintragen</button></div>
					</form>
				{/if}
			</div>
		</div>
	{/if}
</div>
