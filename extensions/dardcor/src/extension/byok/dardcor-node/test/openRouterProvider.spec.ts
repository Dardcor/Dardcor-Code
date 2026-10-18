/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { BYOKModelCapabilities } from '../../common/byokProvider';
import { OpenRouterLMProvider } from '../openRouterProvider';


class TestableOpenRouterLMProvider extends OpenRouterLMProvider {
	public resolveCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		return this.resolveModelCapabilities(modelData);
	}
}

function createProvider(): TestableOpenRouterLMProvider {
	const logService = {
		trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
		show: vi.fn(), createSubLogger: vi.fn(), withExtraTarget: vi.fn(),
	};
	logService.createSubLogger.mockReturnValue(logService);
	logService.withExtraTarget.mockReturnValue(logService);

	return new TestableOpenRouterLMProvider(
		{ getAPIKey: vi.fn().mockResolvedValue(undefined), storeAPIKey: vi.fn(), deleteAPIKey: vi.fn() } as any,
		{ fetch: vi.fn() } as any,
		logService as any,
		{ createInstance: vi.fn().mockReturnValue({}) } as any,
		{ isConfigured: vi.fn().mockReturnValue(false), getConfig: vi.fn(), setConfig: vi.fn() } as any,
		{} as any,
	);
}

describe('OpenRouterLMProvider context window (issue #324671)', () => {
	it('derives maxInputTokens from the model-level context_length, not top_provider', () => {
		const provider = createProvider();

		const caps = provider.resolveCapabilities({
			id: 'xiaomi/mimo-v2.5',
			name: 'MiMo v2.5',
			supported_parameters: ['tools'],
			architecture: { input_modalities: ['text'] },
			context_length: 1048576,
			top_provider: { context_length: 32000 },
		});

		expect(caps?.maxInputTokens).toBe(1048576 - 16000);
		expect(caps?.maxOutputTokens).toBe(16000);
	});

	it('honors top_provider.max_completion_tokens as the output budget', () => {
		const provider = createProvider();

		const caps = provider.resolveCapabilities({
			id: 'some/reasoning-model',
			name: 'Reasoning Model',
			supported_parameters: ['tools'],
			context_length: 200000,
			top_provider: { context_length: 200000, max_completion_tokens: 64000 },
		});

		expect(caps?.maxOutputTokens).toBe(64000);
		expect(caps?.maxInputTokens).toBe(200000 - 64000);
	});

	it('falls back to top_provider.context_length when the model omits context_length', () => {
		const provider = createProvider();

		const caps = provider.resolveCapabilities({
			id: 'legacy/model',
			name: 'Legacy Model',
			supported_parameters: ['tools'],
			top_provider: { context_length: 128000 },
		});

		expect(caps?.maxInputTokens).toBe(128000 - 16000);
	});

	it('clamps the output reserve so a small-context model keeps a positive prompt budget', () => {
		const provider = createProvider();

		const caps = provider.resolveCapabilities({
			id: 'tiny/model',
			name: 'Tiny Model',
			supported_parameters: ['tools'],
			context_length: 8000,
			top_provider: { context_length: 8000, max_completion_tokens: 16000 },
		});

		expect(caps?.maxOutputTokens).toBe(4000);
		expect(caps?.maxInputTokens).toBe(4000);
	});
});
