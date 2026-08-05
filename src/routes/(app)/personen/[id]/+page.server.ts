import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loadRelTypes, toPeriods } from '$lib/server/queries';
import { currentTypeName, colorForTypeName, closenessSortKey } from '$lib/domain/relationships';
import { formatImprecise } from '$lib/domain/time';
import type { Actions, PageServerLoad } from './$types';

// Trennt PersonInterest-Zeilen in "Vorlieben" vs. "Essen & Allergien" — keine eigene Tabelle nötig.
const FOOD_CATEGORIES = ['Allergie', 'Unverträglichkeit', 'Diät'];

async function getOwnedPerson(ownerId: number, id: number) {
	const person = await db.person.findFirst({ where: { id, ownerId } });
	if (!person) throw error(404, 'Person nicht gefunden');
	return person;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const ownerId = locals.user!.id;
	const id = Number(params.id);
	if (!Number.isInteger(id)) throw error(404, 'Person nicht gefunden');

	const person = await db.person.findFirst({
		where: { id, ownerId },
		include: {
			location: true,
			socialAccounts: true,
			aliases: { orderBy: { alias: 'asc' } },
			interests: { orderBy: [{ category: 'asc' }, { title: 'asc' }] },
			giftIdeas: { orderBy: { createdAt: 'desc' } },
			noteEntries: { orderBy: { createdAt: 'desc' } }
		}
	});
	if (!person) throw error(404, 'Person nicht gefunden');

	const [connections, types, participations] = await Promise.all([
		db.connection.findMany({
			where: { ownerId, OR: [{ personLowId: id }, { personHighId: id }] },
			include: {
				periods: { select: { relationshipTypeId: true, validFrom: true, validTo: true } },
				personLow: { select: { id: true, name: true, profileImagePath: true, profileImageUrl: true } },
				personHigh: { select: { id: true, name: true, profileImagePath: true, profileImageUrl: true } }
			}
		}),
		loadRelTypes(),
		db.eventParticipant.findMany({
			where: { personId: id },
			include: { event: { include: { eventType: true } } }
		})
	]);

	// Relationships sorted by closeness (engste zuerst, SCR-012).
	const relationships = connections
		.map((c) => {
			const other = c.personLowId === id ? c.personHigh : c.personLow;
			const periods = toPeriods(c.periods);
			const typeName = currentTypeName(periods, types);
			return {
				connectionId: c.id,
				other: {
					id: other.id,
					name: other.name,
					image: other.profileImagePath ? `/uploads/${other.profileImagePath}` : other.profileImageUrl
				},
				typeName,
				color: colorForTypeName(typeName, types),
				sortKey: closenessSortKey(periods, types)
			};
		})
		.sort((a, b) => a.sortKey - b.sortKey);

	// Events chronological; mark sensitive (hidden behind toggle, DEC-027).
	const events = participations
		.map((pp) => ({
			id: pp.event.id,
			name: pp.event.name,
			typeName: pp.event.eventType.name,
			sensitive: pp.event.eventType.sensitivity === 'sensitive',
			when: formatImprecise({ kind: pp.event.occurredAtKind as never, date: pp.event.occurredAt, text: pp.event.occurredAtText }),
			sortAt: pp.event.occurredAt ? pp.event.occurredAt.getTime() : 0
		}))
		.sort((a, b) => b.sortAt - a.sortAt);

	// Dependency counts for the delete dialog (AC-025).
	const journalCount = await db.connectionJournalEntry.count({
		where: { connection: { OR: [{ personLowId: id }, { personHighId: id }] } }
	});

	return {
		person: {
			id: person.id,
			name: person.name,
			aliases: person.aliases.map((entry) => entry.alias),
			gender: person.gender,
			orientation: person.orientation,
			city: person.location?.city ?? null,
			dateOfBirth: person.dateOfBirth ? person.dateOfBirth.toISOString() : null,
			image: person.profileImagePath ? `/uploads/${person.profileImagePath}` : person.profileImageUrl,
			notes: person.notes,
			isCosplayer: person.isCosplayer
		},
		socialAccounts: person.socialAccounts,
		interests: person.interests.filter((i) => !FOOD_CATEGORIES.includes(i.category)),
		foodNotes: person.interests.filter((i) => FOOD_CATEGORIES.includes(i.category)),
		giftIdeas: person.giftIdeas,
		personNotes: person.noteEntries,
		relationships,
		events,
		dependencies: {
			connections: connections.length,
			eventParticipations: participations.length,
			journal: journalCount
		}
	};
};

