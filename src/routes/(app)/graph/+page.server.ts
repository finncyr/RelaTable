import { fail, redirect } from '@sveltejs/kit';
import { loadGraph, loadRelTypes, findConnection } from '$lib/server/queries';
import { mergePersons } from '$lib/server/persons';
import { startType, startFamilyType, getOrCreateConnection, deleteConnection, endPeriod, endFamilyType } from '$lib/server/relationshipService';
import { db } from '$lib/server/db';
import { findOrCreateLocation } from '$lib/server/geo';
import { processPersonForm } from '$lib/server/personForm';
import { TYPE_COLORS } from '$lib/domain/relationships';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const [graph, relTypes] = await Promise.all([loadGraph(locals.user!.id), loadRelTypes()]);
	const focus = url.searchParams.get('focus');
	const focusId = focus && /^\d+$/.test(focus) ? Number(focus) : null;

	// Legend entries (the four primary edge types shown in SCR-020, plus Familie/gold).
	const legend = [
		{ key: 'Bekanntschaft', label: 'Bekanntschaft', color: TYPE_COLORS['Bekanntschaft'] },
		{ key: 'Freundschaft', label: 'Freundschaft', color: TYPE_COLORS['Freundschaft'] },
		{ key: 'Enge Freundschaft', label: 'Enge Freundschaft', color: TYPE_COLORS['Enge Freundschaft'] },
		{ key: 'Romantik', label: 'Romantik', color: TYPE_COLORS['Romantik'] },
		{ key: 'Familie', label: 'Familie', color: TYPE_COLORS['Mutter'] },
		{ key: 'Kontext', label: 'Kontext', color: '#7a8a99' }
	];

	const types = relTypes
		.filter((t) => t.categoryName !== 'Familie')
		.map((t) => ({ id: t.id, name: t.name, color: TYPE_COLORS[t.name] ?? t.color ?? '#7a8a99' }));
	const familyTypes = relTypes
		.filter((t) => t.categoryName === 'Familie')
		.map((t) => ({ id: t.id, name: t.name, color: TYPE_COLORS[t.name] ?? t.color ?? '#c9a227' }));

	return { graph, focusId, legend, types, familyTypes };
};

