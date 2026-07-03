import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { findOrCreateLocation } from './geo';
import type { ParsedImprecise } from './impreciseTime';
import type { TimeKind } from '$lib/domain/time';
import { canonicalPair, normalizeRelationshipTypeName } from '$lib/domain/relationships';

/**
 * Narrative-friendly JSON import (FEAT, complements the one-time Notion import).
 *
 * The payload references people by a stable `ref` key (or by exact name) so that
 * connections and events can point at persons that are created in the same import.
 * Preview runs the full apply inside a transaction and rolls it back, so the
 * reported counts are exact without writing anything.
 *
 * See docs/import/ for the schema reference and the narrative→JSON prompt.
 */

const TIME_KINDS: TimeKind[] = ['day', 'month', 'year', 'season', 'approx', 'unknown'];

// A time may be a plain string ("2023-08", "2023", "2023-08-15", "Sommer 2022")
// or an explicit { kind, date, text } object (C-MODEL-9 / DEC-013).
const timeSchema = z.union([
	z.string(),
	z.object({ kind: z.string().optional(), date: z.string().optional(), text: z.string().optional() })
]);

const socialSchema = z.object({
	platform: z.string().trim().min(1),
	handle: z.string().trim().min(1),
	url: z.string().trim().optional(),
	visibility: z.string().trim().optional()
});

const personSchema = z.object({
	ref: z.string().trim().min(1).optional(),
	name: z.string().trim().min(1),
	dateOfBirth: z.string().trim().optional(),
	gender: z.string().trim().optional(),
	city: z.string().trim().optional(),
	notes: z.string().trim().optional(),
	profileImageUrl: z.string().trim().optional(),
	socialAccounts: z.array(socialSchema).optional()
});

const periodSchema = z.object({
	type: z.string().trim().min(1),
	from: timeSchema.optional(),
	to: timeSchema.optional(),
	note: z.string().trim().optional()
});

const journalSchema = z.object({
	title: z.string().trim().min(1),
	note: z.string().trim().optional(),
	at: timeSchema.optional()
});

const connectionSchema = z.object({
	personA: z.string().trim().min(1),
	personB: z.string().trim().min(1),
	periods: z.array(periodSchema).optional(),
	journal: z.array(journalSchema).optional()
});

const eventSchema = z.object({
	name: z.string().trim().min(1),
	type: z.string().trim().min(1),
	at: timeSchema.optional(),
	city: z.string().trim().optional(),
	participants: z.array(z.string().trim().min(1)).min(1),
	note: z.string().trim().optional()
});

const importSchema = z.object({
	version: z.number().optional(),
	persons: z.array(personSchema).optional().default([]),
	connections: z.array(connectionSchema).optional().default([]),
	events: z.array(eventSchema).optional().default([])
});

export type ImportPayload = z.infer<typeof importSchema>;
type TimeInput = z.infer<typeof timeSchema>;

export interface ImportReport {
	personsCreated: number;
	personsReused: number;
	socialAccountsCreated: number;
	connectionsCreated: number;
	connectionsReused: number;
	periodsCreated: number;
	journalCreated: number;
	eventsCreated: number;
	skipped: number;
	/** IDs of all persons touched (created or reused) by this import — lets callers focus/highlight them. */
	personIds: number[];
}

export interface ImportResult {
	ok: boolean;
	mode: 'preview' | 'apply';
	/** Top-level / validation error (nothing was applied). */
	error?: string;
	/** Non-fatal issues encountered per row (skipped periods, unknown refs, …). */
	warnings: string[];
	report?: ImportReport;
}

const emptyReport = (): ImportReport => ({
	personsCreated: 0,
	personsReused: 0,
	socialAccountsCreated: 0,
	connectionsCreated: 0,
	connectionsReused: 0,
	periodsCreated: 0,
	journalCreated: 0,
	eventsCreated: 0,
	skipped: 0,
	personIds: []
});

// --- value normalizers -----------------------------------------------------

export function normalizeGender(raw?: string): string | null {
	if (!raw) return null;
	const v = raw.trim().toLowerCase();
	if (['männlich', 'maennlich', 'male', 'm', 'mann'].includes(v)) return 'Männlich';
	if (['weiblich', 'female', 'w', 'f', 'frau'].includes(v)) return 'Weiblich';
	if (['divers', 'diverse', 'non-binary', 'nonbinary', 'd', 'nb'].includes(v)) return 'divers';
	return null;
}

