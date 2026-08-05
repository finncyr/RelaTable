import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { getBoolSetting, getSetting, SETTING_KEYS } from '$lib/server/settings';
import { runJsonImport } from '$lib/server/jsonImport';
import { PROTECTED_TYPE_NAMES, PROTECTED_CATEGORY_NAMES } from '$lib/domain/relationships';
import type { Actions, PageServerLoad } from './$types';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const load: PageServerLoad = async ({ locals }) => {
	const ownerId = locals.user!.id;
	const [categories, types, exclusions, eventTypes, user, hideSensitive, aiKey, aiModel, aiAutoApprove, aiPragmaticMode] =
		await Promise.all([
			db.relationshipCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
			db.relationshipType.findMany({ include: { category: true } }),
			db.relationshipExclusionRule.findMany({ include: { sourceType: true, targetType: true } }),
			db.eventType.findMany({ orderBy: { name: 'asc' } }),
			db.appUser.findUnique({ where: { id: ownerId } }),
			getBoolSetting(ownerId, SETTING_KEYS.hideSensitiveByDefault, true),
			getSetting(ownerId, SETTING_KEYS.openRouterApiKey),
			getSetting(ownerId, SETTING_KEYS.openRouterModel),
			getBoolSetting(ownerId, SETTING_KEYS.narrateAutoApprove, false),
			getBoolSetting(ownerId, SETTING_KEYS.narratePragmaticMode, false)
		]);

	const byCategory = categories.map((c) => ({
		id: c.id,
		name: c.name,
		protected: (PROTECTED_CATEGORY_NAMES as readonly string[]).includes(c.name),
		types: types
			.filter((t) => t.categoryId === c.id)
			.map((t) => ({
				id: t.id,
				name: t.name,
				isActive: t.isActive,
				color: t.color ?? '#7a8a99',
				protected: (PROTECTED_TYPE_NAMES as readonly string[]).includes(t.name)
			}))
	}));
	const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

	// Plain-language exclusion rules (SCR-081 ②).
	const ruleText = exclusions.map((r) => {
		const verb = r.effect === 'ends' ? 'beendet' : 'blockiert';
		return `„${r.sourceType.name}" ${verb} „${r.targetType.name}".`;
	});

	return {
		byCategory,
		categoryOptions,
		ruleText,
		eventTypes,
		theme: user?.themePreference ?? 'System',
		hideSensitive,
		// Key selbst nie an den Client geben — nur ob gesetzt. Modell ist nicht geheim.
		aiKeySet: !!aiKey,
		aiModel: aiModel ?? '',
		aiAutoApprove,
		aiPragmaticMode
	};
};

