import { db } from './db';
import { loadRelTypes } from './queries';
import {
	activeCloseness,
	canonicalPair,
	evaluateStartType,
	hasActiveRomance,
	validateEndRomance,
	type Period
} from '$lib/domain/relationships';
import type { ParsedImprecise } from './impreciseTime';

export interface ServiceResult {
	ok: boolean;
	error?: string;
	message?: string;
	connectionId?: number;
}

async function ownsConnection(ownerId: number, connectionId: number) {
	return db.connection.findFirst({ where: { id: connectionId, ownerId } });
}

async function activePeriodsFor(connectionId: number): Promise<(Period & { id: number })[]> {
	const rows = await db.connectionRelationshipPeriod.findMany({
		where: { connectionId },
		select: { id: true, relationshipTypeId: true, validFrom: true, validTo: true }
	});
	return rows.map((r) => ({ id: r.id, relationshipTypeId: r.relationshipTypeId, validFrom: r.validFrom, validTo: r.validTo }));
}

function fromFields(t: ParsedImprecise) {
	return { validFromKind: t.kind, validFrom: t.date, validFromText: t.text };
}
function toFields(t: ParsedImprecise) {
	return { validToKind: t.kind, validTo: t.date, validToText: t.text };
}

/** Find or create the canonical connection between two owned persons. */
export async function getOrCreateConnection(ownerId: number, a: number, b: number): Promise<ServiceResult> {
	let low: number, high: number;
	try {
		({ low, high } = canonicalPair(a, b));
	} catch {
		return { ok: false, error: 'E-SELF-EDGE', message: 'Eine Verbindung braucht zwei verschiedene Personen.' };
	}
	const [pa, pb] = await Promise.all([
		db.person.findFirst({ where: { id: low, ownerId } }),
		db.person.findFirst({ where: { id: high, ownerId } })
	]);
	if (!pa || !pb) return { ok: false, error: 'E-NOT-FOUND', message: 'Person nicht gefunden.' };

	const existing = await db.connection.findUnique({
		where: { ownerId_personLowId_personHighId: { ownerId, personLowId: low, personHighId: high } }
	});
	if (existing) return { ok: true, connectionId: existing.id };

	const created = await db.connection.create({ data: { ownerId, personLowId: low, personHighId: high } });
	return { ok: true, connectionId: created.id };
}

/**
 * Start (or change to) a relationship type on a connection, enforcing the domain
 * rules. Conflicting active periods are closed at the new period's start (V-1..V-6).
 */
export async function startType(
	ownerId: number,
	connectionId: number,
	typeId: number,
	time: ParsedImprecise,
	note?: string | null
): Promise<ServiceResult> {
	if (!(await ownsConnection(ownerId, connectionId))) return { ok: false, error: 'E-NOT-FOUND' };
	const [periods, types] = await Promise.all([activePeriodsFor(connectionId), loadRelTypes()]);

	const evalResult = evaluateStartType(typeId, periods, types);
	if (!evalResult.allowed) return { ok: false, error: evalResult.error, message: evalResult.message };

	await db.$transaction(async (tx) => {
		// Close every active period of the to-be-ended types at the new start.
		for (const endTypeId of evalResult.ends) {
			const active = periods.find((p) => p.relationshipTypeId === endTypeId && p.validTo === null);
			if (active) {
				await tx.connectionRelationshipPeriod.update({ where: { id: active.id }, data: toFields(time) });
				await tx.relationshipChangeLog.create({ data: { connectionId, action: 'end', relationshipTypeId: endTypeId, detail: 'beendet durch neuen Typ' } });
			}
		}
		await tx.connectionRelationshipPeriod.create({
			data: { connectionId, relationshipTypeId: typeId, ...fromFields(time), note: note || null }
		});
		await tx.relationshipChangeLog.create({ data: { connectionId, action: 'start', relationshipTypeId: typeId } });
	});

	return { ok: true, connectionId };
}

/** End a specific active period at the given time. */
export async function endPeriod(ownerId: number, periodId: number, time: ParsedImprecise): Promise<ServiceResult> {
	const period = await db.connectionRelationshipPeriod.findUnique({ where: { id: periodId }, include: { connection: true } });
	if (!period || period.connection.ownerId !== ownerId) return { ok: false, error: 'E-NOT-FOUND' };
	await db.$transaction(async (tx) => {
		await tx.connectionRelationshipPeriod.update({ where: { id: periodId }, data: toFields(time) });
		await tx.relationshipChangeLog.create({ data: { connectionId: period.connectionId, action: 'end', relationshipTypeId: period.relationshipTypeId } });
	});
	return { ok: true, connectionId: period.connectionId };
}

/**
 * End an active romance with the mandatory follow-status dialog (V-5, DEC-009):
 * close the romance, optionally start a follow closeness, optionally activate Ex.
 */