export const actions: Actions = {
	delete: async ({ locals, params }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		// FK cascades remove connections, participations and journal via the schema (C-MODEL-12).
		await db.person.delete({ where: { id } });
		throw redirect(303, '/personen');
	},

	addAccount: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const platform = String(data.get('platform') ?? '').trim();
		const handle = String(data.get('handle') ?? '').trim();
		const url = String(data.get('url') ?? '').trim();
		if (!platform || !handle) return fail(400, { accountError: 'Plattform und Handle erforderlich' });
		if (url && !/^https:\/\//i.test(url)) return fail(400, { accountError: 'URL muss HTTPS sein' });

		// Duplicate warning (AC-033): same platform + handle on this person.
		const dup = await db.socialAccount.findFirst({ where: { personId: id, platform, handle } });
		if (dup) return fail(400, { accountError: 'Dieser Account existiert bereits.' });

		await db.socialAccount.create({ data: { personId: id, platform, handle, url: url || null } });
		return { accountAdded: true };
	},

	deleteAccount: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const accountId = Number(data.get('accountId'));
		await db.socialAccount.deleteMany({ where: { id: accountId, personId: id } });
		return { accountDeleted: true };
	},

	addInterest: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const category = String(data.get('category') ?? '').trim();
		const title = String(data.get('title') ?? '').trim();
		const note = String(data.get('note') ?? '').trim();
		if (!category || !title) return fail(400, { interestError: 'Kategorie und Titel erforderlich' });
		await db.personInterest.create({ data: { personId: id, category, title, note: note || null } });
		return { interestAdded: true };
	},

	deleteInterest: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const interestId = Number(data.get('interestId'));
		await db.personInterest.deleteMany({ where: { id: interestId, personId: id } });
		return { interestDeleted: true };
	},

	addGiftIdea: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const title = String(data.get('title') ?? '').trim();
		const note = String(data.get('note') ?? '').trim();
		if (!title) return fail(400, { giftError: 'Titel erforderlich' });
		await db.personGiftIdea.create({ data: { personId: id, title, note: note || null } });
		return { giftAdded: true };
	},

	toggleGiftIdea: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const giftIdeaId = Number(data.get('giftIdeaId'));
		const gift = await db.personGiftIdea.findFirst({ where: { id: giftIdeaId, personId: id } });
		if (!gift) return fail(404, { giftError: 'Geschenkidee nicht gefunden' });
		await db.personGiftIdea.update({ where: { id: giftIdeaId }, data: { isFulfilled: !gift.isFulfilled } });
		return { giftToggled: true };
	},

	deleteGiftIdea: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const giftIdeaId = Number(data.get('giftIdeaId'));
		await db.personGiftIdea.deleteMany({ where: { id: giftIdeaId, personId: id } });
		return { giftDeleted: true };
	},

	addNote: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const text = String(data.get('text') ?? '').trim();
		const isChecklist = data.get('isChecklist') === 'on';
		if (!text) return fail(400, { noteError: 'Text erforderlich' });
		await db.personNote.create({ data: { personId: id, text, isChecklist } });
		return { noteAdded: true };
	},

	toggleNote: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const noteId = Number(data.get('noteId'));
		const note = await db.personNote.findFirst({ where: { id: noteId, personId: id } });
		if (!note) return fail(404, { noteError: 'Notiz nicht gefunden' });
		await db.personNote.update({ where: { id: noteId }, data: { isDone: !note.isDone } });
		return { noteToggled: true };
	},

	deleteNote: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const noteId = Number(data.get('noteId'));
		await db.personNote.deleteMany({ where: { id: noteId, personId: id } });
		return { noteDeleted: true };
	},

	deleteConnection: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const id = Number(params.id);
		await getOwnedPerson(ownerId, id);
		const data = await request.formData();
		const connectionId = Number(data.get('connectionId'));
		// FK cascades remove periods, journal and change-log entries via the schema.
		await db.connection.deleteMany({
			where: { id: connectionId, ownerId, OR: [{ personLowId: id }, { personHighId: id }] }
		});
		return { connectionDeleted: true };
	}
};