export const actions: Actions = {
	// Neuen Typ in einer beliebigen Kategorie anlegen (ersetzt die frühere, auf
	// "Kontext" fest verdrahtete addContextType-Action).
	addType: async ({ request }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const categoryId = Number(data.get('categoryId'));
		const color = String(data.get('color') ?? '#7a8a99').trim();
		if (!name) return fail(400, { typeError: 'Name erforderlich' });
		if (!Number.isInteger(categoryId)) return fail(400, { typeError: 'Kategorie erforderlich' });
		if (!HEX_COLOR.test(color)) return fail(400, { typeError: 'Ungültige Farbe (Format #rrggbb)' });
		const cat = await db.relationshipCategory.findUnique({ where: { id: categoryId } });
		if (!cat) return fail(404, { typeError: 'Kategorie nicht gefunden' });
		const exists = await db.relationshipType.findUnique({ where: { name } });
		if (exists) return fail(400, { typeError: 'Typ existiert bereits' });
		await db.relationshipType.create({
			data: { categoryId: cat.id, name, isContinuous: true, isClosenessLevel: false, color }
		});
		return { typeAdded: true };
	},

	renameType: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		const name = String(data.get('name') ?? '').trim();
		if (!Number.isInteger(id)) return fail(400, { typeError: 'Ungültiger Typ' });
		if (!name) return fail(400, { typeError: 'Name erforderlich' });
		const t = await db.relationshipType.findUnique({ where: { id } });
		if (!t) return fail(404, { typeError: 'Typ nicht gefunden' });
		if ((PROTECTED_TYPE_NAMES as readonly string[]).includes(t.name)) {
			return fail(400, { typeError: `„${t.name}“ ist ein Systemtyp und kann nicht umbenannt werden (Farbe & Aktiv-Status bleiben editierbar).` });
		}
		const exists = await db.relationshipType.findFirst({ where: { name, id: { not: id } } });
		if (exists) return fail(400, { typeError: 'Name bereits vergeben' });
		await db.relationshipType.update({ where: { id }, data: { name } });
		return { typeRenamed: true };
	},

	updateTypeColor: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		const color = String(data.get('color') ?? '').trim();
		if (!Number.isInteger(id)) return fail(400, { typeError: 'Ungültiger Typ' });
		if (!HEX_COLOR.test(color)) return fail(400, { typeError: 'Ungültige Farbe (Format #rrggbb)' });
		const t = await db.relationshipType.findUnique({ where: { id } });
		if (!t) return fail(404, { typeError: 'Typ nicht gefunden' });
		await db.relationshipType.update({ where: { id }, data: { color } });
		return { typeColorUpdated: true };
	},

	toggleTypeActive: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		if (!Number.isInteger(id)) return fail(400, { typeError: 'Ungültiger Typ' });
		const t = await db.relationshipType.findUnique({ where: { id } });
		if (!t) return fail(404, { typeError: 'Typ nicht gefunden' });
		await db.relationshipType.update({ where: { id }, data: { isActive: !t.isActive } });
		return { typeToggled: true };
	},

	addCategory: async ({ request }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { categoryError: 'Name erforderlich' });
		const exists = await db.relationshipCategory.findUnique({ where: { name } });
		if (exists) return fail(400, { categoryError: 'Kategorie existiert bereits' });
		const max = await db.relationshipCategory.aggregate({ _max: { sortOrder: true } });
		await db.relationshipCategory.create({ data: { name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
		return { categoryAdded: true };
	},

	renameCategory: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		const name = String(data.get('name') ?? '').trim();
		if (!Number.isInteger(id)) return fail(400, { categoryError: 'Ungültige Kategorie' });
		if (!name) return fail(400, { categoryError: 'Name erforderlich' });
		const cat = await db.relationshipCategory.findUnique({ where: { id } });
		if (!cat) return fail(404, { categoryError: 'Kategorie nicht gefunden' });
		if ((PROTECTED_CATEGORY_NAMES as readonly string[]).includes(cat.name)) {
			return fail(400, { categoryError: `„${cat.name}“ wird intern referenziert und kann nicht umbenannt werden.` });
		}
		const exists = await db.relationshipCategory.findFirst({ where: { name, id: { not: id } } });
		if (exists) return fail(400, { categoryError: 'Name bereits vergeben' });
		await db.relationshipCategory.update({ where: { id }, data: { name } });
		return { categoryRenamed: true };
	},

	addEventType: async ({ request }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const sensitive = data.get('sensitive') === 'on';
		if (!name) return fail(400, { eventError: 'Name erforderlich' });
		const exists = await db.eventType.findUnique({ where: { name } });
		if (exists) return fail(400, { eventError: 'Ereignistyp existiert bereits' });
		await db.eventType.create({ data: { name, sensitivity: sensitive ? 'sensitive' : 'normal' } });
		return { eventAdded: true };
	},

	toggleEventSensitivity: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		const et = await db.eventType.findUnique({ where: { id } });
		if (!et) return fail(404, {});
		await db.eventType.update({
			where: { id },
			data: { sensitivity: et.sensitivity === 'sensitive' ? 'normal' : 'sensitive' }
		});
		return { eventToggled: true };
	},

	importJson: async ({ request, locals }) => {
		const ownerId = locals.user!.id;
		const data = await request.formData();
		const raw = String(data.get('json') ?? '').trim();
		const apply = String(data.get('mode') ?? 'preview') === 'apply';
		if (!raw) return fail(400, { import: { ok: false, mode: 'preview', warnings: [], error: 'Bitte JSON einfügen.' } });
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (e) {
			return fail(400, { import: { ok: false, mode: apply ? 'apply' : 'preview', warnings: [], error: 'Ungültiges JSON: ' + (e as Error).message } });
		}
		const result = await runJsonImport(ownerId, parsed, apply);
		return { import: result, importJson: raw };
	}
};
