import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSetting } from '$lib/server/settings';
import { openRouterStatus } from '$lib/server/openrouterStatus';

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn(),
	SETTING_KEYS: { openRouterApiKey: 'openRouterApiKey' }
}));
vi.mock('$lib/server/openrouterStatus', () => ({
	openRouterStatus: vi.fn()
}));

const { GET } = await import('../../routes/api/voice-status/+server');

let savedMcpToken: string | undefined;
beforeEach(() => {
	savedMcpToken = process.env.RELATABLE_MCP_TOKEN;
	process.env.RELATABLE_MCP_TOKEN = 'test-token';
});
afterEach(() => {
	if (savedMcpToken !== undefined) process.env.RELATABLE_MCP_TOKEN = savedMcpToken;
	else delete process.env.RELATABLE_MCP_TOKEN;
	vi.clearAllMocks();
});

describe('GET /api/voice-status', () => {
	it('ohne User → 401', async () => {
		await expect(GET({ locals: {} } as any)).rejects.toMatchObject({ status: 401 });
	});

	it('mit User + Settings-Key → ruft openRouterStatus mit Settings-Key auf', async () => {
		vi.mocked(getSetting).mockResolvedValue('sk-settings-key');
		vi.mocked(openRouterStatus).mockResolvedValue({ ok: true, reason: null });

		const res = await GET({ locals: { user: { id: 1 } } } as any);
		const data = await res.json();

		expect(openRouterStatus).toHaveBeenCalledWith('sk-settings-key');
		expect(data).toMatchObject({ ok: true, reason: null });
	});

	it('ohne RELATABLE_MCP_TOKEN → reason=error + message', async () => {
		const saved = process.env.RELATABLE_MCP_TOKEN;
		delete process.env.RELATABLE_MCP_TOKEN;
		try {
			const res = await GET({ locals: { user: { id: 1 } } } as any);
			const data = await res.json();
			expect(data.ok).toBe(false);
			expect(data.reason).toBe('error');
			expect(typeof data.message).toBe('string');
			expect(openRouterStatus).not.toHaveBeenCalled();
		} finally {
			if (saved !== undefined) process.env.RELATABLE_MCP_TOKEN = saved;
		}
	});

	it('mit User + ENV-Key (Settings leer) → fällt auf ENV zurück', async () => {
		vi.mocked(getSetting).mockResolvedValue(null);
		vi.mocked(openRouterStatus).mockResolvedValue({ ok: false, reason: 'no-credits' });
		const saved = process.env.OPENROUTER_API_KEY;
		process.env.OPENROUTER_API_KEY = 'env-key';
		try {
			await GET({ locals: { user: { id: 1 } } } as any);
			expect(openRouterStatus).toHaveBeenCalledWith('env-key');
		} finally {
			if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
			else delete process.env.OPENROUTER_API_KEY;
		}
	});
});
