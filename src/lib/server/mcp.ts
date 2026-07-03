import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from './db';
import { runJsonImport, parseTime, normalizeGender } from './jsonImport';
import { findOrCreateLocation } from './geo';
import { getOrCreateConnection, startType, endPeriod, endRomance, addJournal } from './relationshipService';
import { updateEvent } from './eventService';
import { searchPersons } from './persons';
import { canonicalPair, normalizeRelationshipTypeName } from '$lib/domain/relationships';
import type { ParsedImprecise } from './impreciseTime';
import type { TimeKind } from '$lib/domain/time';

// ponytail: single-owner app → erster AppUser ist der Owner. Env-Override (RELATABLE_OWNER_ID),
// falls später mehrere Owner nötig werden.
let _ownerId: number | null = null;
async function ownerId(): Promise<number> {
	if (_ownerId != null) return _ownerId;
	const u = await db.appUser.findFirst({ orderBy: { id: 'asc' } });
	if (!u) throw new Error('MCP: kein Owner vorhanden — erst Setup abschließen.');
	_ownerId = u.id;
	return _ownerId;
}

const SCHEMA_PATH = path.resolve(process.cwd(), 'docs/import/json-schema.md');

function text(name: string, lines: Record<string, unknown>): string {
	return [name, ...Object.entries(lines).map(([k, v]) => `  ${k}: ${v}`)].join('\n');
}

function err(msg: string) {
	return { content: [{ type: 'text' as const, text: msg }], isError: true };
}
function ok(msg: string) {
	return { content: [{ type: 'text' as const, text: msg }] };
}

const personRefSchema = z.union([z.number().int(), z.string()]);
const timeSchema = z.union([
	z.string(),
	z.object({ kind: z.string().optional(), date: z.string().optional(), text: z.string().optional() })
]);

async function resolvePersonId(oid: number, ref: number | string): Promise<number | null> {
	if (typeof ref === 'number') {
		const p = await db.person.findFirst({ where: { id: ref, ownerId: oid } });
		return p?.id ?? null;
	}
	const p = await db.person.findFirst({ where: { ownerId: oid, name: ref } });
	if (p) return p.id;
	const alias = await db.personAlias.findFirst({ where: { alias: ref, person: { ownerId: oid } } });
	return alias?.personId ?? null;
}

function periodSummary(pr: {
	relationshipType: { name: string };
	validFromKind: string;
	validFrom: Date | null;
	validFromText: string | null;
	validToKind: string | null;
	validTo: Date | null;
	validToText: string | null;
}): string {
	const from = pr.validFromText ?? (pr.validFrom ? pr.validFrom.toISOString().slice(0, 10) : '?');
	const to = pr.validTo == null ? 'offen' : (pr.validToText ?? (pr.validTo ? pr.validTo.toISOString().slice(0, 10) : '?'));
	return `${pr.relationshipType.name} (${from} → ${to})`;
}

/**
 * Registriert alle RelaTable-MCP-Tools auf dem übergebenen Server.
 * Getrennt von buildMcpServer, damit Tests die Tool-Liste ohne DB prüfen können.
 */
