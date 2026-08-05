import { db } from './db';
import { findOrCreateLocation } from './geo';
import type { ParsedImprecise } from './impreciseTime';
import { ensureAcquaintanceForParticipants } from './relationshipService';

export interface EventInput {
	name: string;
	eventTypeId: number;
	time: ParsedImprecise;
	city: string;
	participantIds: number[];
	note?: string | null;
}

export interface EventResult {
	ok: boolean;
	error?: string;
	eventId?: number;
}

async function validate(ownerId: number, input: EventInput): Promise<string | null> {
	if (!input.name.trim()) return 'Name erforderlich.';
	const type = await db.eventType.findUnique({ where: { id: input.eventTypeId } });
	if (!type) return 'Ereignistyp ungültig.';
	const ids = [...new Set(input.participantIds)].filter((n) => Number.isInteger(n));
	if (ids.length < 1) return 'Mindestens ein Teilnehmer erforderlich.'; // AC-060
	const count = await db.person.count({ where: { id: { in: ids }, ownerId } });
	if (count !== ids.length) return 'Unbekannte Teilnehmer.';
	return null;
}

export async function createEvent(ownerId: number, input: EventInput): Promise<EventResult> {
	const err = await validate(ownerId, input);
	if (err) return { ok: false, error: err };
	const locationId = input.city.trim() ? await findOrCreateLocation(input.city) : null;
	const ids = [...new Set(input.participantIds)];

	const event = await db.event.create({
		data: {
			ownerId,
			name: input.name.trim(),
			eventTypeId: input.eventTypeId,
			occurredAtKind: input.time.kind,
			occurredAt: input.time.date,
			occurredAtText: input.time.text,
			locationId,
			note: input.note || null,
			participants: { create: ids.map((personId) => ({ personId })) }
		}
	});
	// AC-Event-Teilnahme: Teilnehmer erhalten automatisch mind. "Bekanntschaft" (best-effort).
	if (ids.length >= 2) await ensureAcquaintanceForParticipants(ownerId, ids, input.time);
	return { ok: true, eventId: event.id };
}

export async function updateEvent(ownerId: number, eventId: number, input: EventInput): Promise<EventResult> {
	const existing = await db.event.findFirst({ where: { id: eventId, ownerId } });
	if (!existing) return { ok: false, error: 'Ereignis nicht gefunden.' };
	const err = await validate(ownerId, input);
	if (err) return { ok: false, error: err };
	const locationId = input.city.trim() ? await findOrCreateLocation(input.city) : null;
	const ids = [...new Set(input.participantIds)];

	await db.$transaction(async (tx) => {
		await tx.eventParticipant.deleteMany({ where: { eventId } });
		await tx.event.update({
			where: { id: eventId },
			data: {
				name: input.name.trim(),
				eventTypeId: input.eventTypeId,
				occurredAtKind: input.time.kind,
				occurredAt: input.time.date,
				occurredAtText: input.time.text,
				locationId,
				note: input.note || null,
				participants: { create: ids.map((personId) => ({ personId })) }
			}
		});
	});
	// AC-Event-Teilnahme: auch bei Bearbeitung für den finalen Teilnehmerkreis (best-effort).
	if (ids.length >= 2) await ensureAcquaintanceForParticipants(ownerId, ids, input.time);
	return { ok: true, eventId };
}

export async function deleteEvent(ownerId: number, eventId: number): Promise<EventResult> {
	const existing = await db.event.findFirst({ where: { id: eventId, ownerId } });
	if (!existing) return { ok: false, error: 'Ereignis nicht gefunden.' };
	await db.event.delete({ where: { id: eventId } });
	return { ok: true };
}
