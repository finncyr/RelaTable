import { describe, it, expect } from 'vitest';
import {
	canonicalPair,
	currentTypeName,
	activeCloseness,
	evaluateStartType,
	validateTimeOrder,
	validateEndRomance,
	closenessSortKey,
	normalizeRelationshipTypeName,
	inverseFamilyRoleName,
	type RelType,
	type Period
} from './relationships';

// Minimal type catalogue mirroring the seed.
const T = {
	bekanntschaft: { id: 1, name: 'Bekanntschaft', categoryName: 'Naehegrad', rank: 1, isClosenessLevel: true, isContinuous: true },
	freundschaft: { id: 2, name: 'Freundschaft', categoryName: 'Naehegrad', rank: 2, isClosenessLevel: true, isContinuous: true },
	enge: { id: 3, name: 'Enge Freundschaft', categoryName: 'Naehegrad', rank: 3, isClosenessLevel: true, isContinuous: true },
	fplus: { id: 4, name: 'Freundschaft Plus', categoryName: 'Status', rank: null, isClosenessLevel: false, isContinuous: true },
	romantik: { id: 5, name: 'Romantik', categoryName: 'Romantik', rank: null, isClosenessLevel: false, isContinuous: true },
	ex: { id: 6, name: 'Ex-Partner/in', categoryName: 'Status', rank: null, isClosenessLevel: false, isContinuous: true },
	cosplay: { id: 7, name: 'Cosplay', categoryName: 'Kontext', rank: null, isClosenessLevel: false, isContinuous: true },
	mutter: { id: 8, name: 'Mutter', categoryName: 'Familie', rank: null, isClosenessLevel: false, isContinuous: true },
	sohn: { id: 9, name: 'Sohn', categoryName: 'Familie', rank: null, isClosenessLevel: false, isContinuous: true }
} satisfies Record<string, RelType>;
const types = Object.values(T);

const active = (typeId: number): Period => ({ relationshipTypeId: typeId, validFrom: new Date(), validTo: null });

describe('canonical pair (C-MODEL-1/2)', () => {
	it('orders low < high regardless of argument order', () => {
		expect(canonicalPair(7, 3)).toEqual({ low: 3, high: 7 });
		expect(canonicalPair(3, 7)).toEqual({ low: 3, high: 7 });
	});
	it('rejects a self edge', () => {
		expect(() => canonicalPair(5, 5)).toThrow();
	});
});

describe('current type resolution (graph color)', () => {
	it('romance dominates closeness', () => {
		expect(currentTypeName([active(T.freundschaft.id), active(T.romantik.id)], types)).toBe('Romantik');
	});
	it('picks the single active closeness otherwise', () => {
		expect(currentTypeName([active(T.freundschaft.id)], types)).toBe('Freundschaft');
		expect(activeCloseness([active(T.enge.id)], types)?.relationshipTypeId).toBe(T.enge.id);
	});
	it('returns null when nothing active', () => {
		expect(currentTypeName([{ relationshipTypeId: T.freundschaft.id, validFrom: null, validTo: new Date() }], types)).toBeNull();
	});
});

describe('start-type transitions (V-1..V-6)', () => {
	it('V-1: closeness while romance active is rejected (E-NG-ROM)', () => {
		const r = evaluateStartType(T.freundschaft.id, [active(T.romantik.id)], types);
		expect(r.allowed).toBe(false);
		expect(r.error).toBe('E-NG-ROM');
	});

	it('changing closeness ends the previous closeness period (C-MODEL-4)', () => {
		const r = evaluateStartType(T.enge.id, [active(T.freundschaft.id)], types);
		expect(r.allowed).toBe(true);
		expect(r.ends).toEqual([T.freundschaft.id]);
	});

	it('V-3: friendship plus while romance active is rejected (E-FP-ROM)', () => {
		const r = evaluateStartType(T.fplus.id, [active(T.romantik.id)], types);
		expect(r.allowed).toBe(false);
		expect(r.error).toBe('E-FP-ROM');
	});

	it('V-4: starting romance ends active closeness + friendship plus', () => {
		const r = evaluateStartType(T.romantik.id, [active(T.freundschaft.id), active(T.fplus.id)], types);
		expect(r.allowed).toBe(true);
		expect(r.ends.sort()).toEqual([T.freundschaft.id, T.fplus.id].sort());
	});

	it('context types stay parallel and end nothing', () => {
		const r = evaluateStartType(T.cosplay.id, [active(T.romantik.id)], types);
		expect(r.allowed).toBe(true);
		expect(r.ends).toEqual([]);
	});

	it('rejects a duplicate active type (E-PERIOD-OVERLAP)', () => {
		const r = evaluateStartType(T.fplus.id, [active(T.fplus.id)], types);
		expect(r.error).toBe('E-PERIOD-OVERLAP');
	});
});