export function registerMcpTools(server: McpServer): void {
	// --- READ ---

	server.registerTool(
		'search_persons',
		{
			description:
				'Sucht Personen im Netzwerk des Owners (case-insensitive Teilstring auf Name, Alias, Stadt oder Notiz). Leerer query → alle Personen. Nutze dies, um erwähnte Namen (z. B. "Conny", "Louis") auf existierende Personen abzubilden, bevor du entscheidest, ob neu angelegt oder ergänzt wird.',
			inputSchema: { query: z.string().default(''), limit: z.number().int().min(1).max(100).default(20) }
		},
		async ({ query, limit }) => {
			const hits = await searchPersons(db, await ownerId(), query ?? '', limit);
			const body = hits
				.map((p) =>
					text(p.name, {
						id: p.id,
						alias: p.aliases.join(', ') || '—',
						stadt: p.city ?? '—',
						geboren: p.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : '—',
						geschlecht: p.gender ?? '—',
						notizen: p.notes ?? ''
					})
				)
				.join('\n---\n');
			return { content: [{ type: 'text' as const, text: `${hits.length} Treffer:\n${body || '(keine)'}` }] };
		}
	);

	server.registerTool(
		'get_person',
		{
			description:
				'Liefert Details zu einer Person (id oder exakter Name/Alias) plus ihrer Verbindungen (mit connectionId, aktuellem Beziehungstyp und Zeitraum-Historie) und Ereignissen. Nutze dies zum Ergänzen nachträglicher Infos (Geburtstag, Notiz) und um connectionId/Paar-Daten für start_relationship/end_relationship/add_journal zu holen.',
			inputSchema: {
				id: z.number().int().optional(),
				name: z.string().optional()
			}
		},
		async ({ id, name }) => {
			if (id == null && !name) return err('id oder name erforderlich.');
			const p = await db.person.findFirst({
				where: id != null ? { id } : { name: name as string },
				include: {
					location: true,
					aliases: true,
					socialAccounts: true,
					connectionsLow: { include: { periods: { include: { relationshipType: true } }, personHigh: { select: { id: true, name: true } } } },
					connectionsHigh: { include: { periods: { include: { relationshipType: true } }, personLow: { select: { id: true, name: true } } } },
					eventParticipations: { include: { event: { include: { eventType: true, location: true } } } }
				}
			});
			const aliasHit =
				p ??
				(name
					? await db.person.findFirst({
							where: { aliases: { some: { alias: name as string } } },
							include: {
								location: true,
								aliases: true,
								socialAccounts: true,
								connectionsLow: { include: { periods: { include: { relationshipType: true } }, personHigh: { select: { id: true, name: true } } } },
								connectionsHigh: { include: { periods: { include: { relationshipType: true } }, personLow: { select: { id: true, name: true } } } },
								eventParticipations: { include: { event: { include: { eventType: true, location: true } } } }
							}
					  })
					: null);
			if (!aliasHit) return err('Person nicht gefunden.');

			const conns = [
				...aliasHit.connectionsLow.map((c) => ({ connId: c.id, other: c.personHigh, periods: c.periods })),
				...aliasHit.connectionsHigh.map((c) => ({ connId: c.id, other: c.personLow, periods: c.periods }))
			];
			const connText = conns
				.map((c) => {
					const active = c.periods.filter((pr) => pr.validTo == null);
					const types = active.map((pr) => pr.relationshipType.name).join(', ') || '—';
					const history = c.periods.map(periodSummary).join('; ');
					return text(c.other.name, { id: c.other.id, connectionId: c.connId, aktuell: types, historie: history });
				})
				.join('\n---\n');
			const evText = aliasHit.eventParticipations
				.map((ep) => ep.event)
				.map((e) => text(e.name, { id: e.id, typ: e.eventType.name, am: e.occurredAtText ?? (e.occurredAt ? e.occurredAt.toISOString().slice(0, 10) : '—'), ort: e.location?.city ?? '—' }))
				.join('\n---\n');
			const body = text(aliasHit.name, {
				id: aliasHit.id,
				alias: aliasHit.aliases.map((entry) => entry.alias).join(', ') || '—',
				gender: aliasHit.gender ?? '—',
				geburtstag: aliasHit.dateOfBirth ? aliasHit.dateOfBirth.toISOString().slice(0, 10) : '—',
				stadt: aliasHit.location?.city ?? '—',
				notizen: aliasHit.notes ?? '',
				social: aliasHit.socialAccounts.map((s) => `${s.platform}:${s.handle}`).join(', ') || '—',
				verbindungen: `\n${connText || '(keine)'}`,
				ereignisse: `\n${evText || '(keine)'}`
			});
			return { content: [{ type: 'text' as const, text: body }] };
		}
	);

	server.registerTool(
		'get_event',
		{
			description:
				'Liefert Details eines Ereignisses (id oder exakter Name) inkl. Typ, Ort, unscharfem Datum, Notiz, aiNotiz und Teilnehmern (id+name). Nutze dies vor update_event, um die aktuelle Belegung zu kennen.',
			inputSchema: { id: z.number().int().optional(), name: z.string().optional() }
		},
		async ({ id, name }) => {
			if (id == null && !name) return err('id oder name erforderlich.');
			const e = await db.event.findFirst({
				where: id != null ? { id } : { name: name as string },
				include: { eventType: true, location: true, participants: { include: { person: { select: { id: true, name: true } } } } }
			});
			if (!e) return err('Ereignis nicht gefunden.');
			const body = text(e.name, {
				id: e.id,
				typ: e.eventType.name,
				am: e.occurredAtText ?? (e.occurredAt ? e.occurredAt.toISOString().slice(0, 10) : '—'),
				ort: e.location?.city ?? '—',
				notiz: e.note ?? '',
				aiNotiz: e.aiNote ?? '',
				teilnehmer: e.participants.map((p) => `${p.person.name} (${p.person.id})`).join(', ') || '—'
			});
			return { content: [{ type: 'text' as const, text: body }] };
		}
	);

	server.registerTool(
		'list_relationship_types',
		{
			description: 'Listet alle Beziehungstypen (mit Kategorie, Rang, aktiv, Nähegrad). Damit du für start_relationship/end_relationship und das Import-JSON nur valide Typnamen verwendest.',
			inputSchema: {}
		},
		async () => {
			const rows = await db.relationshipType.findMany({ include: { category: true }, orderBy: { name: 'asc' } });
			const body = rows.map((t) => text(t.name, { kategorie: t.category.name, rang: t.rank ?? '—', aktiv: t.isActive, nahegrad: t.isClosenessLevel })).join('\n---\n');
			return { content: [{ type: 'text' as const, text: `${rows.length} Beziehungstypen:\n${body}` }] };
		}
	);

	server.registerTool(
		'list_event_types',
		{
			description: 'Listet alle Ereignistypen (mit Sensitivität, aktiv). Damit du für update_event und das Import-JSON nur valide Typnamen verwendest.',
			inputSchema: {}
		},
		async () => {
			const rows = await db.eventType.findMany({ orderBy: { name: 'asc' } });
			const body = rows.map((t) => text(t.name, { sensitiv: t.sensitivity, aktiv: t.isActive })).join('\n---\n');
			return { content: [{ type: 'text' as const, text: `${rows.length} Ereignistypen:\n${body}` }] };
		}
	);

	server.registerTool(
		'get_import_schema',
		{
			description:
				'Liefert die Schema-Referenz für das RelaTable-Import-JSON (persons[], connections[], events[] mit unscharfen Zeitangaben). Lies dies einmal, bevor du preview_import/apply_import aufrufst, damit dein JSON dem Format entspricht.',
			inputSchema: {}
		},
		async () => {
			const md = await readFile(SCHEMA_PATH, 'utf8').catch(() => '(Schema-Datei nicht gefunden: docs/import/json-schema.md)');
			return { content: [{ type: 'text' as const, text: md }] };
		}
	);

	server.registerTool(
		'list_person_interests',
		{
			description:
				'Sucht über alle Personen nach Interessen/Vorlieben (Film|Buch|Serie|Sonstiges) oder Essen/Allergien (Allergie|Unverträglichkeit|Diät). Filter sind case-insensitive Teilstrings, beide optional (leer = alles). Beantwortet Fragen wie "wer mag Film X" oder "wer hat Laktoseintoleranz".',
			inputSchema: {
				category: z.string().optional(),
				title: z.string().optional()
			}
		},
		async ({ category, title }) => {
			const oid = await ownerId();
			const rows = await db.personInterest.findMany({
				where: {
					person: { ownerId: oid },
					...(category ? { category: { contains: category } } : {}),
					...(title ? { title: { contains: title } } : {})
				},
				include: { person: { select: { id: true, name: true } } },
				orderBy: [{ category: 'asc' }, { title: 'asc' }]
			});
			const body = rows
				.map((r) => text(r.person.name, { personId: r.person.id, kategorie: r.category, titel: r.title, notiz: r.note ?? '' }))
				.join('\n---\n');
			return { content: [{ type: 'text' as const, text: `${rows.length} Treffer:\n${body || '(keine)'}` }] };
		}
	);

	server.registerTool(
		'list_person_gift_ideas',
		{
			description: 'Listet Geschenkideen, optional gefiltert nach Person (id) und/oder nur offene (noch nicht gekauft/erledigt).',
			inputSchema: {
				personId: z.number().int().optional(),
				onlyOpen: z.boolean().default(false)
			}
		},
		async ({ personId, onlyOpen }) => {
			const oid = await ownerId();
			const rows = await db.personGiftIdea.findMany({
				where: {
					person: { ownerId: oid },
					...(personId != null ? { personId } : {}),
					...(onlyOpen ? { isFulfilled: false } : {})
				},
				include: { person: { select: { id: true, name: true } } },
				orderBy: { createdAt: 'desc' }
			});
			const body = rows
				.map((r) => text(r.person.name, { personId: r.person.id, titel: r.title, notiz: r.note ?? '', erledigt: r.isFulfilled }))
				.join('\n---\n');
			return { content: [{ type: 'text' as const, text: `${rows.length} Geschenkideen:\n${body || '(keine)'}` }] };
		}
	);

	// --- IMPORT (create-only: persons, connections, events, periods, journal) ---

	server.registerTool(
		'preview_import',
		{
			description:
				'Validiert ein Import-JSON und simuliert den Import (keine Schreibvorgänge). Liefert exakte Zähler (neu/wiederverwendet/übersprungen) und Warnungen. Rufe dies vor apply_import auf, um fehlende/ref-onbekannte Personen oder unbekannte Typen zu erkennen.',
			inputSchema: { payload: z.record(z.unknown()) }
		},
		async ({ payload }) => {
			const oid = await ownerId();
			const r = await runJsonImport(oid, payload, false);
			return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !r.ok };
		}
	);

	server.registerTool(
		'apply_import',
		{
			description:
				'Wendet ein Import-JSON endgültig an (schreibt in die DB, legt ImportBatch an). Personen werden nach Name wiederverwendet, Verbindungen nach Paar; Zeiträume/Journal/Ereignisse werden neu angelegt — also nicht doppelt aufrufen. Vorher preview_import nutzen. Für nachträgliche Aktualisierungen bestehender Datensätze stattdessen update_person/update_event/start_relationship/end_relationship/add_journal verwenden.',
			inputSchema: { payload: z.record(z.unknown()) }
		},
		async ({ payload }) => {
			const oid = await ownerId();
			const r = await runJsonImport(oid, payload, true);
			return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !r.ok };
		}
	);

	// --- UPDATE (patch existing records) ---

	server.registerTool(
		'update_person',
		{
			description:
				'Aktualisiert Felder einer bestehenden Person (id oder aktueller Name zum Finden). Nur angegebene Felder werden überschrieben (Partial-Patch). Nutze dies für nachträgliche Infos wie Geburtstag (yyyy-mm-dd), Geschlecht (Männlich|Weiblich|divers), Stadt, Notiz oder Profilbild-URL (HTTPS). Leerer String löscht das jeweilige Feld.',
			inputSchema: {
				id: z.number().int().optional(),
				name: z.string().optional(),
				newName: z.string().optional(),
				dateOfBirth: z.string().optional(),
				gender: z.string().optional(),
				city: z.string().optional(),
				notes: z.string().optional(),
				profileImageUrl: z.string().optional()
			}
		},
		async ({ id, name, newName, dateOfBirth, gender, city, notes, profileImageUrl }) => {
			if (id == null && !name) return err('id oder name erforderlich.');
			const p = await db.person.findFirst({ where: id != null ? { id } : { name: name as string } });
			if (!p) return err('Person nicht gefunden.');
			const data: Record<string, unknown> = {};
			if (newName !== undefined) data.name = newName;
			if (dateOfBirth !== undefined) {
				if (dateOfBirth === '' ) data.dateOfBirth = null;
				else {
					const d = new Date(dateOfBirth + 'T00:00:00Z');
					if (isNaN(d.getTime())) return err('Ungültiges Geburtsdatum (yyyy-mm-dd erwartet).');
					data.dateOfBirth = d;
				}
			}
			if (gender !== undefined) {
				if (gender === '') data.gender = null;
				else {
					const g = normalizeGender(gender);
					if (!g) return err('Unbekanntes Geschlecht (Männlich|Weiblich|divers).');
					data.gender = g;
				}
			}
			if (city !== undefined) {
				if (city === '') data.locationId = null;
				else data.locationId = await findOrCreateLocation(city);
			}
			if (notes !== undefined) data.notes = notes || null;
			if (profileImageUrl !== undefined) {
				if (profileImageUrl === '') data.profileImageUrl = null;
				else if (/^https:\/\//i.test(profileImageUrl)) data.profileImageUrl = profileImageUrl;
				else return err('Bild-URL muss HTTPS sein.');
			}
			if (Object.keys(data).length === 0) return err('Keine Felder zum Aktualisieren angegeben.');
			await db.person.update({ where: { id: p.id }, data });
			return ok(`Person „${p.name}" (id ${p.id}) aktualisiert (Felder: ${Object.keys(data).join(', ')}).`);
		}
	);

	server.registerTool(
		'update_event',
		{
			description:
				'Aktualisiert ein bestehendes Ereignis (id erforderlich). Angegebene Felder werden überschrieben; nicht angegebene bleiben. Teilnehmer werden per participantIds ODER participantNames referenziert und ersetzen die bisherigen (also immer die vollständige Teilnehmerliste angeben). typeName aus list_event_types. at ist unscharfe Zeit (String oder {kind,date,text}).',
			inputSchema: {
				id: z.number().int(),
				name: z.string().optional(),
				typeName: z.string().optional(),
				at: timeSchema.optional(),
				city: z.string().optional(),
				participantIds: z.array(z.number().int()).optional(),
				participantNames: z.array(z.string()).optional(),
				note: z.string().optional()
			}
		},
		async ({ id, name, typeName, at, city, participantIds, participantNames, note }) => {
			const oid = await ownerId();
			const existing = await db.event.findFirst({
				where: { id, ownerId: oid },
				include: { eventType: true, location: true, participants: true }
			});
			if (!existing) return err('Ereignis nicht gefunden.');

			const finalName = name ?? existing.name;
			const finalTypeName = typeName ?? existing.eventType.name;
			const finalCity = city !== undefined ? city : (existing.location?.city ?? '');
			const finalNote = note !== undefined ? note : (existing.note ?? null);

			let time: ParsedImprecise;
			if (at !== undefined) time = parseTime(at);
			else time = { kind: existing.occurredAtKind as TimeKind, date: existing.occurredAt, text: existing.occurredAtText };

			let ids: number[];
			if (participantIds !== undefined || participantNames !== undefined) {
				const fromNames = await Promise.all((participantNames ?? []).map(async (n) => {
					const p = await db.person.findFirst({ where: { ownerId: oid, name: n } });
					return p?.id ?? null;
				}));
				ids = [...(participantIds ?? []), ...fromNames.filter((x): x is number => x != null)];
			} else {
				ids = existing.participants.map((p) => p.personId);
			}

			const eventType = await db.eventType.findUnique({ where: { name: finalTypeName } });
			if (!eventType) return err(`Ereignistyp „${finalTypeName}" nicht gefunden.`);

			const r = await updateEvent(oid, id, {
				name: finalName,
				eventTypeId: eventType.id,
				time,
				city: finalCity,
				participantIds: ids,
				note: finalNote
			});
			return r.ok ? ok(`Ereignis „${finalName}" aktualisiert.`) : err(r.error ?? 'Update fehlgeschlagen.');
		}
	);

	// --- RELATIONSHIPS (rule-enforced via relationshipService) ---

	server.registerTool(
		'start_relationship',
		{
			description:
				'Startet (oder wechselt zu) einem Beziehungstyp zwischen zwei Personen. Erzeugt die Verbindung falls nötig. Erzwingt die Beziehungsregeln (Nähegrad-Exklusivität, Romantik blockiert/beendet, V-1..V-6) — bei Konflikt wird abgelehnt mit Begründung. typeName aus list_relationship_types. from ist unscharfe Zeit (String wie "2023-08" oder {kind,date,text}).',
			inputSchema: {
				personA: personRefSchema,
				personB: personRefSchema,
				typeName: z.string(),
				from: timeSchema.optional(),
				note: z.string().optional()
			}
		},
		async ({ personA, personB, typeName, from, note }) => {
			const oid = await ownerId();
			const aId = await resolvePersonId(oid, personA);
			const bId = await resolvePersonId(oid, personB);
			if (aId == null || bId == null) return err('Person nicht gefunden.');
			if (aId === bId) return err('Eine Verbindung braucht zwei verschiedene Personen.');
			const normalizedTypeName = normalizeRelationshipTypeName(typeName);
			const type = await db.relationshipType.findUnique({ where: { name: normalizedTypeName } });
			if (!type) return err(`Beziehungstyp „${typeName}" nicht gefunden.`);
			const conn = await getOrCreateConnection(oid, aId, bId);
			if (!conn.ok || conn.connectionId == null) return err(conn.message ?? conn.error ?? 'Verbindung fehlgeschlagen.');
			const r = await startType(oid, conn.connectionId, type.id, parseTime(from), note ?? null);
			return r.ok ? ok(`Beziehung „${normalizedTypeName}" gestartet für Pair ${aId}–${bId}.`) : err(r.message ?? r.error ?? 'Start abgelehnt.');
		}
	);

	server.registerTool(
		'end_relationship',
		{
			description:
				'Beendet den aktiven Zeitraum eines Beziehungstyps zwischen zwei Personen (außer Romantik — dafür end_romance nutzen). typeName muss ein aktuell aktiver Typ auf der Verbindung sein. to ist unscharfe Zeit.',
			inputSchema: {
				personA: personRefSchema,
				personB: personRefSchema,
				typeName: z.string(),
				to: timeSchema.optional()
			}
		},
		async ({ personA, personB, typeName, to }) => {
			const oid = await ownerId();
			const aId = await resolvePersonId(oid, personA);
			const bId = await resolvePersonId(oid, personB);
			if (aId == null || bId == null) return err('Person nicht gefunden.');
			if (aId === bId) return err('Eine Verbindung braucht zwei verschiedene Personen.');
			const normalizedTypeName = normalizeRelationshipTypeName(typeName);
			const type = await db.relationshipType.findUnique({ where: { name: normalizedTypeName } });
			if (!type) return err(`Beziehungstyp „${typeName}" nicht gefunden.`);
			const { low, high } = canonicalPair(aId, bId);
			const conn = await db.connection.findUnique({
				where: { ownerId_personLowId_personHighId: { ownerId: oid, personLowId: low, personHighId: high } }
			});
			if (!conn) return err('Keine Verbindung zwischen diesen Personen.');
			const active = await db.connectionRelationshipPeriod.findFirst({
				where: { connectionId: conn.id, relationshipTypeId: type.id, validTo: null }
			});
			if (!active) return err(`Kein aktiver Zeitraum für „${typeName}" auf dieser Verbindung.`);
			const r = await endPeriod(oid, active.id, parseTime(to));
			return r.ok ? ok(`Beziehung „${normalizedTypeName}" beendet für Pair ${aId}–${bId}.`) : err(r.message ?? r.error ?? 'Beenden fehlgeschlagen.');
		}
	);

	server.registerTool(
		'end_romance',
		{
			description:
				'Beendet eine aktive Romantik zwischen zwei Personen mit dem zwingenden Folge-Status-Dialog (V-5, DEC-009). WICHTIG: Du MUSST den User vor dem Aufruf fragen, welcher Folge-Nähegrad gelten soll und ob Ex-Partner/in aktiviert werden soll. Rufe das Tool erst auf, wenn der User geantwortet hat. Folge-Nähegrad aus list_relationship_types (nur isClosenessLevel=true), oder leerer String für „keinen". activateEx=true aktiviert zusätzlich den Typ „Ex-Partner/in". to ist das Enddatum (unscharf). Gibt zurück, was gestartet/beendet wurde.',
			inputSchema: {
				personA: personRefSchema,
				personB: personRefSchema,
				to: timeSchema.optional(),
				followClosenessTypeName: z.string().describe('Folge-Nähegrad (leerer String = keiner). Muss isClosenessLevel=true aus list_relationship_types sein.'),
				activateEx: z.boolean().describe('Ob Ex-Partner/in als aktiver Typ gesetzt werden soll.')
			}
		},
		async ({ personA, personB, to, followClosenessTypeName, activateEx }) => {
			const oid = await ownerId();
			const aId = await resolvePersonId(oid, personA);
			const bId = await resolvePersonId(oid, personB);
			if (aId == null || bId == null) return err('Person nicht gefunden.');
			if (aId === bId) return err('Eine Verbindung braucht zwei verschiedene Personen.');
			const { low, high } = canonicalPair(aId, bId);
			const conn = await db.connection.findUnique({
				where: { ownerId_personLowId_personHighId: { ownerId: oid, personLowId: low, personHighId: high } }
			});
			if (!conn) return err('Keine Verbindung zwischen diesen Personen.');

			let followTypeId: number | null = null;
			if (followClosenessTypeName.trim()) {
				const normalizedFollowTypeName = normalizeRelationshipTypeName(followClosenessTypeName);
				const t = await db.relationshipType.findUnique({ where: { name: normalizedFollowTypeName } });
				if (!t) return err(`Folge-Typ „${followClosenessTypeName}" nicht gefunden.`);
				if (!t.isClosenessLevel) return err(`„${normalizedFollowTypeName}" ist kein Nähegrad (isClosenessLevel=false).`);
				followTypeId = t.id;
			}

			const r = await endRomance(oid, conn.id, parseTime(to), followTypeId, activateEx);
			if (!r.ok) return err(r.message ?? r.error ?? 'Romantik-Beendigung fehlgeschlagen.');
			const parts = ['Romantik beendet'];
			if (followTypeId) parts.push(`Folge-Nähegrad gesetzt`);
			if (activateEx) parts.push('Ex-Partner/in aktiviert');
			return ok(`${parts.join(', ')} für Pair ${aId}–${bId}.`);
		}
	);

	server.registerTool(
		'add_journal',
		{
			description:
				'Fügt einen Tagebuch-Eintrag zur Verbindung zweier Personen hinzu. Erzeugt die Verbindung falls nötig. title Pflicht, at unscharfe Zeit, note optional. Nutze dies für Notizen über ein Treffen, Gespräch etc., die an der Beziehung hängen sollen.',
			inputSchema: {
				personA: personRefSchema,
				personB: personRefSchema,
				title: z.string(),
				at: timeSchema.optional(),
				note: z.string().optional()
			}
		},
		async ({ personA, personB, title, at, note }) => {
			const oid = await ownerId();
			const aId = await resolvePersonId(oid, personA);
			const bId = await resolvePersonId(oid, personB);
			if (aId == null || bId == null) return err('Person nicht gefunden.');
			if (aId === bId) return err('Eine Verbindung braucht zwei verschiedene Personen.');
			const conn = await getOrCreateConnection(oid, aId, bId);
			if (!conn.ok || conn.connectionId == null) return err(conn.message ?? conn.error ?? 'Verbindung fehlgeschlagen.');
			const r = await addJournal(oid, conn.connectionId, parseTime(at), title, note ?? null);
			return r.ok ? ok(`Journal-Eintrag „${title}" hinzugefügt für Pair ${aId}–${bId}.`) : err(r.message ?? r.error ?? 'Journal fehlgeschlagen.');
		}
	);
}

