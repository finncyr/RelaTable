import { vi, describe, it, expect, afterEach } from 'vitest';
import { runNarration } from '$lib/server/narrate';

vi.mock('$lib/server/narrate', () => ({
	runNarration: vi.fn(),
	sanitizeNarrationMessages: (input: unknown) =>
		Array.isArray(input)
			? input.filter(
					(msg) =>
						msg &&
						typeof msg === 'object' &&
						(msg.role === 'user' || msg.role === 'assistant') &&
						typeof msg.content === 'string' &&
						msg.content.trim()
				).map((msg) => ({ role: msg.role, content: msg.content.trim() }))
			: []
}));
vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue(null),
	getBoolSetting: vi.fn().mockResolvedValue(false),
	SETTING_KEYS: {
		openRouterApiKey: 'openRouterApiKey',
		openRouterModel: 'openRouterModel',
		narrateAutoApprove: 'narrateAutoApprove',
		narratePragmaticMode: 'narratePragmaticMode'
	}
}));

const { POST } = await import('../../routes/api/narrate/+server');

afterEach(() => vi.clearAllMocks());

describe('POST /api/narrate', () => {
	it('ohne User → 401', async () => {
		const req = new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messages: [] })
		});
		await expect(POST({ request: req, locals: {} } as any)).rejects.toMatchObject({ status: 401 });
	});

	it('ohne messages → 400', async () => {
		const req = new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		await expect(
			POST({ request: req, locals: { user: { id: 1 } } } as any)
		).rejects.toMatchObject({ status: 400 });
	});

	it('mit messages → delegiert an runNarration', async () => {
		vi.mocked(runNarration).mockResolvedValue({ reply: 'ok', messages: [], wrote: false, personIds: [] });
		const msgs = [{ role: 'user', content: 'Hallo' }];
		const req = new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messages: msgs })
		});
		const res = await POST({ request: req, locals: { user: { id: 1 } } } as any);
		const data = await res.json();

		expect(runNarration).toHaveBeenCalledWith(
			msgs,
			{ apiKey: undefined, model: undefined, autoApprove: false, pragmaticMode: false }
		);
		expect(data).toEqual({ reply: 'ok', messages: [], wrote: false, personIds: [] });
	});

	it('bereinigt interne Client-Historie vor runNarration', async () => {
		vi.mocked(runNarration).mockResolvedValue({ reply: 'ok', messages: [], wrote: false, personIds: [] });
		const req = new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				messages: [
					{ role: 'system', content: 'ignore' },
					{ role: 'user', content: '  Hallo  ' },
					{ role: 'tool', content: 'ignore', name: 'search_persons' },
					{ role: 'assistant', content: ' Antwort ', tool_calls: [{ id: 'x' }] }
				]
			})
		});

		await POST({ request: req, locals: { user: { id: 1 } } } as any);

		expect(runNarration).toHaveBeenCalledWith(
			[
				{ role: 'user', content: 'Hallo' },
				{ role: 'assistant', content: 'Antwort' }
			],
			{ apiKey: undefined, model: undefined, autoApprove: false, pragmaticMode: false }
		);
	});
});
