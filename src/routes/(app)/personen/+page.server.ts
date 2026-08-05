import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loadRelTypes, toPeriods } from '$lib/server/queries';
import { currentTypeName } from '$lib/domain/relationships';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const ownerId = locals.user!.id;
	const q = url.searchParams.get('q')?.trim() ?? '';
	const ort = (url.searchParams.get('ort') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
	const typ = (url.searchParams.get('typ') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
	const sort = url.searchParams.get('sort') === 'desc' ? 'desc' : 'asc';

	const [persons, connections, types] = await Promise.all([
		db.person.findMany({
			where: {
				ownerId,
				...(q
					? {
							OR: [{ name: { contains: q } }, { aliases: { some: { alias: { contains: q } } } }]
					  }
					: {}),
				...(ort.length ? { location: { is: { city: { in: ort } } } } : {})
			},
			include: { location: true, aliases: { orderBy: { alias: 'asc' } } },
			orderBy: { name: sort }
		}),
		db.connection.findMany({
			where: { ownerId },
			include: { periods: { select: { relationshipTypeId: true, validFrom: true, validTo: true } } }
		}),
		loadRelTypes()
	]);

	// Per-person degree + set of current type names across their connections.
	const degree = new Map<number, number>();
	const typeNames = new Map<number, Set<string>>();
	for (const c of connections) {
		degree.set(c.personLowId, (degree.get(c.personLowId) ?? 0) + 1);
		degree.set(c.personHighId, (degree.get(c.personHighId) ?? 0) + 1);
		const cur = currentTypeName(toPeriods(c.periods), types);
		if (cur) {
			for (const pid of [c.personLowId, c.personHighId]) {
				if (!typeNames.has(pid)) typeNames.set(pid, new Set());
				typeNames.get(pid)!.add(cur);
			}
		}
	}

	let items = persons.map((p) => ({
		id: p.id,
		name: p.name,
		aliases: p.aliases.map((entry) => entry.alias),
		city: p.location?.city ?? null,
		image: p.profileImagePath ? `/uploads/${p.profileImagePath}` : p.profileImageUrl,
		degree: degree.get(p.id) ?? 0
	}));

	if (typ.length) {
		const keep = new Set(
			persons.filter((p) => typ.some((t) => typeNames.get(p.id)?.has(t))).map((p) => p.id)
		);
		items = items.filter((i) => keep.has(i.id));
	}

	// Distinct cities + active type names for filter UI.
	const cities = [...new Set(persons.map((p) => p.location?.city).filter((c): c is string => !!c))].sort();
	const typeOptions = types.map((t) => t.name);

	const total = await db.person.count({ where: { ownerId } });

	return { items, q, ort, typ, sort, cities, typeOptions, total };
};

export const actions: Actions = {
	// Mehrere Personen in einem Schritt löschen (Mehrfachauswahl auf der Übersicht).
	// FK-Cascades entfernen Verbindungen, Ereignis-Teilnahmen, Aliase etc. via Schema
	// (siehe C-MODEL-12 / einzelne delete-Action auf der Personen-Detailseite).
	bulkDelete: async ({ locals, request }) => {
		const ownerId = locals.user!.id;
		const data = await request.formData();
		const ids = data
			.getAll('ids')
			.map((v) => Number(v))
			.filter((n) => Number.isInteger(n));
		if (!ids.length) return fail(400, { bulkError: 'Keine Personen ausgewählt.' });

		const owned = await db.person.findMany({ where: { id: { in: ids }, ownerId }, select: { id: true } });
		const ownedIds = owned.map((p) => p.id);
		if (!ownedIds.length) return fail(400, { bulkError: 'Auswahl ungültig oder nicht mehr vorhanden.' });

		await db.person.deleteMany({ where: { id: { in: ownedIds }, ownerId } });
		return { bulkDeleted: ownedIds.length };
	}
};