describe('end-of-romance (V-5) and time order (V-7)', () => {
	it('requires a follow choice', () => {
		expect(validateEndRomance({ followClosenessTypeId: undefined, activateExPartner: false })).toBe('E-ROM-END-INCOMPLETE');
		expect(validateEndRomance({ followClosenessTypeId: null, activateExPartner: true })).toBeNull();
		expect(validateEndRomance({ followClosenessTypeId: 2, activateExPartner: false })).toBeNull();
	});
	it('rejects end before start', () => {
		expect(validateTimeOrder(new Date(Date.UTC(2023, 0, 1)), new Date(Date.UTC(2022, 0, 1)))).toBe('E-TIME-ORDER');
		expect(validateTimeOrder(new Date(Date.UTC(2022, 0, 1)), new Date(Date.UTC(2023, 0, 1)))).toBeNull();
	});
});

describe('closeness sort (engste zuerst, SCR-012)', () => {
	it('orders romance < ex < enge < freundschaft < bekanntschaft', () => {
		const k = (id: number) => closenessSortKey([active(id)], types);
		expect(k(T.romantik.id)).toBeLessThan(k(T.ex.id));
		expect(k(T.ex.id)).toBeLessThan(k(T.enge.id));
		expect(k(T.enge.id)).toBeLessThan(k(T.freundschaft.id));
		expect(k(T.freundschaft.id)).toBeLessThan(k(T.bekanntschaft.id));
	});
});

describe('relationship type phrase normalization', () => {
	it('maps good-friend phrasing to Enge Freundschaft', () => {
		expect(normalizeRelationshipTypeName('gute Freunde')).toBe('Enge Freundschaft');
		expect(normalizeRelationshipTypeName('gute Freundschaft')).toBe('Enge Freundschaft');
		expect(normalizeRelationshipTypeName('sehr gute Freunde')).toBe('Enge Freundschaft');
	});

	it('keeps exact canonical names intact', () => {
		expect(normalizeRelationshipTypeName('Freundschaft')).toBe('Freundschaft');
		expect(normalizeRelationshipTypeName('Enge Freundschaft')).toBe('Enge Freundschaft');
	});
});

describe('Familie replaces Nähegrad (directional, personId-scoped)', () => {
	it('starting a family type ends the active closeness', () => {
		const res = evaluateStartType(T.mutter.id, [active(T.freundschaft.id)], types, 1);
		expect(res.allowed).toBe(true);
		expect(res.ends).toEqual([T.freundschaft.id]);
	});

	it('blocks setting a new closeness while a family type is active', () => {
		const periods = [{ ...active(T.mutter.id), personId: 1 }];
		const res = evaluateStartType(T.freundschaft.id, periods, types);
		expect(res.allowed).toBe(false);
		expect(res.error).toBe('E-NG-FAM');
	});

	it('allows the same family type on both persons of a connection (symmetric roles)', () => {
		const periods = [{ ...active(T.mutter.id), personId: 1 }];
		const res = evaluateStartType(T.mutter.id, periods, types, 2);
		expect(res.allowed).toBe(true);
	});

	it('blocks re-starting the identical role for the same person', () => {
		const periods = [{ ...active(T.mutter.id), personId: 1 }];
		const res = evaluateStartType(T.mutter.id, periods, types, 1);
		expect(res.allowed).toBe(false);
		expect(res.error).toBe('E-PERIOD-OVERLAP');
	});
});

describe('inverseFamilyRoleName (V-9: reciprocal role from gender)', () => {
	it('derives the gendered reciprocal when known', () => {
		expect(inverseFamilyRoleName('Mutter', 'Männlich')).toBe('Sohn');
		expect(inverseFamilyRoleName('Mutter', 'Weiblich')).toBe('Tochter');
		expect(inverseFamilyRoleName('Onkel', 'Weiblich')).toBe('Nichte');
		expect(inverseFamilyRoleName('Neffe', 'Männlich')).toBe('Onkel');
	});

	it('falls back to the gender-neutral term for divers or missing gender', () => {
		expect(inverseFamilyRoleName('Mutter', 'divers')).toBe('Kind');
		expect(inverseFamilyRoleName('Mutter', null)).toBe('Kind');
		expect(inverseFamilyRoleName('Mutter', undefined)).toBe('Kind');
		expect(inverseFamilyRoleName('Onkel', 'divers')).toBe('Neffe/Nichte');
	});

	it('round-trips through the neutral fallback types themselves', () => {
		expect(inverseFamilyRoleName('Kind', 'Weiblich')).toBe('Mutter');
		expect(inverseFamilyRoleName('Kind', null)).toBe('Elternteil');
	});

	it('returns null for non-family type names', () => {
		expect(inverseFamilyRoleName('Freundschaft', 'Weiblich')).toBeNull();
	});
});
