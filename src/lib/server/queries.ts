import { db } from './db';
import {
	currentTypeName,
	colorForType,
	closenessSortKey,
	canonicalPair,
	type RelType,
	type Period
} from '$lib/domain/relationships';

export async function loadRelTypes(): Promise<RelType[]> {
	const rows = await db.relationshipType.findMany({ include: { category: true } });
	return rows.map((t) => ({
		id: t.id,
		name: t.name,
		categoryName: t.category.name,
		rank: t.rank,
		isClosenessLevel: t.isClosenessLevel,
		isContinuous: t.isContinuous,
		color: t.color
	}));
}

function toPeriods(periods: { relationshipTypeId: number; validFrom: Date | null; validTo: Date | null }[]): Period[] {
	return periods.map((p) => ({ relationshipTypeId: p.relationshipTypeId, validFrom: p.validFrom, validTo: p.validTo }));
}

export interface GraphNode {
	id: number;
	name: string;
	aliases: string[];
	image: string | null;
	city: string | null;
	degree: number;
}
export interface GraphEdge {
	id: string;
	source: number;
	target: number;
	typeName: string | null;
	color: string;
}

/** Full graph (SCR-020). Edge color = current dominant type (VAR-04=A). */
export async function loadGraph(ownerId: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
	const [persons, connections, types] = await Promise.all([
		db.person.findMany({ where: { ownerId }, include: { location: true, aliases: { orderBy: { alias: 'asc' } } } }),
		db.connection.findMany({
			where: { ownerId },
			include: { periods: { select: { relationshipTypeId: true, validFrom: true, validTo: true } } }
		}),
		loadRelTypes()
	]);

	const degree = new Map<number, number>();
	const edges: GraphEdge[] = connections.map((c) => {
		degree.set(c.personLowId, (degree.get(c.personLowId) ?? 0) + 1);
		degree.set(c.personHighId, (degree.get(c.personHighId) ?? 0) + 1);
		const typeName = currentTypeName(toPeriods(c.periods), types);
		return {
			id: `e${c.id}`,
			source: c.personLowId,
			target: c.personHighId,
			typeName,
			color: colorForType(typeName)
		};
	});

	const nodes: GraphNode[] = persons.map((p) => ({
		id: p.id,
		name: p.name,
		aliases: p.aliases.map((entry) => entry.alias),
		image: p.profileImagePath ? `/uploads/${p.profileImagePath}` : p.profileImageUrl,
		city: p.location?.city ?? null,
		degree: degree.get(p.id) ?? 0
	}));

	return { nodes, edges };
}

/** Connection degree per person (for the list "N Verbindungen"). */
export async function connectionDegrees(ownerId: number): Promise<Map<number, number>> {
	const connections = await db.connection.findMany({
		where: { ownerId },
		select: { personLowId: true, personHighId: true }
	});
	const degree = new Map<number, number>();
	for (const c of connections) {
		degree.set(c.personLowId, (degree.get(c.personLowId) ?? 0) + 1);
		degree.set(c.personHighId, (degree.get(c.personHighId) ?? 0) + 1);
	}
	return degree;
}

/** Find the canonical connection between two persons, if any. */
export async function findConnection(ownerId: number, a: number, b: number) {
	const { low, high } = canonicalPair(a, b);
	return db.connection.findUnique({
		where: { ownerId_personLowId_personHighId: { ownerId, personLowId: low, personHighId: high } }
	});
}

export { currentTypeName, colorForType, closenessSortKey, toPeriods };
