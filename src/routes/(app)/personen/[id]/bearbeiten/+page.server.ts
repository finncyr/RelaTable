import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { processPersonForm } from '$lib/server/personForm';
import { personImageSrc } from '$lib/util';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const id = Number(params.id);
	const person = await db.person.findFirst({
		where: { id, ownerId: locals.user!.id },
		include: { location: true, aliases: { orderBy: { alias: 'asc' } } }
	});
	if (!person) throw error(404, 'Person nicht gefunden');

	return {
		initial: {
			name: person.name,
			aliases: person.aliases.map((entry) => entry.alias).join('\n'),
			dateOfBirth: person.dateOfBirth ? person.dateOfBirth.toISOString().slice(0, 10) : '',
			gender: person.gender ?? '',
			orientation: person.orientation,
			city: person.location?.city ?? '',
			notes: person.notes ?? '',
			isCosplayer: person.isCosplayer,
			profileImageUrl: person.profileImageUrl ?? '',
			currentImage: personImageSrc(person) // resolved upload-or-URL src for the form preview
		},
		personId: person.id
	};
};

export const actions: Actions = {
	default: async ({ request, locals, params, url }) => {
		const id = Number(params.id);
		const existing = await db.person.findFirst({ where: { id, ownerId: locals.user!.id } });
		if (!existing) throw error(404, 'Person nicht gefunden');

		const result = await processPersonForm(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		const { aliases, profileImagePath, profileImageUrl, ...rest } = result.data!;
		const data: Record<string, unknown> = { ...rest };
		// Only overwrite the image when the user supplied a new one.
		if (result.imageProvided) {
			data.profileImagePath = profileImagePath;
			data.profileImageUrl = profileImageUrl;
		}
		await db.person.update({
			where: { id },
			data: {
				...data,
				aliases: {
					deleteMany: {},
					create: aliases.map((alias) => ({ alias }))
				}
			}
		});
		// Came from the graph context menu → jump back to the graph (focus is restored from localStorage).
		throw redirect(303, url.searchParams.get('return') === 'graph' ? '/graph' : `/personen/${id}`);
	}
};
