import { json, error } from '@sveltejs/kit';
import { getSetting, SETTING_KEYS } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Nicht angemeldet.');

	const key = (await getSetting(locals.user.id, SETTING_KEYS.groqApiKey)) || process.env.GROQ_API_KEY || null;
	if (!key) throw error(503, 'Kein Groq-API-Key — in den Einstellungen hinterlegen.');

	const form = await request.formData();
	const audio = form.get('audio') as File | null;
	if (!audio || audio.size === 0) throw error(400, 'Keine Audiodatei.');

	const fd = new FormData();
	fd.append('file', audio, 'audio.webm');
	fd.append('model', 'whisper-large-v3-turbo');
	fd.append('language', 'de');
	fd.append('response_format', 'json');

	const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}` },
		body: fd
	});
	if (!res.ok) {
		const msg = await res.text().catch(() => '');
		throw error(502, `Groq-Transkription fehlgeschlagen (${res.status}): ${msg.slice(0, 200)}`);
	}
	const data = await res.json();
	return json({ text: (data.text ?? '').trim() });
};
