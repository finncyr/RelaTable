import { db } from './db';

// Keys for AppSetting rows (per single owner).
export const SETTING_KEYS = {
	hideSensitiveByDefault: 'hideSensitiveByDefault',
	railPinned: 'railPinned',
	// ponytail: Klartext in SQLite — gleiches Schutzniveau wie der Key in .env. Wird
	// nur serverseitig gelesen, nie an den Browser zurückgegeben. Upgrade-Pfad, falls
	// nötig: at-rest-Verschlüsselung (z. B. mit einem aus einem ENV-Secret abgeleiteten Schlüssel).
	openRouterApiKey: 'openRouterApiKey',
	openRouterModel: 'openRouterModel',
	// true = KI schreibt direkt; false (Standard) = erst Zusammenfassung + Bestätigung.
	narrateAutoApprove: 'narrateAutoApprove',
	// An: KI legt ohne Rückfragen pragmatisch-minimal an. Nur wirksam zusammen mit narrateAutoApprove=true.
	narratePragmaticMode: 'narratePragmaticMode',
	groqApiKey: 'groqApiKey'
} as const;

export async function getSetting(ownerId: number, key: string): Promise<string | null> {
	const row = await db.appSetting.findUnique({ where: { ownerId_key: { ownerId, key } } });
	return row?.value ?? null;
}

export async function setSetting(ownerId: number, key: string, value: string): Promise<void> {
	await db.appSetting.upsert({
		where: { ownerId_key: { ownerId, key } },
		create: { ownerId, key, value },
		update: { value }
	});
}

export async function getBoolSetting(ownerId: number, key: string, fallback: boolean): Promise<boolean> {
	const v = await getSetting(ownerId, key);
	if (v === null) return fallback;
	return v === 'true';
}
