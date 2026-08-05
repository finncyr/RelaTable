<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import ImageCropper from './ImageCropper.svelte';

	interface InitialValues {
		name?: string;
		aliases?: string;
		dateOfBirth?: string; // yyyy-mm-dd
		gender?: string;
		orientation?: string;
		city?: string;
		notes?: string;
		isCosplayer?: boolean;
		profileImageUrl?: string;
		currentImage?: string | null; // resolved src of the already-saved image, if any
	}
	interface Props {
		initial?: InitialValues;
		errors?: Record<string, string[]> | undefined;
		submitLabel?: string;
		cancelHref: string;
	}
	let { initial = {}, errors, submitLabel = 'Speichern', cancelHref }: Props = $props();

	// Local bound state so reactive re-renders never reset typed values.
	let name = $state(initial.name ?? '');
	let aliases = $state(initial.aliases ?? '');
	let dateOfBirth = $state(initial.dateOfBirth ?? '');
	let gender = $state(initial.gender ?? '');
	let orientation = $state(initial.orientation ?? 'unbekannt');
	let city = $state(initial.city ?? '');
	let notes = $state(initial.notes ?? '');
	let isCosplayer = $state(initial.isCosplayer ?? false);
	let imageMode = $state<'upload' | 'url'>(initial.profileImageUrl ? 'url' : 'upload');
	let urlValue = $state(initial.profileImageUrl ?? '');
	let dirty = $state(false);

	function err(field: string): string | null {
		return errors?.[field]?.[0] ?? null;
	}

	// Image upload: pick → crop (circle, zoom) → write cropped PNG back into the file input.
	let fileInput: HTMLInputElement;
	let cropSrc = $state<string | null>(null);
	let previewUrl = $state<string | null>(null);

	function onPick(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (f) cropSrc = URL.createObjectURL(f);
	}
	function onCropped(blob: Blob) {
		const file = new File([blob], 'avatar.png', { type: 'image/png' });
		const dt = new DataTransfer();
		dt.items.add(file);
		fileInput.files = dt.files; // submit the cropped image, not the original
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = URL.createObjectURL(blob);
		if (cropSrc) URL.revokeObjectURL(cropSrc);
		cropSrc = null;
		dirty = true;
	}
	function onCropCancel() {
		if (cropSrc) URL.revokeObjectURL(cropSrc);
		cropSrc = null;
		fileInput.value = '';
	}

	onMount(() => {
		// Deep-link from the graph "Bild ändern" menu → open the file picker immediately.
		if ($page.url.searchParams.get('pick') === '1') {
			imageMode = 'upload';
			queueMicrotask(() => fileInput?.click());
		}
	});
</script>

<form
	method="POST"
	enctype="multipart/form-data"
	use:enhance
	oninput={() => (dirty = true)}
	class="flex flex-col gap-4"
