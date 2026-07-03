import { fail, redirect } from '@sveltejs/kit';
import { loadGraph, loadRelTypes, findConnection } from '$lib/server/queries';
import { mergePersons } from '$lib/server/persons';
import { startType, getOrCreateConnection } from '$lib/server/relationshipService';
import { db } from '$lib/server/db';
import { findOrCreateLocation } from '$lib/server/geo';
import { TYPE_COLORS } from '$lib/domain/relationships';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const [graph, relTypes] = await Promise.all([loadGraph(locals.user!.id), loadRelTypes()]);
	const focus = url.searchParams.get('focus');
	const focusId = focus && /^\d+$/.test(focus) ? Number(focus) : null;

	// Legend entries (the four primary edge types shown in SCR-020).
	const legend = [
		{ label: 'Bekanntschaft', color: TYPE_COLORS['Bekanntschaft'] },
		{ label: 'Freundschaft', color: TYPE_COLORS['Freundschaft'] },
		{ label: 'Enge Freundschaft', color: TYPE_COLORS['Enge Freundschaft'] },
		{ label: 'Romantik', color: TYPE_COLORS['Romantik'] }
	];

	const types = relTypes
		.filter((t) => TYPE_COLORS[t.name])
		.map((t) => ({ id: t.id, name: t.name, color: TYPE_COLORS[t.name] }));

	return { graph, focusId, legend, types };
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
		const today = { kind: 'day' as const, date: new Date(), text: null };
		const res = await startType(locals.user!.id, conn.id, typeId, today);
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
		const today = { kind: 'day' as const, date: new Date(), text: null };
		const errors: string[] = [];
		for (const targetId of targets) {
			const connRes = await getOrCreateConnection(locals.user!.id, sourceId, targetId);
			if (!connRes.ok || !connRes.connectionId) { errors.push(connRes.message ?? 'Fehler'); continue; }
			const typeRes = await startType(locals.user!.id, connRes.connectionId, typeId, today);
			if (!typeRes.ok) errors.push(typeRes.message ?? 'Fehler');
		}
		if (errors.length) return fail(400, { quickConnectError: errors.join('; ') });
		return { done: true };
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