function parseObjTime(kindRaw: string | undefined, dateRaw: string, textRaw: string): ParsedImprecise {
	const kind: TimeKind = (TIME_KINDS as string[]).includes(kindRaw ?? '') ? (kindRaw as TimeKind) : 'day';
	switch (kind) {
		case 'day': {
			if (!dateRaw) return { kind, date: null, text: textRaw || null };
			const d = new Date(dateRaw + 'T00:00:00Z');
			return { kind, date: isNaN(d.getTime()) ? null : d, text: isNaN(d.getTime()) ? dateRaw : null };
		}
		case 'month': {
			const m = dateRaw.match(/^(\d{4})-(\d{2})$/);
			if (!m) return { kind, date: null, text: dateRaw || textRaw || null };
			return { kind, date: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)), text: null };
		}
		case 'year': {
			if (!/^\d{4}$/.test(dateRaw)) return { kind, date: null, text: dateRaw || textRaw || null };
			return { kind, date: new Date(Date.UTC(Number(dateRaw), 0, 1)), text: null };
		}
		case 'season':
		case 'approx':
			return { kind, date: null, text: textRaw || dateRaw || null };
		case 'unknown':
		default:
			return { kind: 'unknown', date: null, text: textRaw || dateRaw || null };
	}
}

/** Normalize a time (string shorthand or object) into the stored {kind,date,text} triple. */
export function parseTime(input: TimeInput | null | undefined): ParsedImprecise {
	if (input == null) return { kind: 'unknown', date: null, text: null };
	if (typeof input === 'string') {
		const s = input.trim();
		if (!s) return { kind: 'unknown', date: null, text: null };
		if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseObjTime('day', s, '');
		if (/^\d{4}-\d{2}$/.test(s)) return parseObjTime('month', s, '');
		if (/^\d{4}$/.test(s)) return parseObjTime('year', s, '');
		return { kind: 'approx', date: null, text: s };
	}
	return parseObjTime(input.kind, (input.date ?? '').trim(), (input.text ?? '').trim());
}

// Throwing this out of the transaction rolls back a preview run.
class PreviewRollback extends Error {}

// --- apply -----------------------------------------------------------------

