import { db } from '$lib/server/db';
import { coordsFor } from '$lib/server/geo';
import { formatImprecise, type TimeKind } from '$lib/domain/time';
import { currentTypeName, colorForTypeName, loadRelTypes, toPeriods } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ownerId = locals.user!.id;

	const [persons, events, connections, types] = await Promise.all([
		db.person.findMany({ where: { ownerId }, include: { location: true, aliases: { select: { alias: true } } } }),
		db.event.findMany({ where: { ownerId }, include: { location: true, eventType: true } }),
		db.connection.findMany({
			where: { ownerId },
			include: { periods: { select: { relationshipTypeId: true, validFrom: true, validTo: true } } }
		}),
		loadRelTypes()
	]);

	// Stored coords if present, else resolve from the city name at read time. This self-heals rows
	// saved before the coordsFor lookup improved (e.g. "Frankfurt am Main" stored with null coords).
	type Loc = { latitude: number | null; longitude: number | null; city: string | null } | null;
	const coordsOf = (l: Loc): [number, number] | null =>
		l && l.latitude != null && l.longitude != null
			? [l.latitude, l.longitude]
			: l?.city
				? coordsFor(l.city)
				: null;

	const personMarkers = persons
		.map((p) => ({ p, c: coordsOf(p.location) }))
		.filter((x): x is { p: (typeof persons)[number]; c: [number, number] } => !!x.c)
		.map(({ p, c }) => ({
			id: p.id,
			name: p.name,
			aliases: p.aliases.map((entry) => entry.alias),
			city: p.location!.city,
			lat: c[0],
			lng: c[1],
			image: p.profileImagePath ? `/uploads/${p.profileImagePath}` : p.profileImageUrl
		}));

	const coordsByPersonId = new Map<number, { lat: number; lng: number }>(
		personMarkers.map((p) => [p.id, { lat: p.lat, lng: p.lng }])
	);

	const eventMarkers = events
		.map((e) => ({ e, c: coordsOf(e.location) }))
		.filter((x): x is { e: (typeof events)[number]; c: [number, number] } => !!x.c)
		.map(({ e, c }) => ({
			id: e.id,
			name: e.name,
			typeName: e.eventType.name,
			sensitive: e.eventType.sensitivity === 'sensitive',
			city: e.location!.city,
			lat: c[0],
			lng: c[1],
			when: formatImprecise({ kind: e.occurredAtKind as TimeKind, date: e.occurredAt, text: e.occurredAtText })
		}));

	const connectionSegments = connections
		.map((connection) => {
			const from = coordsByPersonId.get(connection.personLowId);
			const to = coordsByPersonId.get(connection.personHighId);
			if (!from || !to) return null;
			const typeName = currentTypeName(toPeriods(connection.periods), types);
			return {
				id: connection.id,
				sourceId: connection.personLowId,
				targetId: connection.personHighId,
				typeName,
				color: colorForTypeName(typeName, types),
				from,
				to
			};
		})
		.filter((segment): segment is NonNullable<typeof segment> => !!segment);

	// Items without a usable location are listed separately, never mis-placed (AC-093).
	const missingPersons = persons.filter((p) => !coordsOf(p.location)).length;
	const missingEvents = events.filter((e) => !coordsOf(e.location)).length;

	return {
		personMarkers,
		eventMarkers,
		connectionSegments,
		connectionLegend: [
			{ label: 'Bekanntschaft', color: TYPE_COLORS['Bekanntschaft'] },
			{ label: 'Freundschaft', color: TYPE_COLORS['Freundschaft'] },
			{ label: 'Enge Freundschaft', color: TYPE_COLORS['Enge Freundschaft'] },
			{ label: 'Romantik', color: TYPE_COLORS['Romantik'] }
		],
		missing: { persons: missingPersons, events: missingEvents },
		provider: process.env.PUBLIC_MAP_PROVIDER || 'leaflet'
	};
};