export async function endRomance(
	ownerId: number,
	connectionId: number,
	time: ParsedImprecise,
	followClosenessTypeId: number | null,
	activateEx: boolean
): Promise<ServiceResult> {
	if (!(await ownsConnection(ownerId, connectionId))) return { ok: false, error: 'E-NOT-FOUND' };
	const err = validateEndRomance({ followClosenessTypeId, activateExPartner: activateEx });
	if (err) return { ok: false, error: err, message: 'Bitte einen Folge-Nähegrad wählen.' };

	const [periods, types] = await Promise.all([activePeriodsFor(connectionId), loadRelTypes()]);
	const romanceType = types.find((t) => t.name === 'Romantik');
	const exType = types.find((t) => t.name === 'Ex-Partner/in');
	const romance = periods.find((p) => p.relationshipTypeId === romanceType?.id && p.validTo === null);
	if (!romance) return { ok: false, error: 'E-NO-ROMANCE', message: 'Keine aktive Romantik.' };

	// Follow closeness must actually be a closeness level if provided.
	if (followClosenessTypeId != null && !types.find((t) => t.id === followClosenessTypeId)?.isClosenessLevel) {
		return { ok: false, error: 'E-BAD-FOLLOW', message: 'Folge-Typ ist kein Nähegrad.' };
	}

	await db.$transaction(async (tx) => {
		await tx.connectionRelationshipPeriod.update({ where: { id: romance.id }, data: toFields(time) });
		await tx.relationshipChangeLog.create({ data: { connectionId, action: 'end', relationshipTypeId: romance.relationshipTypeId, detail: 'Romantik beendet' } });
		if (followClosenessTypeId != null) {
			await tx.connectionRelationshipPeriod.create({ data: { connectionId, relationshipTypeId: followClosenessTypeId, ...fromFields(time) } });
			await tx.relationshipChangeLog.create({ data: { connectionId, action: 'set-follow-status', relationshipTypeId: followClosenessTypeId } });
		}
		if (activateEx && exType) {
			await tx.connectionRelationshipPeriod.create({ data: { connectionId, relationshipTypeId: exType.id, ...fromFields(time) } });
			await tx.relationshipChangeLog.create({ data: { connectionId, action: 'start', relationshipTypeId: exType.id, detail: 'Ex-Partner/in' } });
		}
	});
	return { ok: true, connectionId };
}

/**
 * Auto-Bekanntschaft (AC-Event-Teilnahme): wenn zwei Personen gemeinsam an einem
 * Ereignis teilnehmen und noch KEINE aktive Nähegrad-Stufe zwischen ihnen besteht
 * (und keine aktive Romantik, die einen Nähegrad ohnehin blockiert), wird
 * automatisch "Bekanntschaft" gestartet. Ein bereits vorhandener Nähegrad
 * (auch Bekanntschaft selbst) wird nie überschrieben oder herabgestuft.
 * Best-effort + idempotent — wirft nie, damit eine Ereignis-Speicherung nicht daran scheitert.
 */
export async function ensureAcquaintance(connectionId: number, time: ParsedImprecise): Promise<void> {
	const types = await loadRelTypes();
	const bekanntschaft = types.find((t) => t.name === 'Bekanntschaft');
	if (!bekanntschaft) return; // Referenzdaten fehlen — nichts zu tun

	const periods = await activePeriodsFor(connectionId);
	if (activeCloseness(periods, types) || hasActiveRomance(periods, types)) return; // schon ein Status / durch Romantik blockiert

	await db.$transaction(async (tx) => {
		// Zwischen Laden und Schreiben könnte parallel bereits ein Status gesetzt worden sein — Race-Guard.
		const stillNone = await tx.connectionRelationshipPeriod.findFirst({
			where: { connectionId, validTo: null, relationshipType: { isClosenessLevel: true } }
		});
		if (stillNone) return;
		await tx.connectionRelationshipPeriod.create({
			data: { connectionId, relationshipTypeId: bekanntschaft.id, ...fromFields(time) }
		});
		await tx.relationshipChangeLog.create({
			data: { connectionId, action: 'start', relationshipTypeId: bekanntschaft.id, detail: 'automatisch aus gemeinsamer Ereignisteilnahme' }
		});
	});
}

/**
 * Für alle Personenpaare eines Ereignisses (Verbindung finden/anlegen +
 * ensureAcquaintance). Best-effort — einzelne Fehler blockieren die anderen Paare nicht.
 */
export async function ensureAcquaintanceForParticipants(
	ownerId: number,
	personIds: number[],
	time: ParsedImprecise
): Promise<void> {
	const ids = [...new Set(personIds)];
	for (let i = 0; i < ids.length; i += 1) {
		for (let j = i + 1; j < ids.length; j += 1) {
			try {
				const conn = await getOrCreateConnection(ownerId, ids[i], ids[j]);
				if (conn.ok && conn.connectionId) await ensureAcquaintance(conn.connectionId, time);
			} catch {
				// best-effort — ein Paar darf die übrigen nicht blockieren
			}
		}
	}
}

export async function addJournal(
	ownerId: number,
	connectionId: number,
	time: ParsedImprecise,
	title: string,
	note?: string | null
): Promise<ServiceResult> {
	if (!(await ownsConnection(ownerId, connectionId))) return { ok: false, error: 'E-NOT-FOUND' };
	if (!title.trim()) return { ok: false, error: 'E-TITLE', message: 'Titel erforderlich.' };
	await db.connectionJournalEntry.create({
		data: { connectionId, title: title.trim(), note: note || null, occurredAtKind: time.kind, occurredAt: time.date, occurredAtText: time.text }
	});
	return { ok: true, connectionId };
}
