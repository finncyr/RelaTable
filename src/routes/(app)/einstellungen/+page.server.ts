import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { getBoolSetting, getSetting, SETTING_KEYS } from '$lib/server/settings';
import { runJsonImport } from '$lib/server/jsonImport';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ownerId = locals.user!.id;
	const [categories, types, exclusions, eventTypes, user, hideSensitive, aiKey, aiModel, aiAutoApprove, aiPragmaticMode, groqKey] =
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
			getBoolSetting(ownerId, SETTING_KEYS.narratePragmaticMode, false),
			getSetting(ownerId, SETTING_KEYS.groqApiKey)
		]);

	const byCategory = categories.map((c) => ({
		name: c.name,
		types: types.filter((t) => t.categoryId === c.id).map((t) => ({ id: t.id, name: t.name, isActive: t.isActive }))
	}));

	// Plain-language exclusion rules (SCR-081 ②).
	const ruleText = exclusions.map((r) => {
		const verb = r.effect === 'ends' ? 'beendet' : 'blockiert';
		return `„${r.sourceType.name}" ${verb} „${r.targetType.name}".`;
	});

	return {
		byCategory,
		ruleText,
		eventTypes,
		theme: user?.themePreference ?? 'System',
		hideSensitive,
		// Key selbst nie an den Client geben — nur ob gesetzt. Modell ist nicht geheim.
		aiKeySet: !!aiKey,
		aiModel: aiModel ?? '',
		aiAutoApprove,
		aiPragmaticMode,
		groqKeySet: !!groqKey || !!process.env.GROQ_API_KEY
	};
};

export const actions: Actions = {
	addContextType: async ({ request }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { typeError: 'Name erforderlich' });
		const cat = await db.relationshipCategory.findUnique({ where: { name: 'Kontext' } });
		if (!cat) return fail(500, { typeError: 'Kategorie fehlt' });
		const exists = await db.relationshipType.findUnique({ where: { name } });
		if (exists) return fail(400, { typeError: 'Typ existiert bereits' });
		await db.relationshipType.create({
			data: { categoryId: cat.id, name, isContinuous: true, isClosenessLevel: false, color: '#7a8a99' }
		});
		return { typeAdded: true };
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