export const actions: Actions = {
	changeType: async ({ locals, request }) => {
		const fd = await request.formData();
		const low = Number(fd.get('low'));
		const high = Number(fd.get('high'));
		const typeId = Number(fd.get('typeId'));
		if (!Number.isInteger(low) || !Number.isInteger(high) || !Number.isInteger(typeId)) {
			return fail(400, { changeTypeError: 'Ungültige Parameter.' });
		}
		const conn = await findConnection(locals.user!.id, low, high);
		if (!conn) return fail(404, { changeTypeError: 'Verbindung nicht gefunden.' });
		const type = await db.relationshipType.findUnique({ where: { id: typeId }, include: { category: true } });
		// Familie ist gerichtet: das Formular gibt per personId explizit an, welche Person die
		// gewählte Rolle trägt — die Gegenrolle der anderen Person wird automatisch aus deren
		// Geschlecht abgeleitet. Fällt ohne personId auf "low" zurück.
		const personIdRaw = fd.get('personId');
		const personId = personIdRaw != null && personIdRaw !== '' ? Number(personIdRaw) : low;
		const res =
			type?.category.name === 'Familie'
				? await startFamilyType(locals.user!.id, conn.id, typeId, personId, { kind: 'day', date: new Date(), text: null })
				: await startType(locals.user!.id, conn.id, typeId, { kind: 'day', date: new Date(), text: null });
		if (!res.ok) return fail(400, { changeTypeError: res.message ?? res.error });
		return { done: true };
	},

	// Versehentlich angelegte Verbindung: komplett löschen, kein Eintrag im Verlauf.
	deleteConnection: async ({ locals, request }) => {
		const fd = await request.formData();
		const low = Number(fd.get('low'));
		const high = Number(fd.get('high'));
		if (!Number.isInteger(low) || !Number.isInteger(high)) {
			return fail(400, { changeTypeError: 'Ungültige Parameter.' });
		}
		const conn = await findConnection(locals.user!.id, low, high);
		if (!conn) return fail(404, { changeTypeError: 'Verbindung nicht gefunden.' });
		const res = await deleteConnection(locals.user!.id, conn.id);
		if (!res.ok) return fail(400, { changeTypeError: res.message ?? res.error });
		return { done: true };
	},

	quickConnect: async ({ locals, request }) => {
		const fd = await request.formData();
		const sourceId = Number(fd.get('sourceId'));
		const typeId = Number(fd.get('typeId'));
		const targets = fd.getAll('targetId').map(Number);
		if (!Number.isInteger(sourceId) || !Number.isInteger(typeId) || !targets.length) {
			return fail(400, { quickConnectError: 'Ungültige Parameter.' });
		}
		const type = await db.relationshipType.findUnique({ where: { id: typeId }, include: { category: true } });
		const isFamily = type?.category.name === 'Familie';
		const today = { kind: 'day' as const, date: new Date(), text: null };
		const errors: string[] = [];
		for (const targetId of targets) {
			const connRes = await getOrCreateConnection(locals.user!.id, sourceId, targetId);
			if (!connRes.ok || !connRes.connectionId) { errors.push(connRes.message ?? 'Fehler'); continue; }
			// Familie ist gerichtet: die Zielperson trägt die gewählte Rolle (z. B. "ist mein Kind");
			// die Gegenrolle der Quellperson wird automatisch aus deren Geschlecht abgeleitet.
			const typeRes = isFamily
				? await startFamilyType(locals.user!.id, connRes.connectionId, typeId, targetId, today)
				: await startType(locals.user!.id, connRes.connectionId, typeId, today);
			if (!typeRes.ok) errors.push(typeRes.message ?? 'Fehler');
		}
		if (errors.length) return fail(400, { quickConnectError: errors.join('; ') });
		return { done: true };
	},

	// Matrix-Menü: Typ per erneutem Klick wieder wegnehmen (Verklicker korrigieren), ohne die
	// ganze Verbindung zu löschen.
	unassignType: async ({ locals, request }) => {
		const fd = await request.formData();
		const sourceId = Number(fd.get('sourceId'));
		const targetId = Number(fd.get('targetId'));
		const typeId = Number(fd.get('typeId'));
		if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || !Number.isInteger(typeId)) {
			return fail(400, { quickConnectError: 'Ungültige Parameter.' });
		}
		const conn = await findConnection(locals.user!.id, sourceId, targetId);
		if (!conn) return fail(404, { quickConnectError: 'Verbindung nicht gefunden.' });
		const type = await db.relationshipType.findUnique({ where: { id: typeId }, include: { category: true } });
		const isFamily = type?.category.name === 'Familie';
		const today = { kind: 'day' as const, date: new Date(), text: null };
		if (isFamily) {
			// Auch die automatisch abgeleitete Gegenrolle der anderen Person beenden (sonst gilt
			// die Verbindung weiter als "Familie aktiv" und blockiert die Nähegrad-Auswahl).
			const res = await endFamilyType(locals.user!.id, conn.id, typeId, targetId, today);
			if (!res.ok) return fail(400, { quickConnectError: res.message ?? res.error });
			return { done: true };
		}
		const period = await db.connectionRelationshipPeriod.findFirst({
			where: { connectionId: conn.id, relationshipTypeId: typeId, validTo: null, personId: null }
		});
		if (!period) return { done: true }; // schon inaktiv
		const res = await endPeriod(locals.user!.id, period.id, today);
		if (!res.ok) return fail(400, { quickConnectError: res.message ?? res.error });
		return { done: true };
	},

	createPerson: async ({ locals, request }) => {
		const fd = await request.formData();
		const result = await processPersonForm(fd);
		if (!result.ok) {
			const message = Object.values(result.errors ?? {}).flat()[0] ?? 'Ungültige Eingabe.';
			return fail(400, { createPersonError: message });
		}
		const person = await db.person.create({
			data: {
				ownerId: locals.user!.id,
				name: result.data!.name,
				dateOfBirth: result.data!.dateOfBirth,
				gender: result.data!.gender,
				locationId: result.data!.locationId,
				notes: result.data!.notes,
				profileImagePath: result.data!.profileImagePath,
				profileImageUrl: result.data!.profileImageUrl,
				aliases: { create: result.data!.aliases.map((alias) => ({ alias })) }
			}
		});
		return { personId: person.id, personName: person.name };
	},

	assignCity: async ({ locals, request }) => {
		const fd = await request.formData();
		const city = (fd.get('city') as string | null)?.trim();
		const personIds = fd.getAll('personId').map(Number).filter(Number.isInteger);
		if (!city || !personIds.length) return fail(400, { assignCityError: 'Ungültige Parameter.' });
		const locationId = await findOrCreateLocation(city);
		if (!locationId) return fail(400, { assignCityError: 'Ort konnte nicht erstellt werden.' });
		await db.person.updateMany({ where: { id: { in: personIds }, ownerId: locals.user!.id }, data: { locationId } });
		return { done: true };
	},

	merge: async ({ locals, request }) => {
		const data = await request.formData();
		const sourceId = Number(data.get('sourceId'));
		const targetId = Number(data.get('targetId'));
		if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
			return fail(400, { mergeError: 'Ungültige Personen-Auswahl.' });
		}

		try {
			await mergePersons(db, locals.user!.id, targetId, sourceId);
		} catch (e) {
			return fail(400, { mergeError: e instanceof Error ? e.message : 'Merge fehlgeschlagen.' });
		}
		throw redirect(303, `/graph?focus=${targetId}`);
	}
};