>
	<input type="hidden" name="imageMode" value={imageMode} />

	<div class="flex flex-wrap gap-4">
		<div class="min-w-[320px] flex-1 rounded-lg border border-dashed border-line bg-bg/40 p-3.5">
			<label class="label" for="name">Name *</label>
			<input id="name" name="name" class="inp mb-1 mt-1" bind:value={name} required placeholder="Pflichtfeld" />
			{#if err('name')}<p class="mb-2 text-[11px] text-warn">{err('name')}</p>{/if}

			<div class="mt-2.5">
				<label class="label" for="aliases">Alias-Namen</label>
				<textarea
					id="aliases"
					name="aliases"
					class="inp mt-1"
					rows="2"
					bind:value={aliases}
					placeholder="Ein Alias pro Zeile oder komma-getrennt"
				></textarea>
				<p class="mt-1 text-[11px] text-mut">Hilft der KI und Suche bei Spitznamen wie Conny oder Consti.</p>
			</div>

			<div class="flex gap-2.5">
				<div class="flex-1">
					<label class="label" for="dateOfBirth">Geburtsdatum (optional)</label>
					<input id="dateOfBirth" name="dateOfBirth" type="date" class="inp mt-1" bind:value={dateOfBirth} />
					{#if err('dateOfBirth')}<p class="text-[11px] text-warn">{err('dateOfBirth')}</p>{/if}
				</div>
				<div class="flex-1">
					<label class="label" for="gender">Geschlecht</label>
					<select id="gender" name="gender" class="inp mt-1" bind:value={gender}>
						<option value="">—</option>
						<option value="Männlich">Männlich</option>
						<option value="Weiblich">Weiblich</option>
						<option value="divers">divers</option>
					</select>
				</div>
			</div>

			<div class="mt-2.5">
				<label class="label" for="orientation">LGBTQ+-Status</label>
				<select id="orientation" name="orientation" class="inp mt-1" bind:value={orientation}>
					<option value="unbekannt">unbekannt</option>
					<option value="Straight">Straight</option>
					<option value="Bi/Pan">Bi/Pan</option>
					<option value="Gay">Gay</option>
				</select>
			</div>

			<div class="mt-2.5">
				<label class="label" for="city">Ort (Stadt/Region genügt)</label>
				<input id="city" name="city" class="inp mt-1" bind:value={city} placeholder="z. B. Berlin" />
			</div>

			<div class="mt-2.5">
				<label class="label" for="notes">Notizen</label>
				<textarea id="notes" name="notes" class="inp mt-1" rows="2" bind:value={notes}></textarea>
			</div>

			<label class="mt-2.5 flex items-center gap-2 text-sm">
				<input type="checkbox" name="isCosplayer" bind:checked={isCosplayer} value="true" />
				Cosplayer
			</label>
		</div>

		<div class="w-[300px]">
			<span class="label">Profilbild</span>
			<div class="mt-1 rounded-lg border border-dashed border-line bg-bg/40 p-3">
				<div class="mb-2 flex gap-1.5">
					<button type="button" class="chip {imageMode === 'upload' ? 'bg-line/60' : ''}" onclick={() => (imageMode = 'upload')}>Upload</button>
					<button type="button" class="chip {imageMode === 'url' ? 'bg-line/60' : ''}" onclick={() => (imageMode = 'url')}>Externe URL</button>
				</div>

				{#if imageMode === 'upload'}
					<input bind:this={fileInput} onchange={onPick} name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"
						class="inp cursor-pointer p-1.5 text-sm text-mut file:mr-2.5 file:cursor-pointer file:rounded-md file:border file:border-accent file:bg-card file:px-3 file:py-1 file:text-[13px] file:text-ink hover:file:bg-bg" />
					{#if previewUrl ?? initial.currentImage}
						<img src={previewUrl ?? initial.currentImage} alt="Vorschau" class="mt-2 h-24 w-24 rounded-full border border-line object-cover" />
					{/if}
					{#if err('imageFile')}<p class="mt-1 text-[11px] text-warn">{err('imageFile')}</p>{/if}
					<p class="mt-1.5 text-[11px] text-mut">Ausschnitt wählbar · max. 5 MB.</p>
				{:else}
					<input name="profileImageUrl" class="inp" placeholder="https://…" bind:value={urlValue} />
					{#if err('profileImageUrl')}<p class="mt-1 text-[11px] text-warn">{err('profileImageUrl')}</p>{/if}
					{#if urlValue && /^https:\/\//i.test(urlValue)}
						<img src={urlValue} alt="Vorschau" class="mt-2 h-24 w-full rounded object-cover" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
					{/if}
					<p class="mt-1.5 text-[11px] text-mut">HTTPS-Feld + Live-Vorschau; nicht ladbar → Platzhalter, Speichern bleibt möglich.</p>
				{/if}
			</div>
		</div>
	</div>

	<div class="flex justify-end gap-2">
		<a class="btn" href={cancelHref} onclick={(e) => { if (dirty && !confirm('Änderungen verwerfen?')) e.preventDefault(); }}>Abbrechen</a>
		<button class="btn btn-primary">{submitLabel}</button>
	</div>
</form>

{#if cropSrc}
	<ImageCropper src={cropSrc} onConfirm={onCropped} onCancel={onCropCancel} />
{/if}
