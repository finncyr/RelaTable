import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loadRelTypes, toPeriods } from '$lib/server/queries';
import { canonicalPair, currentTypeName, colorForTypeName } from '$lib/domain/relationships';
import { formatImprecise, sortableInstant, type TimeKind } from '$lib/domain/time';
import { parseImprecise } from '$lib/server/impreciseTime';
import { startType, startFamilyType, endRomance, endPeriod, addJournal, getOrCreateConnection, deleteConnection, clearHistory } from '$lib/server/relationshipService';
import type { Actions, PageServerLoad } from './$types';

function parsePair(param: string): [number, number] | null {
	const m = param.match(/^(\d+)-(\d+)$/);
	if (!m) return null;
	return [Number(m[1]), Number(m[2])];
}

async function resolveConnectionId(ownerId: number, param: string): Promise<number | null> {
	const pair = parsePair(param);
	if (!pair) return null;
	const conn = await getOrCreateConnection(ownerId, pair[0], pair[1]);
	return conn.ok ? conn.connectionId! : null;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const ownerId = locals.user!.id;
	const pair = parsePair(params.pair);
	if (!pair) throw error(404, 'Ungültiges Paar');
	let low: number, high: number;
	try {
		({ low, high } = canonicalPair(pair[0], pair[1]));
	} catch {
		throw error(404, 'Ungültiges Paar');
	}

	const [personLow, personHigh] = await Promise.all([
		db.person.findFirst({ where: { id: low, ownerId } }),
		db.person.findFirst({ where: { id: high, ownerId } })
	]);
	if (!personLow || !personHigh) throw error(404, 'Person nicht gefunden');

	const connection = await db.connection.findUnique({
		where: { ownerId_personLowId_personHighId: { ownerId, personLowId: low, personHighId: high } },
		include: { periods: { include: { relationshipType: true } }, journal: true }
	});

	const types = await loadRelTypes();

	// Catalog for the action menu.
	const closenessTypes = types.filter((t) => t.isClosenessLevel).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
	const contextTypes = types.filter((t) => t.categoryName === 'Kontext');
	const familyTypes = types.filter((t) => t.categoryName === 'Familie');
	const catalog = {
		closeness: closenessTypes.map((t) => ({ id: t.id, name: t.name })),
		context: contextTypes.map((t) => ({ id: t.id, name: t.name })),
		family: familyTypes.map((t) => ({ id: t.id, name: t.name })),
		romanceId: types.find((t) => t.name === 'Romantik')?.id ?? null,
		friendshipPlusId: types.find((t) => t.name === 'Freundschaft Plus')?.id ?? null
	};

	const mapImg = (p: typeof personLow) =>
		p.profileImagePath ? `/uploads/${p.profileImagePath}` : p.profileImageUrl;

	const persons = {
		low: { id: personLow.id, name: personLow.name, image: mapImg(personLow) },
		high: { id: personHigh.id, name: personHigh.name, image: mapImg(personHigh) }
	};

	const pairParam = `${pair[0]}-${pair[1]}`;

	if (!connection) {
		return { persons, pairParam, catalog, exists: false, current: null, color: '#bbb', history: [], journal: [], events: [], activePeriods: [], hasRomance: false };
	}

	// Active periods (for "end this type" actions).
	const activePeriods = connection.periods
		.filter((p) => p.validTo === null)
		.map((p) => ({ id: p.id, typeName: p.relationshipType.name }));
	const hasRomance = activePeriods.some((p) => p.typeName === 'Romantik');

	// Current dominant type + color.
	const current = currentTypeName(toPeriods(connection.periods), types);
	const color = colorForTypeName(current, types);

	// History: periods chronological (newest first), with imprecise times rendered.
	const nameForPerson = (id: number | null) =>
		id === personLow.id ? personLow.name : id === personHigh.id ? personHigh.name : null;
	const history = connection.periods
		.map((p) => ({
			type: p.relationshipType.name,
			who: nameForPerson(p.personId),
			active: p.validTo === null,
			from: formatImprecise({ kind: p.validFromKind as TimeKind, date: p.validFrom, text: p.validFromText }),
			to: p.validTo || p.validToText ? formatImprecise({ kind: (p.validToKind as TimeKind) ?? 'day', date: p.validTo, text: p.validToText }) : null,
			sortFrom: sortableInstant({ kind: p.validFromKind as TimeKind, date: p.validFrom, text: p.validFromText })
		}))
		.sort((a, b) => b.sortFrom - a.sortFrom);

	const journal = connection.journal
		.map((j) => ({
			title: j.title,
			when: formatImprecise({ kind: j.occurredAtKind as TimeKind, date: j.occurredAt, text: j.occurredAtText }),
			note: j.note,
			sortAt: sortableInstant({ kind: j.occurredAtKind as TimeKind, date: j.occurredAt, text: j.occurredAtText })
		}))
		.sort((a, b) => b.sortAt - a.sortAt);

	// Common events: both participate. exactlyTwo = participant set is exactly {low, high} (DEC-022).
	const events = await db.event.findMany({
		where: { ownerId, participants: { some: { personId: low } }, AND: { participants: { some: { personId: high } } } },
		include: { eventType: true, participants: true, location: true }
	});
	const eventList = events
		.map((e) => ({
			id: e.id,
			name: e.name,
			typeName: e.eventType.name,
			sensitive: e.eventType.sensitivity === 'sensitive',
			when: formatImprecise({ kind: e.occurredAtKind as TimeKind, date: e.occurredAt, text: e.occurredAtText }),
			exactlyTwo: e.participants.length === 2,
			others: e.participants.length - 2,
			sortAt: sortableInstant({ kind: e.occurredAtKind as TimeKind, date: e.occurredAt, text: e.occurredAtText })
		}))
		.sort((a, b) => b.sortAt - a.sortAt);

	return { persons, pairParam, catalog, exists: true, current, color, history, journal, events: eventList, activePeriods, hasRomance };
};

