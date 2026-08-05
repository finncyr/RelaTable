import type { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

// Reusable seed logic (no side effects on import) shared by `npm run db:seed`
// and the E2E reset. All functions are idempotent where practical.

const CATEGORIES = [
	{ name: 'Naehegrad', sortOrder: 1 },
	{ name: 'Status', sortOrder: 2 },
	{ name: 'Romantik', sortOrder: 3 },
	{ name: 'Kontext', sortOrder: 4 },
	{ name: 'Familie', sortOrder: 5 }
];

// Rollen sind eindeutig gegendert; man wählt nur die eigene Rolle, die Gegenrolle
// der anderen Person wird automatisch aus deren Geschlecht abgeleitet
// (FAMILY_INVERSE in domain/relationships.ts). Die "/"-Varianten sind der
// geschlechtsneutrale Fallback für divers/unbekannt (z. B. Mutter -> Kind).
const FAMILY_ROLES = [
	'Mutter', 'Vater', 'Elternteil', 'Tochter', 'Sohn', 'Kind',
	'Schwester', 'Bruder', 'Geschwister',
	'Großmutter', 'Großvater', 'Großelternteil', 'Enkelin', 'Enkel', 'Enkelkind',
	'Tante', 'Onkel', 'Onkel/Tante', 'Nichte', 'Neffe', 'Neffe/Nichte',
	'Cousine', 'Cousin', 'Cousin/Cousine'
];

const TYPES = [
	{ name: 'Bekanntschaft', cat: 'Naehegrad', rank: 1, closeness: true, color: '#888888' },
	{ name: 'Freundschaft', cat: 'Naehegrad', rank: 2, closeness: true, color: '#33aa77' },
	{ name: 'Enge Freundschaft', cat: 'Naehegrad', rank: 3, closeness: true, color: '#4466aa' },
	{ name: 'Freundschaft Plus', cat: 'Status', rank: null, closeness: false, color: '#9a6fb0' },
	{ name: 'Romantik', cat: 'Romantik', rank: null, closeness: false, color: '#cc8844' },
	{ name: 'Ex-Partner/in', cat: 'Status', rank: null, closeness: false, color: '#b06a6a' },
	{ name: 'Arbeits-Kollegen', cat: 'Kontext', rank: null, closeness: false, color: '#8b5cf6' },
	...FAMILY_ROLES.map((name) => ({ name, cat: 'Familie', rank: null, closeness: false, color: '#c9a227' }))
];

const EVENT_TYPES = [
	{ name: 'Urlaub', sensitivity: 'normal' },
	{ name: 'Party', sensitivity: 'normal' },
	{ name: 'Konzert/Festival', sensitivity: 'normal' },
	{ name: 'Convention', sensitivity: 'normal' },
	{ name: 'Generisch', sensitivity: 'normal' },
	{ name: 'Sex', sensitivity: 'sensitive' }
];

export const DEMO_PASSWORD = 'Demo-Passwort-12345!';

export async function seedReference(db: PrismaClient) {
	for (const c of CATEGORIES) {
		await db.relationshipCategory.upsert({ where: { name: c.name }, update: c, create: c });
	}
	const cats = await db.relationshipCategory.findMany();
	const catId = (n: string) => cats.find((c) => c.name === n)!.id;

	for (const t of TYPES) {
		const data = {
			categoryId: catId(t.cat),
			name: t.name,
			rank: t.rank,
			isContinuous: true,
			isClosenessLevel: t.closeness,
			isActive: true,
			color: t.color
		};
		await db.relationshipType.upsert({ where: { name: t.name }, update: data, create: data });
	}

	for (const e of EVENT_TYPES) {
		await db.eventType.upsert({
			where: { name: e.name },
			update: { sensitivity: e.sensitivity },
			create: { name: e.name, sensitivity: e.sensitivity, isActive: true }
		});
	}

	const types = await db.relationshipType.findMany();
	const tId = (n: string) => types.find((t) => t.name === n)!.id;
	const romance = tId('Romantik');
	for (const target of ['Bekanntschaft', 'Freundschaft', 'Enge Freundschaft', 'Freundschaft Plus']) {
		for (const effect of ['ends', 'blocks']) {
			await db.relationshipExclusionRule.upsert({
				where: { sourceTypeId_targetTypeId_effect: { sourceTypeId: romance, targetTypeId: tId(target), effect } },
				update: {},
				create: { sourceTypeId: romance, targetTypeId: tId(target), effect }
			});
		}
	}
}

export async function ensureDemoOwner(db: PrismaClient): Promise<number> {
	const existing = await db.appUser.findFirst();
	if (existing) return existing.id;
	const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
	const owner = await db.appUser.create({ data: { displayName: 'Demo', passwordHash, themePreference: 'System' } });
	return owner.id;
}

export async function seedDemo(db: PrismaClient, ownerId: number) {
	if ((await db.person.count()) > 0) return;

	const loc = (displayName: string, city: string, lat: number, lng: number) =>
		db.location.create({ data: { displayName, city, country: 'Deutschland', latitude: lat, longitude: lng, precision: 'city' } });

	const berlin = await loc('Berlin', 'Berlin', 52.52, 13.405);
	const leipzig = await loc('Leipzig', 'Leipzig', 51.3397, 12.3731);
	const hamburg = await loc('Hamburg', 'Hamburg', 53.5511, 9.9937);
	const muenchen = await loc('München', 'München', 48.1351, 11.582);

	const person = (name: string, opts: Partial<{ dob: Date; gender: string; locationId: number }> = {}) =>
		db.person.create({ data: { ownerId, name, dateOfBirth: opts.dob ?? null, gender: opts.gender ?? null, locationId: opts.locationId ?? null } });

	const mara = await person('Mara Vogt', { dob: new Date(Date.UTC(1995, 2, 10)), gender: 'Weiblich', locationId: berlin.id });
	const jonas = await person('Jonas Reich', { dob: new Date(Date.UTC(1992, 7, 2)), gender: 'Männlich', locationId: leipzig.id });
	const aylin = await person('Aylin Kaya', { dob: new Date(Date.UTC(1996, 10, 22)), gender: 'Weiblich', locationId: hamburg.id });
	const sven = await person('Sven Brandt', { gender: 'Männlich', locationId: muenchen.id });
	const lia = await person('Lia Sommer', { gender: 'divers', locationId: berlin.id });
	await person('Isolde Stein');

	await db.socialAccount.create({ data: { personId: mara.id, platform: 'Instagram', handle: '@mara.v', url: 'https://instagram.com/mara.v' } });

	const types = await db.relationshipType.findMany();
	const tId = (n: string) => types.find((t) => t.name === n)!.id;

	const connect = async (a: number, b: number, periods: { type: string; from: Date | null; fromText?: string; fromKind?: string; to?: Date | null }[]) => {
		const conn = await db.connection.create({ data: { ownerId, personLowId: Math.min(a, b), personHighId: Math.max(a, b) } });
		for (const p of periods) {
			await db.connectionRelationshipPeriod.create({
				data: {
					connectionId: conn.id,
					relationshipTypeId: tId(p.type),
					validFromKind: p.fromKind ?? 'month',
					validFrom: p.from,
					validFromText: p.fromText ?? null,
					validTo: p.to ?? null,
					validToKind: p.to ? 'month' : null
				}
			});
		}
		return conn;
	};

	await connect(mara.id, aylin.id, [
		{ type: 'Bekanntschaft', from: null, fromText: 'Sommer 2022', fromKind: 'season', to: new Date(Date.UTC(2022, 5, 1)) },
		{ type: 'Freundschaft', from: new Date(Date.UTC(2022, 5, 1)), to: new Date(Date.UTC(2023, 5, 1)) },
		{ type: 'Enge Freundschaft', from: new Date(Date.UTC(2023, 5, 1)), to: null }
	]);
	await connect(mara.id, jonas.id, [{ type: 'Romantik', from: new Date(Date.UTC(2023, 3, 15)), to: null }]);
	await connect(aylin.id, sven.id, [{ type: 'Bekanntschaft', from: new Date(Date.UTC(2021, 0, 1)), to: null }]);
	await connect(sven.id, lia.id, [{ type: 'Freundschaft', from: new Date(Date.UTC(2020, 8, 1)), to: null }]);
	await connect(mara.id, lia.id, [{ type: 'Freundschaft', from: new Date(Date.UTC(2021, 2, 1)), to: null }]);

	const eventTypes = await db.eventType.findMany();
	const evtId = (n: string) => eventTypes.find((t) => t.name === n)!.id;
	const makeEvent = async (name: string, typeName: string, when: { kind: string; date: Date | null }, locationId: number | null, ids: number[]) => {
		const ev = await db.event.create({ data: { ownerId, name, eventTypeId: evtId(typeName), occurredAtKind: when.kind, occurredAt: when.date, locationId } });
		for (const pid of ids) await db.eventParticipant.create({ data: { eventId: ev.id, personId: pid } });
	};
	await makeEvent('Festival Wacken', 'Konzert/Festival', { kind: 'month', date: new Date(Date.UTC(2023, 7, 1)) }, hamburg.id, [mara.id, aylin.id, sven.id, lia.id]);
	await makeEvent('Wochenendtrip', 'Urlaub', { kind: 'month', date: new Date(Date.UTC(2023, 4, 1)) }, muenchen.id, [mara.id, aylin.id]);
	await makeEvent('Intimer Abend', 'Sex', { kind: 'day', date: new Date(Date.UTC(2023, 9, 12)) }, berlin.id, [mara.id, jonas.id]);

	const conn = await db.connection.findFirst({ where: { personLowId: Math.min(mara.id, aylin.id), personHighId: Math.max(mara.id, aylin.id) } });
	if (conn) {
		await db.connectionJournalEntry.create({ data: { connectionId: conn.id, occurredAtKind: 'month', occurredAt: new Date(Date.UTC(2023, 2, 1)), title: 'Tiefes Gespräch' } });
	}
}

/** Delete all rows in FK-safe order (data only; schema stays). Used by the E2E reset. */
export async function clearAll(db: PrismaClient) {
	await db.externalImportMap.deleteMany();
	await db.importBatch.deleteMany();
	await db.relationshipChangeLog.deleteMany();
	await db.connectionJournalEntry.deleteMany();
	await db.connectionRelationshipPeriod.deleteMany();
	await db.eventParticipant.deleteMany();
	await db.event.deleteMany();
	await db.socialAccount.deleteMany();
	await db.connection.deleteMany();
	await db.person.deleteMany();
	await db.relationshipExclusionRule.deleteMany();
	await db.relationshipType.deleteMany();
	await db.relationshipCategory.deleteMany();
	await db.eventType.deleteMany();
	await db.location.deleteMany();
	await db.appSetting.deleteMany();
	await db.session.deleteMany();
	await db.appUser.deleteMany();
	// Reset AUTOINCREMENT counters so reseeds produce deterministic ids (test stability).
	await db.$executeRawUnsafe('DELETE FROM sqlite_sequence').catch(() => {});
}
