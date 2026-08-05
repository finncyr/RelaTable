import { json, error } from '@sveltejs/kit';
import { getSetting, SETTING_KEYS } from '$lib/server/settings';
import { openRouterStatus } from '$lib/server/openrouterStatus';
import { groqStatus } from '$lib/server/groqStatus';
import type { RequestHandler } from './$types';

// Owner-only: is the voice/narration backend usable right now? Drives the mic
// button's enabled/grayed state + tooltip (setting overrides ENV fallback).
// groqReason additionally gates the mic on desktop, where the browser's native
// SpeechRecognition doesn't work reliably and Groq-Whisper is the real transcriber.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Nicht angemeldet.');
	if (!process.env.RELATABLE_MCP_TOKEN) {
		return json({ ok: false, reason: 'error', message: 'MCP-Token nicht konfiguriert (RELATABLE_MCP_TOKEN fehlt).' });
	}
	const [key, groqKey] = await Promise.all([
		getSetting(locals.user.id, SETTING_KEYS.openRouterApiKey),
		getSetting(locals.user.id, SETTING_KEYS.groqApiKey)
	]);
	const [narration, groq] = await Promise.all([
		openRouterStatus(key || process.env.OPENROUTER_API_KEY || null),
		groqStatus(groqKey || process.env.GROQ_API_KEY || null)
	]);
	return json({ ...narration, groqReason: groq.reason });
};
