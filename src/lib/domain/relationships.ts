// Relationship domain service (docs/review-1/07_beziehungsregeln.md).
// Pure + framework-free: no Prisma, no DB. Drives graph edge colors, closeness
// sorting, current-type resolution, and the V-1..V-8 transition validations.
// The guided dialogs (Block 5) are NOT built in V1, but these rules are the
// single source of truth and are unit-tested.

export const CLOSENESS_RANK: Record<string, number> = {
	Bekanntschaft: 1,
	Freundschaft: 2,
	'Enge Freundschaft': 3
};

export const TYPE_COLORS: Record<string, string> = {
	Bekanntschaft: '#888888',
	Freundschaft: '#33aa77',
	'Enge Freundschaft': '#4466aa',
	Romantik: '#cc8844',
	'Freundschaft Plus': '#9a6fb0',
	'Ex-Partner/in': '#b06a6a'
};

// Display priority for "current type" (graph edge color, VAR-04=A) — most
// significant active type wins.
export const TYPE_PRIORITY: Record<string, number> = {
	Romantik: 100,
	'Enge Freundschaft': 80,
	Freundschaft: 70,
	Bekanntschaft: 60,
	'Ex-Partner/in': 50,
	'Freundschaft Plus': 40
};

// Familie: die Gegenrolle wird automatisch aus dem Geschlecht der jeweils
// anderen Person abgeleitet (Onkel <-> Neffe/Nichte/"Neffe/Nichte" bei
// unbekanntem/diversem Geschlecht). "neutral" deckt divers UND fehlende Angabe ab.
export const FAMILY_INVERSE: Record<string, { m: string; f: string; neutral: string }> = {
	Mutter: { m: 'Sohn', f: 'Tochter', neutral: 'Kind' },
	Vater: { m: 'Sohn', f: 'Tochter', neutral: 'Kind' },
	Elternteil: { m: 'Sohn', f: 'Tochter', neutral: 'Kind' },
	Sohn: { m: 'Vater', f: 'Mutter', neutral: 'Elternteil' },
	Tochter: { m: 'Vater', f: 'Mutter', neutral: 'Elternteil' },
	Kind: { m: 'Vater', f: 'Mutter', neutral: 'Elternteil' },
	Bruder: { m: 'Bruder', f: 'Schwester', neutral: 'Geschwister' },
	Schwester: { m: 'Bruder', f: 'Schwester', neutral: 'Geschwister' },
	Geschwister: { m: 'Bruder', f: 'Schwester', neutral: 'Geschwister' },
	Großvater: { m: 'Enkel', f: 'Enkelin', neutral: 'Enkelkind' },
	Großmutter: { m: 'Enkel', f: 'Enkelin', neutral: 'Enkelkind' },
	Großelternteil: { m: 'Enkel', f: 'Enkelin', neutral: 'Enkelkind' },
	Enkel: { m: 'Großvater', f: 'Großmutter', neutral: 'Großelternteil' },
	Enkelin: { m: 'Großvater', f: 'Großmutter', neutral: 'Großelternteil' },
	Enkelkind: { m: 'Großvater', f: 'Großmutter', neutral: 'Großelternteil' },
	Onkel: { m: 'Neffe', f: 'Nichte', neutral: 'Neffe/Nichte' },
	Tante: { m: 'Neffe', f: 'Nichte', neutral: 'Neffe/Nichte' },
	'Onkel/Tante': { m: 'Neffe', f: 'Nichte', neutral: 'Neffe/Nichte' },
	Neffe: { m: 'Onkel', f: 'Tante', neutral: 'Onkel/Tante' },
	Nichte: { m: 'Onkel', f: 'Tante', neutral: 'Onkel/Tante' },
	'Neffe/Nichte': { m: 'Onkel', f: 'Tante', neutral: 'Onkel/Tante' },
	Cousin: { m: 'Cousin', f: 'Cousine', neutral: 'Cousin/Cousine' },
	Cousine: { m: 'Cousin', f: 'Cousine', neutral: 'Cousin/Cousine' },
	'Cousin/Cousine': { m: 'Cousin', f: 'Cousine', neutral: 'Cousin/Cousine' }
};

/** Gegenrolle für die andere Person einer Familienbeziehung (V-9). Divers/fehlend → neutral. */
export function inverseFamilyRoleName(typeName: string, otherGender?: string | null): string | null {
	const entry = FAMILY_INVERSE[typeName];
	if (!entry) return null;
	if (otherGender === 'Männlich') return entry.m;
	if (otherGender === 'Weiblich') return entry.f;
	return entry.neutral;
}

// Familie-Kanten sollen im Graph golden erscheinen, unabhängig von der genauen
// Rolle, und optisch fast so dominant wie Romantik sein.
const FAMILY_GOLD = '#c9a227';
for (const name of Object.keys(FAMILY_INVERSE)) {
	TYPE_COLORS[name] = FAMILY_GOLD;
	TYPE_PRIORITY[name] = 95;
}

