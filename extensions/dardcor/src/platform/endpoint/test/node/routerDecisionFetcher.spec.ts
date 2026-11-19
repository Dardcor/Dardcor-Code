/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test, vi } from 'vitest';
import { RouterDecisionFetcher } from '../../node/routerDecisionFetcher';

describe('RouterDecisionFetcher', () => {
	test('selects only from the connected Dardcor Router candidates', async () => {
		const mockLogService = {
			trace: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};
		const fetchStub = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				choices: [{ message: { content: '{"model":"openai/gpt-4.1","predicted_label":"needs_reasoning","confidence":0.91}' } }],
			}),
		});
		vi.stubEnv('DARDCOR_ROUTER_URL', 'http://127.0.0.1:3333');
		vi.stubEnv('DARDCOR_API_KEY', 'test-router-key');
		vi.stubGlobal('fetch', fetchStub);

		try {
			const fetcher = new RouterDecisionFetcher(mockLogService as any);
			const candidates = [
				{ id: 'openai/gpt-4.1', name: 'GPT-4.1', supportsReasoning: true, supportsVision: true, supportsTools: true, contextTokens: 100_000 },
				{ id: 'anthropic/claude-haiku', name: 'Claude Haiku', supportsReasoning: false, supportsVision: true, supportsTools: true, contextTokens: 64_000 },
			];
			const result = await fetcher.getRouterDecision('analyze this race condition', 'anthropic/claude-haiku', candidates);

			expect(result).toEqual({ model: 'openai/gpt-4.1', predictedLabel: 'needs_reasoning', confidence: 0.91 });
			expect(fetchStub).toHaveBeenCalledOnce();
			const [url, request] = fetchStub.mock.calls[0] as [string, RequestInit];			expect(url).toBe('http://127.0.0.1:3333/v1/chat/completions');
			expect((request.headers as Record<string, string>).Authorization).toBe('Bearer test-router-key');			expect(JSON.parse(request.body as string).messages[1].content).toContain('analyze this race condition');
		} finally {
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	});
});
