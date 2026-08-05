import { PrismaClient, type Prisma } from '@prisma/client';

type DbLike = PrismaClient | Prisma.TransactionClient;

export interface PersonSearchHit {
	id: number;
	name: string;
	gender: string | null;
	dateOfBirth: Date | null;
	notes: string | null;
	city: string | null;
	aliases: string[];
}

function normalizeName(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function bigrams(value: string): string[] {
	if (value.length < 2) return value ? [value] : [];
	const grams: string[] = [];
	for (let i = 0; i < value.length - 1; i += 1) grams.push(value.slice(i, i + 2));
	return grams;
}

function diceCoefficient(a: string, b: string): number {
	const aGrams = bigrams(a);
	const bGrams = bigrams(b);
	if (!aGrams.length || !bGrams.length) return 0;
	const counts = new Map<string, number>();
	for (const gram of aGrams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
	let overlap = 0;
	for (const gram of bGrams) {
		const left = counts.get(gram) ?? 0;
		if (left > 0) {
			overlap += 1;
			counts.set(gram, left - 1);
		}
	}
	return (2 * overlap) / (aGrams.length + bGrams.length);
}

export function nameSimilarity(a: string, b: string): number {
	const na = normalizeName(a);
	const nb = normalizeName(b);
	if (!na || !nb) return 0;
	if (na === nb) return 1;
	if (na.includes(nb) || nb.includes(na)) return 0.9;

	const aParts = na.split(' ');
	const bParts = nb.split(' ');
	const firstA = aParts[0] ?? na;
	const firstB = bParts[0] ?? nb;
	const lastA = aParts.at(-1) ?? na;
	const lastB = bParts.at(-1) ?? nb;
	const firstScore = diceCoefficient(firstA, firstB);
	const lastScore = diceCoefficient(lastA, lastB);
	const fullScore = diceCoefficient(na, nb);
	const prefixScore =
		firstA.startsWith(firstB) || firstB.startsWith(firstA) || lastA.startsWith(lastB) || lastB.startsWith(lastA)
			? 0.82
			: 0;

	return Math.max(fullScore, prefixScore, (firstScore * 0.7 + lastScore * 0.3));
}

export async function searchPersons(client: DbLike, ownerId: number, query: string, limit = 20): Promise<PersonSearchHit[]> {
	const all = await client.person.findMany({
		where: { ownerId },
		select: {
			id: true,
			name: true,
			gender: true,
			dateOfBirth: true,
			notes: true,
			location: { select: { city: true } },
			aliases: { select: { alias: true }, orderBy: { alias: 'asc' } }
		},
		orderBy: { name: 'asc' }
	});

	const q = normalizeName(query);
	const hits = (q
		? all.filter((person) => {
				const haystacks = [
					person.name,
					person.location?.city ?? '',
					person.notes ?? '',
					...person.aliases.map((entry) => entry.alias)
				];
				return haystacks.some((part) => normalizeName(part).includes(q));
			})
		: all
	).slice(0, limit);

	return hits.map((person) => ({
		id: person.id,
		name: person.name,
		gender: person.gender,
		dateOfBirth: person.dateOfBirth,
		notes: person.notes,
		city: person.location?.city ?? null,
		aliases: person.aliases.map((entry) => entry.alias)
	}));
}

export async function findMergeCandidates(client: DbLike, ownerId: number, personId: number, limit = 8) {
	const persons = await client.person.findMany({
		where: { ownerId, NOT: { id: personId } },
		select: { id: true, name: true, aliases: { select: { alias: true } } },
		orderBy: { name: 'asc' }
	});
	const source = await client.person.findFirst({
		where: { ownerId, id: personId },
		select: { name: true, aliases: { select: { alias: true } } }
	});
	if (!source) return [];

	const sourceTerms = [source.name, ...source.aliases.map((entry) => entry.alias)];
	return persons
		.map((candidate) => {
			const candidateTerms = [candidate.name, ...candidate.aliases.map((entry) => entry.alias)];
			const score = Math.max(
				...sourceTerms.flatMap((left) => candidateTerms.map((right) => nameSimilarity(left, right)))
			);
			return {
				id: candidate.id,
				name: candidate.name,
				aliases: candidate.aliases.map((entry) => entry.alias),
				score
			};
		})
		.filter((candidate) => candidate.score >= 0.34)
		.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
		.slice(0, limit);
}

function mergeNotes(targetNotes: string | null, sourceNotes: string | null, extraNotes: string[]) {
	const blocks = [targetNotes?.trim(), sourceNotes?.trim(), ...extraNotes.map((note) => note.trim())].filter(Boolean);
	return blocks.length ? [...new Set(blocks)].join('\n\n') : null;
}

function formatConnectionSummary(
	name: string,
	periods: { relationshipType: { name: string }; validFromText: string | null; validToText: string | null }[],
	journal: { title: string; note: string | null }[]
) {
	const parts: string[] = [`Zusammengefuehrte Direktverbindung mit ${name}:`];
	if (periods.length) {
		parts.push(
			`Beziehungen: ${periods
				.map((period) => `${period.relationshipType.name}${period.validFromText ? ` ab ${period.validFromText}` : ''}${period.validToText ? ` bis ${period.validToText}` : ''}`)
				.join('; ')}`
		);
	}
	if (journal.length) {
		parts.push(`Journal: ${journal.map((entry) => `${entry.title}${entry.note ? ` (${entry.note})` : ''}`).join('; ')}`);
	}
	return parts.join('\n');
}

export async function mergePersons(client: PrismaClient, ownerId: number, targetId: number, sourceId: number) {
	if (targetId === sourceId) throw new Error('Person kann nicht mit sich selbst zusammengeführt werden.');

	return client.$transaction(async (tx) => {
		const [target, source] = await Promise.all([
			tx.person.findFirst({
				where: { id: targetId, ownerId },
				include: { aliases: true, socialAccounts: true }
			}),
			tx.person.findFirst({
				where: { id: sourceId, ownerId },
				include: { aliases: true, socialAccounts: true }
			})
		]);
		if (!target || !source) throw new Error('Eine der Personen wurde nicht gefunden.');

		const extraNotes: string[] = [];
		const sourceConnections = await tx.connection.findMany({
			where: { ownerId, OR: [{ personLowId: sourceId }, { personHighId: sourceId }] },
			include: {
				periods: true,
				journal: true,
				changeLog: true,
				personLow: { select: { id: true, name: true } },
				personHigh: { select: { id: true, name: true } }
			}
		});

		for (const connection of sourceConnections) {
			const other = connection.personLowId === sourceId ? connection.personHigh : connection.personLow;
			if (other.id === targetId) {
				const periodsWithType = await tx.connectionRelationshipPeriod.findMany({
					where: { connectionId: connection.id },
					include: { relationshipType: true }
				});
				extraNotes.push(formatConnectionSummary(source.name, periodsWithType, connection.journal));
				await tx.connection.delete({ where: { id: connection.id } });
				continue;
			}

			const low = Math.min(targetId, other.id);
			const high = Math.max(targetId, other.id);
			let targetConnection = await tx.connection.findFirst({
				where: { ownerId, personLowId: low, personHighId: high }
			});
			if (!targetConnection) {
				targetConnection = await tx.connection.create({
					data: { ownerId, personLowId: low, personHighId: high }
				});
			}

			for (const period of connection.periods) {
				await tx.connectionRelationshipPeriod.create({
					data: {
						connectionId: targetConnection.id,
						relationshipTypeId: period.relationshipTypeId,
						validFromKind: period.validFromKind,
						validFrom: period.validFrom,
						validFromText: period.validFromText,
						validToKind: period.validToKind,
						validTo: period.validTo,
						validToText: period.validToText,
						note: period.note
					}
				});
			}
			for (const entry of connection.journal) {
				await tx.connectionJournalEntry.create({
					data: {
						connectionId: targetConnection.id,
						occurredAtKind: entry.occurredAtKind,
						occurredAt: entry.occurredAt,
						occurredAtText: entry.occurredAtText,
						title: entry.title,
						note: entry.note
					}
				});
			}
			for (const change of connection.changeLog) {
				await tx.relationshipChangeLog.create({
					data: {
						connectionId: targetConnection.id,
						action: change.action,
						relationshipTypeId: change.relationshipTypeId,
						changedAt: change.changedAt,
						detail: change.detail
					}
				});
			}
			await tx.connection.delete({ where: { id: connection.id } });
		}

		const sourceParticipations = await tx.eventParticipant.findMany({
			where: { personId: sourceId }
		});
		for (const participation of sourceParticipations) {
			const duplicate = await tx.eventParticipant.findFirst({
				where: { eventId: participation.eventId, personId: targetId }
			});
			if (duplicate) {
				if (!duplicate.role && participation.role) {
					await tx.eventParticipant.update({
						where: { id: duplicate.id },
						data: { role: participation.role }
					});
				}
				await tx.eventParticipant.delete({ where: { id: participation.id } });
			} else {
				await tx.eventParticipant.update({
					where: { id: participation.id },
					data: { personId: targetId }
				});
			}
		}

		for (const account of source.socialAccounts) {
			const duplicate = target.socialAccounts.find(
				(existing) => existing.platform === account.platform && existing.handle === account.handle
			);
			if (duplicate) {
				if (!duplicate.url && account.url) {
					await tx.socialAccount.update({
						where: { id: duplicate.id },
						data: { url: account.url }
					});
				}
			} else {
				await tx.socialAccount.update({
					where: { id: account.id },
					data: { personId: targetId }
				});
			}
		}

		const mergedAliases = [...new Set([
			...target.aliases.map((entry) => entry.alias),
			...source.aliases.map((entry) => entry.alias),
			source.name
		].filter((alias) => alias.trim().toLowerCase() !== target.name.trim().toLowerCase()))];

		await tx.person.update({
			where: { id: targetId },
			data: {
				dateOfBirth: target.dateOfBirth ?? source.dateOfBirth,
				gender: target.gender ?? source.gender,
				orientation: target.orientation !== 'unbekannt' ? target.orientation : source.orientation,
				locationId: target.locationId ?? source.locationId,
				profileImagePath: target.profileImagePath ?? source.profileImagePath,
				profileImageUrl: target.profileImageUrl ?? source.profileImageUrl,
				notes: mergeNotes(target.notes, source.notes, extraNotes),
				aliases: {
					deleteMany: {},
					create: mergedAliases.map((alias) => ({ alias }))
				}
			}
		});

		await tx.person.delete({ where: { id: sourceId } });
		return { targetId, sourceId, mergedAliases };
	});
}