const REL_TYPE_ALIASES: Record<string, string> = {
	'gute freunde': 'Enge Freundschaft',
	'guter freund': 'Enge Freundschaft',
	'gute freundin': 'Enge Freundschaft',
	'gute freundschaft': 'Enge Freundschaft',
	'sehr gute freunde': 'Enge Freundschaft',
	'sehr gute freundschaft': 'Enge Freundschaft',
	'enge freunde': 'Enge Freundschaft',
	'enger freund': 'Enge Freundschaft',
	'enge freundin': 'Enge Freundschaft',
	'enge freundschaft': 'Enge Freundschaft',
	'close friends': 'Enge Freundschaft',
	'close friend': 'Enge Freundschaft',
	'best friends': 'Enge Freundschaft',
	'beste freunde': 'Enge Freundschaft',
	'bester freund': 'Enge Freundschaft',
	'beste freundin': 'Enge Freundschaft',
	'bekannte': 'Bekanntschaft',
	'bekannter': 'Bekanntschaft',
	'known acquaintance': 'Bekanntschaft',
	'freund': 'Freundschaft',
	'freundin': 'Freundschaft',
	'freunde': 'Freundschaft',
	'friends': 'Freundschaft',
	'friend': 'Freundschaft'
};

function normalizeRelTypeKey(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9\s/+]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function normalizeRelationshipTypeName(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) return trimmed;
	const canonical = Object.keys(TYPE_PRIORITY).find((name) => normalizeRelTypeKey(name) === normalizeRelTypeKey(trimmed));
	return canonical ?? REL_TYPE_ALIASES[normalizeRelTypeKey(trimmed)] ?? trimmed;
}

export interface RelType {
	id: number;
	name: string;
	categoryName: string; // Naehegrad|Kontext|Romantik|Status
	rank: number | null;
	isClosenessLevel: boolean;
	isContinuous: boolean;
	color?: string | null;
}

export interface Period {
	id?: number;
	relationshipTypeId: number;
	validFrom: Date | null;
	validTo: Date | null; // null = active
	// Which person the type applies to (directional Familie-Rollen only).
	personId?: number | null;
}

export type RuleError =
	| 'E-NG-ROM'
	| 'E-NG-FAM'
	| 'E-NG-DUP'
	| 'E-FP-ROM'
	| 'E-ROM-END-INCOMPLETE'
	| 'E-PERIOD-OVERLAP'
	| 'E-TIME-ORDER';

export interface TransitionResult {
	allowed: boolean;
	error?: RuleError;
	/** Type ids whose active period would be ended as a side effect. */
	ends: number[];
	message?: string;
}

/** Canonical unordered pair: low < high (C-MODEL-1/2). Throws on self-edge. */
export function canonicalPair(a: number, b: number): { low: number; high: number } {
	if (a === b) throw new Error('E-SELF-EDGE: a connection needs two distinct persons');
	return a < b ? { low: a, high: b } : { low: b, high: a };
}

export function activePeriods(periods: Period[]): Period[] {
	return periods.filter((p) => p.validTo === null);
}

function typeById(types: RelType[], id: number): RelType | undefined {
	return types.find((t) => t.id === id);
}

function isRomance(t: RelType | undefined): boolean {
	return !!t && t.name === 'Romantik';
}
function isFriendshipPlus(t: RelType | undefined): boolean {
	return !!t && t.name === 'Freundschaft Plus';
}
function isFamily(t: RelType | undefined): boolean {
	return !!t && t.categoryName === 'Familie';
}

export function hasActiveFamily(periods: Period[], types: RelType[]): boolean {
	return activePeriods(periods).some((p) => isFamily(typeById(types, p.relationshipTypeId)));
}

/** The active closeness period for a connection, if any (at most one — C-MODEL-3). */
export function activeCloseness(periods: Period[], types: RelType[]): Period | null {
	return (
		activePeriods(periods).find((p) => typeById(types, p.relationshipTypeId)?.isClosenessLevel) ?? null
	);
}

export function hasActiveRomance(periods: Period[], types: RelType[]): boolean {
	return activePeriods(periods).some((p) => isRomance(typeById(types, p.relationshipTypeId)));
}

/** The dominant current type name for a connection (graph edge color). */
export function currentTypeName(periods: Period[], types: RelType[]): string | null {
	const actives = activePeriods(periods)
		.map((p) => typeById(types, p.relationshipTypeId)?.name)
		.filter((n): n is string => !!n);
	if (actives.length === 0) return null;
	actives.sort((a, b) => (TYPE_PRIORITY[b] ?? 0) - (TYPE_PRIORITY[a] ?? 0));
	return actives[0];
}

export function colorForType(name: string | null): string {
	if (!name) return '#bbbbbb';
	return TYPE_COLORS[name] ?? '#7a8a99'; // context types fall back to grey-blue
}