async function applyPayload(
	tx: Prisma.TransactionClient,
	ownerId: number,
	payload: ImportPayload,
	report: ImportReport,
	warnings: string[]
): Promise<void> {
	const [relTypes, eventTypes] = await Promise.all([
		tx.relationshipType.findMany({ select: { id: true, name: true } }),
		tx.eventType.findMany({ select: { id: true, name: true } })
	]);
	const relTypeByName = new Map(relTypes.map((t) => [t.name.toLowerCase(), t.id]));
	const eventTypeByName = new Map(eventTypes.map((t) => [t.name.toLowerCase(), t.id]));

	// ref/name → personId. Both a person's `ref` and its lowercased name resolve.
	const refMap = new Map<string, number>();
	const register = (key: string, id: number) => refMap.set(key.trim().toLowerCase(), id);
	const resolve = (key: string): number | null => refMap.get(key.trim().toLowerCase()) ?? null;

	// 1) Persons — reuse an existing owned person with the same name, else create.
	for (const p of payload.persons) {
		const existing = await tx.person.findFirst({ where: { ownerId, name: p.name } });
		let personId: number;
		if (existing) {
			personId = existing.id;
			report.personsReused++;
		} else {
			let dob: Date | null = null;
			if (p.dateOfBirth) {
				const d = new Date(p.dateOfBirth + 'T00:00:00Z');
				if (isNaN(d.getTime())) warnings.push(`Person „${p.name}": ungültiges Geburtsdatum „${p.dateOfBirth}" ignoriert.`);
				else dob = d;
			}
			if (p.gender && !normalizeGender(p.gender)) {
				warnings.push(`Person „${p.name}": unbekanntes Geschlecht „${p.gender}" ignoriert.`);
			}
			let imageUrl: string | null = null;
			if (p.profileImageUrl) {
				if (/^https:\/\//i.test(p.profileImageUrl)) imageUrl = p.profileImageUrl;
				else warnings.push(`Person „${p.name}": Bild-URL ist nicht HTTPS und wurde ignoriert.`);
			}
			const locationId = p.city ? await findOrCreateLocation(p.city, tx) : null;
			const created = await tx.person.create({
				data: {
					ownerId,
					name: p.name,
					dateOfBirth: dob,
					gender: normalizeGender(p.gender),
					notes: p.notes || null,
					profileImageUrl: imageUrl,
					locationId
				}
			});
			personId = created.id;
			report.personsCreated++;
			for (const sa of p.socialAccounts ?? []) {
				await tx.socialAccount.create({
					data: {
						personId,
						platform: sa.platform,
						handle: sa.handle,
						url: sa.url && /^https:\/\//i.test(sa.url) ? sa.url : null,
						visibility: sa.visibility || null
					}
				});
				report.socialAccountsCreated++;
			}
		}
		if (p.ref) register(p.ref, personId);
		register(p.name, personId);
		report.personIds.push(personId);
	}

	// 2) Connections + periods + journal.
	for (const c of payload.connections) {
		const aId = resolve(c.personA);
		const bId = resolve(c.personB);
		if (aId == null || bId == null) {
			report.skipped++;
			warnings.push(`Verbindung übersprungen: unbekannte Person „${aId == null ? c.personA : c.personB}".`);
			continue;
		}
		if (aId === bId) {
			report.skipped++;
			warnings.push(`Verbindung übersprungen: „${c.personA}" und „${c.personB}" sind dieselbe Person.`);
			continue;
		}
		const { low, high } = canonicalPair(aId, bId);
		let conn = await tx.connection.findUnique({
			where: { ownerId_personLowId_personHighId: { ownerId, personLowId: low, personHighId: high } }
		});
		if (conn) {
			report.connectionsReused++;
		} else {
			conn = await tx.connection.create({ data: { ownerId, personLowId: low, personHighId: high } });
			report.connectionsCreated++;
		}

		for (const period of c.periods ?? []) {
			const normalizedType = normalizeRelationshipTypeName(period.type);
			const typeId = relTypeByName.get(normalizedType.toLowerCase());
			if (typeId == null) {
				report.skipped++;
				warnings.push(`Verbindung „${c.personA}–${c.personB}": unbekannter Beziehungstyp „${period.type}" übersprungen.`);
				continue;
			}
			const from = parseTime(period.from);
			const hasTo = period.to != null;
			const to = hasTo ? parseTime(period.to) : null;
			await tx.connectionRelationshipPeriod.create({
				data: {
					connectionId: conn.id,
					relationshipTypeId: typeId,
					validFromKind: from.kind,
					validFrom: from.date,
					validFromText: from.text,
					validToKind: to ? to.kind : null,
					validTo: to ? to.date : null,
					validToText: to ? to.text : null,
					note: period.note || null
				}
			});
			report.periodsCreated++;
		}

		for (const j of c.journal ?? []) {
			const at = parseTime(j.at);
			await tx.connectionJournalEntry.create({
				data: {
					connectionId: conn.id,
					title: j.title,
					note: j.note || null,
					occurredAtKind: at.kind,
					occurredAt: at.date,
					occurredAtText: at.text
				}
			});
			report.journalCreated++;
		}
	}

	// 3) Events with participants.
	for (const e of payload.events) {
		const typeId = eventTypeByName.get(e.type.toLowerCase());
		if (typeId == null) {
			report.skipped++;
			warnings.push(`Ereignis „${e.name}": unbekannter Ereignistyp „${e.type}" übersprungen.`);
			continue;
		}
		const ids = [...new Set(e.participants.map(resolve).filter((id): id is number => id != null))];
		if (ids.length < 1) {
			report.skipped++;
			warnings.push(`Ereignis „${e.name}": keine bekannten Teilnehmer, übersprungen.`);
			continue;
		}
		if (ids.length !== new Set(e.participants).size) {
			warnings.push(`Ereignis „${e.name}": einige Teilnehmer waren unbekannt und wurden ausgelassen.`);
		}
		const at = parseTime(e.at);
		const locationId = e.city ? await findOrCreateLocation(e.city, tx) : null;
		await tx.event.create({
			data: {
				ownerId,
				name: e.name,
				eventTypeId: typeId,
				occurredAtKind: at.kind,
				occurredAt: at.date,
				occurredAtText: at.text,
				locationId,
				note: e.note || null,
				participants: { create: ids.map((personId) => ({ personId })) }
			}
		});
		report.eventsCreated++;
	}

	if (report.personsCreated + report.connectionsCreated + report.eventsCreated + report.periodsCreated === 0) {
		warnings.push('Es wurden keine neuen Daten erkannt (alles bereits vorhanden oder leer).');
	}
}

/**
 * Validate and import a JSON payload. With `apply=false` (preview) the whole
 * import runs in a transaction that is rolled back, so counts are exact and
 * nothing is written. With `apply=true` it is committed and an ImportBatch is
 * recorded for the audit trail.
 */
export async function runJsonImport(ownerId: number, raw: unknown, apply: boolean): Promise<ImportResult> {
	const parsed = importSchema.safeParse(raw);
	if (!parsed.success) {
		const first = parsed.error.errors[0];
		const path = first?.path.join('.') || '(root)';
		return { ok: false, mode: apply ? 'apply' : 'preview', warnings: [], error: `Schema-Fehler bei ${path}: ${first?.message}` };
	}

	const report = emptyReport();
	const warnings: string[] = [];
	try {
		await db.$transaction(
			async (tx) => {
				await applyPayload(tx, ownerId, parsed.data, report, warnings);
				if (apply) {
					await tx.importBatch.create({
						data: {
							status: 'applied',
							finishedAt: new Date(),
							createdCount: report.personsCreated + report.connectionsCreated + report.eventsCreated,
							skippedCount: report.skipped,
							errorCount: 0
						}
					});
				} else {
					throw new PreviewRollback();
				}
			},
			{ timeout: 60000 }
		);
	} catch (e) {
		if (!(e instanceof PreviewRollback)) {
			return { ok: false, mode: apply ? 'apply' : 'preview', warnings, error: `Import fehlgeschlagen: ${(e as Error).message}` };
		}
	}

	return { ok: true, mode: apply ? 'apply' : 'preview', warnings, report };
}