export const actions: Actions = {
	setType: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const connId = await resolveConnectionId(ownerId, params.pair);
		if (!connId) return fail(404, { error: 'Verbindung nicht gefunden.' });
		const fd = await request.formData();
		const res = await startType(ownerId, connId, Number(fd.get('typeId')), parseImprecise(fd, 'when'));
		if (!res.ok) return fail(400, { error: res.message ?? res.error });
		return { done: true };
	},

	// Familienbeziehung ist gerichtet: man wählt nur die Rolle der einen Person,
	// die Gegenrolle der anderen wird automatisch aus deren Geschlecht abgeleitet.
	setFamily: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const pair = parsePair(params.pair);
		if (!pair) return fail(404, { error: 'Ungültiges Paar.' });
		let low: number, high: number;
		try {
			({ low, high } = canonicalPair(pair[0], pair[1]));
		} catch {
			return fail(404, { error: 'Ungültiges Paar.' });
		}
		const connId = await resolveConnectionId(ownerId, params.pair);
		if (!connId) return fail(404, { error: 'Verbindung nicht gefunden.' });
		const fd = await request.formData();
		const time = parseImprecise(fd, 'when');
		const typeId = Number(fd.get('typeId') ?? '');
		const personId = Number(fd.get('personId') ?? '');
		if (!typeId || (personId !== low && personId !== high)) {
			return fail(400, { error: 'Bitte Person und Rolle wählen.' });
		}
		const res = await startFamilyType(ownerId, connId, typeId, personId, time);
		if (!res.ok) return fail(400, { error: res.message ?? res.error });
		return { done: true };
	},

	endRomance: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const connId = await resolveConnectionId(ownerId, params.pair);
		if (!connId) return fail(404, { error: 'Verbindung nicht gefunden.' });
		const fd = await request.formData();
		const followRaw = String(fd.get('followClosenessTypeId') ?? '');
		const follow = followRaw === '' ? null : Number(followRaw);
		const res = await endRomance(ownerId, connId, parseImprecise(fd, 'when'), follow, fd.get('activateEx') === 'on');
		if (!res.ok) return fail(400, { error: res.message ?? res.error });
		return { done: true };
	},

	endPeriod: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const fd = await request.formData();
		const res = await endPeriod(ownerId, Number(fd.get('periodId')), parseImprecise(fd, 'when'));
		if (!res.ok) return fail(400, { error: res.message ?? res.error });
		return { done: true };
	},

	addJournal: async ({ locals, params, request }) => {
		const ownerId = locals.user!.id;
		const connId = await resolveConnectionId(ownerId, params.pair);
		if (!connId) return fail(404, { error: 'Verbindung nicht gefunden.' });
		const fd = await request.formData();
		const res = await addJournal(ownerId, connId, parseImprecise(fd, 'when'), String(fd.get('title') ?? ''), String(fd.get('note') ?? ''));
		if (!res.ok) return fail(400, { error: res.message ?? res.error });
		return { done: true };
	},

	// Versehentlich angelegte Verbindung: komplett löschen, kein Eintrag im Verlauf/Changelog.
	deleteConnection: async ({ locals, params }) => {
		const ownerId = locals.user!.id;
		const connId = await resolveConnectionId(ownerId, params.pair);
		if (!connId) return fail(404, { error: 'Verbindung nicht gefunden.' });
		const res = await deleteConnection(ownerId, connId);
		if (!res.ok) return fail(400, { error: res.message ?? res.error });
		throw redirect(303, '/graph');
	},

	// Falsch angelegter Verlauf: alle Perioden + Changelog löschen, Verbindung bleibt bestehen.
	clearHistory: async ({ locals, params }) => {
		const ownerId = locals.user!.id;
		const connId = await resolveConnectionId(ownerId, params.pair);
		if (!connId) return fail(404, { error: 'Verbindung nicht gefunden.' });
		const res = await clearHistory(ownerId, connId);
		if (!res.ok) return fail(400, { error: res.message ?? res.error });
		return { done: true };
	}
};