/**
 * Sort key for "engste zuerst" on a person profile (SCR-012):
 * Romantik/Ex first, then closeness ladder (Enge → Freundschaft → Bekanntschaft),
 * then the rest. Lower number sorts first.
 */
export function closenessSortKey(periods: Period[], types: RelType[]): number {
	const name = currentTypeName(periods, types);
	if (!name) return 999;
	if (name === 'Romantik') return 0;
	if (name === 'Ex-Partner/in') return 1;
	if (name === 'Enge Freundschaft') return 2;
	if (name === 'Freundschaft') return 3;
	if (name === 'Bekanntschaft') return 4;
	return 10;
}

/** V-7: end-before-start is invalid when both exact dates are known. */
export function validateTimeOrder(from: Date | null, to: Date | null): RuleError | null {
	if (from && to && to.getTime() < from.getTime()) return 'E-TIME-ORDER';
	return null;
}

/**
 * Evaluate starting a relationship type, given the connection's current periods.
 * Returns whether it is allowed and which active periods would be ended (V-1..V-6).
 */
export function evaluateStartType(newTypeId: number, periods: Period[], types: RelType[], personId?: number | null): TransitionResult {
	const newType = typeById(types, newTypeId);
	if (!newType) return { allowed: false, ends: [], message: 'Unbekannter Typ' };
	const romanceActive = hasActiveRomance(periods, types);

	// Closeness level
	if (newType.isClosenessLevel) {
		if (romanceActive) {
			return {
				allowed: false,
				error: 'E-NG-ROM',
				ends: [],
				message: 'Während einer romantischen Beziehung ist kein Nähegrad möglich.'
			};
		}
		if (hasActiveFamily(periods, types)) {
			return {
				allowed: false,
				error: 'E-NG-FAM',
				ends: [],
				message: 'Bei einer Familienbeziehung ist kein zusätzlicher Nähegrad nötig.'
			};
		}
		// Changing closeness ends the previous active closeness (V-2/C-MODEL-4).
		const cur = activeCloseness(periods, types);
		return { allowed: true, ends: cur ? [cur.relationshipTypeId] : [] };
	}

	// Familie — ersetzt den Nähegrad (beendet ihn), läuft sonst parallel/direktional
	// (personId trägt die Rolle: wer ist z. B. die Mutter).
	if (isFamily(newType)) {
		const alreadyActive = activePeriods(periods).some(
			(p) => p.relationshipTypeId === newTypeId && (p.personId ?? null) === (personId ?? null)
		);
		if (alreadyActive) {
			return { allowed: false, error: 'E-PERIOD-OVERLAP', ends: [], message: 'Bereits aktiv.' };
		}
		const cur = activeCloseness(periods, types);
		return { allowed: true, ends: cur ? [cur.relationshipTypeId] : [] };
	}

	// Friendship Plus
	if (isFriendshipPlus(newType)) {
		if (romanceActive) {
			return {
				allowed: false,
				error: 'E-FP-ROM',
				ends: [],
				message: 'Freundschaft Plus ist parallel zu einer Romantik nicht möglich.'
			};
		}
		const alreadyActive = activePeriods(periods).some((p) =>
			isFriendshipPlus(typeById(types, p.relationshipTypeId))
		);
		if (alreadyActive) {
			return { allowed: false, error: 'E-PERIOD-OVERLAP', ends: [], message: 'Bereits aktiv.' };
		}
		return { allowed: true, ends: [] };
	}

	// Romance — ends active closeness + friendship plus (V-4, DEC-008).
	if (isRomance(newType)) {
		if (romanceActive) {
			return { allowed: false, error: 'E-PERIOD-OVERLAP', ends: [], message: 'Bereits aktiv.' };
		}
		const ends = activePeriods(periods)
			.filter((p) => {
				const t = typeById(types, p.relationshipTypeId);
				return !!t && (t.isClosenessLevel || isFriendshipPlus(t));
			})
			.map((p) => p.relationshipTypeId);
		return { allowed: true, ends };
	}

	// Context / status types (Cosplay, Business, Ex…) run in parallel (DEC-023).
	const alreadyActive = activePeriods(periods).some((p) => p.relationshipTypeId === newTypeId);
	if (alreadyActive) {
		return { allowed: false, error: 'E-PERIOD-OVERLAP', ends: [], message: 'Bereits aktiv.' };
	}
	return { allowed: true, ends: [] };
}

export interface EndRomanceInput {
	/** Required follow closeness type id, or null for explicit "kein Nähegrad". `undefined` = no choice made. */
	followClosenessTypeId: number | null | undefined;
	activateExPartner: boolean;
}

/** V-5: romance-end requires that a follow choice was made (even "none"). */
export function validateEndRomance(input: EndRomanceInput): RuleError | null {
	if (input.followClosenessTypeId === undefined) return 'E-ROM-END-INCOMPLETE';
	return null;
}
