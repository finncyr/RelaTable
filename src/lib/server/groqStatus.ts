// Probes whether the Groq API key is usable, so the desktop mic can be grayed
// out instead of silently failing transcription after recording.
export type GroqReason = 'no-key' | 'invalid-key' | 'error' | null;

export function classifyGroqStatus(p: { hasKey: boolean; httpStatus?: number }): GroqReason {
	if (!p.hasKey) return 'no-key';
	if (p.httpStatus === 401 || p.httpStatus === 403) return 'invalid-key';
	if (p.httpStatus !== 200) return 'error';
	return null;
}

// GET /models is free and requires no audio upload — cheapest way to validate the key.
export async function groqStatus(key: string | null | undefined): Promise<{ ok: boolean; reason: GroqReason }> {
	if (!key) return { ok: false, reason: 'no-key' };
	let httpStatus: number | undefined;
	try {
		const res = await fetch('https://api.groq.com/openai/v1/models', {
			headers: { authorization: `Bearer ${key}` }
		});
		httpStatus = res.status;
	} catch {
		/* network failure → httpStatus stays undefined → classified as 'error' */
	}
	const reason = classifyGroqStatus({ hasKey: true, httpStatus });
	return { ok: reason === null, reason };
}