export const MCP_TOOL_NAMES = [
	'search_persons',
	'get_person',
	'get_event',
	'list_relationship_types',
	'list_event_types',
	'get_import_schema',
	'preview_import',
	'apply_import',
	'update_person',
	'update_event',
	'start_relationship',
	'end_relationship',
	'end_romance',
	'add_journal'
] as const;

export function buildMcpServer(): McpServer {
	const server = new McpServer({ name: 'relatable', version: '1.0.0' });
	registerMcpTools(server);
	return server;
}

// --- Bearer-Token-Guard ---

function tokensEqual(a: string, b: string): boolean {
	const ba = Buffer.from(a);
	const bb = Buffer.from(b);
	// ponytail: length-Check vor timingSafeEqual (wirft bei ungleicher Länge).
	if (ba.length !== bb.length) return false;
	return timingSafeEqual(ba, bb);
}

function jsonRpcError(status: number, message: string): Response {
	return new Response(
		JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message }, id: null }),
		{ status, headers: { 'content-type': 'application/json' } }
	);
}

/**
 * Prüft den Bearer-Token. Fail-closed: fehlt RELATABLE_MCP_TOKEN → 503 (Server
 * falsch konfiguriert), falscher/fehlender Token → 401. Gibt null zurück, wenn
 * der Guard passiert wurde — dann soll der Request ans MCP weitergereicht werden.
 */
export function checkBearer(request: Request): Response | null {
	const expected = process.env.RELATABLE_MCP_TOKEN;
	if (!expected) return jsonRpcError(503, 'MCP deaktiviert: RELATABLE_MCP_TOKEN nicht gesetzt.');
	const auth = request.headers.get('authorization') ?? '';
	const got = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
	if (!got || !tokensEqual(got, expected)) return jsonRpcError(401, 'Unauthorized: Bearer-Token fehlt oder ungültig.');
	return null;
}

/**
 * Zustandsloser Streamable-HTTP-Einstiegspunkt. Pro Request: neuer Server +
 * neuer Transport (sessionIdGenerator: undefined, enableJsonResponse: true).
 * JSON-Antworten statt SSE-Streaming. Bearer-Token-Guard davor (v2).
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
	const guard = checkBearer(request);
	if (guard) return guard;
	const server = buildMcpServer();
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);
	return transport.handleRequest(request);
}
