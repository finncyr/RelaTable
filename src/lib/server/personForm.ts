import { z } from 'zod';
import { findOrCreateLocation } from './geo';
import { saveProfileImage } from './uploads';

const GENDERS = ['Männlich', 'Weiblich', 'divers'] as const;
const ORIENTATIONS = ['Straight', 'Bi/Pan', 'Gay', 'unbekannt'] as const;

const schema = z.object({
	name: z.string().trim().min(1, 'Name ist Pflicht'),
	aliases: z.string().trim().optional(),
	dateOfBirth: z.string().trim().optional(),
	gender: z.enum(GENDERS).optional().or(z.literal('')),
	orientation: z.enum(ORIENTATIONS).optional().or(z.literal('')),
	city: z.string().trim().optional(),
	notes: z.string().trim().optional(),
	imageMode: z.enum(['upload', 'url']).optional(),
	profileImageUrl: z.string().trim().optional()
});

export interface PersonFormResult {
	ok: boolean;
	errors?: Record<string, string[]>;
	values?: Record<string, string>;
	/** Whether the user supplied a new image (upload or URL) in this submission. */
	imageProvided?: boolean;
	data?: {
		name: string;
		aliases: string[];
		dateOfBirth: Date | null;
		gender: string | null;
		orientation: string;
		locationId: number | null;
		notes: string | null;
		profileImagePath: string | null;
		profileImageUrl: string | null;
	};
}

/** Parse + validate a person create/edit form, persisting any uploaded image + location. */
export async function processPersonForm(formData: FormData): Promise<PersonFormResult> {
	const raw = {
		name: String(formData.get('name') ?? ''),
		aliases: String(formData.get('aliases') ?? ''),
		dateOfBirth: String(formData.get('dateOfBirth') ?? ''),
		gender: String(formData.get('gender') ?? ''),
		orientation: String(formData.get('orientation') ?? ''),
		city: String(formData.get('city') ?? ''),
		notes: String(formData.get('notes') ?? ''),
		imageMode: String(formData.get('imageMode') ?? 'upload'),
		profileImageUrl: String(formData.get('profileImageUrl') ?? '')
	};
	const values = { ...raw };

	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		return { ok: false, errors: parsed.error.flatten().fieldErrors, values };
	}
	const v = parsed.data;
	const aliases = [...new Set(
		(v.aliases ?? '')
			.split(/\r?\n|,/)
			.map((alias) => alias.trim())
			.filter(Boolean)
			.filter((alias) => alias.toLowerCase() !== v.name.toLowerCase())
	)];

	// Date of birth (input type=date → yyyy-mm-dd) (AC-027/028: age computed, not stored).
	let dob: Date | null = null;
	if (v.dateOfBirth) {
		const d = new Date(v.dateOfBirth + 'T00:00:00Z');
		if (isNaN(d.getTime())) return { ok: false, errors: { dateOfBirth: ['Ungültiges Datum'] }, values };
		dob = d;
	}

	const locationId = v.city ? await findOrCreateLocation(v.city) : null;

	// Image: upload OR https URL (AC-029..031). URL must be HTTPS; load failures degrade to placeholder.
	let profileImagePath: string | null = null;
	let profileImageUrl: string | null = null;
	let imageProvided = false;
	if (v.imageMode === 'url') {
		const url = v.profileImageUrl ?? '';
		if (url) {
			if (!/^https:\/\//i.test(url)) {
				return { ok: false, errors: { profileImageUrl: ['Nur HTTPS-URLs erlaubt'] }, values };
			}
			profileImageUrl = url;
			imageProvided = true;
		}
	} else {
		const file = formData.get('imageFile');
		if (file instanceof File && file.size > 0) {
			const res = await saveProfileImage(file);
			if (!res.ok) return { ok: false, errors: { imageFile: [res.error ?? 'Upload fehlgeschlagen'] }, values };
			profileImagePath = res.fileName ?? null;
			imageProvided = true;
		}
	}

	return {
		ok: true,
		values,
		imageProvided,
		data: {
			name: v.name,
			aliases,
			dateOfBirth: dob,
			gender: v.gender || null,
			orientation: v.orientation || 'unbekannt',
			locationId,
			notes: v.notes || null,
			profileImagePath,
			profileImageUrl
		}
	};
}
