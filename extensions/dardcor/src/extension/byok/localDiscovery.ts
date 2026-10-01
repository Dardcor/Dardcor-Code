/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IDiscoveredLocalModel {
	provider: 'ollama' | 'lmstudio' | 'vllm';
	id: string;
	name: string;
	endpoint: string;
	size?: number;
	details?: string;
}

export class LocalModelAutoDiscovery {
	private static instance: LocalModelAutoDiscovery | undefined;
	private discoveredModels: IDiscoveredLocalModel[] = [];
	private lastScanTime = 0;

	public static getInstance(): LocalModelAutoDiscovery {
		if (!LocalModelAutoDiscovery.instance) {
			LocalModelAutoDiscovery.instance = new LocalModelAutoDiscovery();
		}
		return LocalModelAutoDiscovery.instance;
	}

	public async scan(force = false): Promise<IDiscoveredLocalModel[]> {
		const now = Date.now();
		if (!force && now - this.lastScanTime < 30000 && this.discoveredModels.length > 0) {
			return this.discoveredModels;
		}

		const results: IDiscoveredLocalModel[] = [];

		// 1. Probe Ollama at default port 11434
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 1200);
			const res = await fetch('http://127.0.0.1:11434/api/tags', {
				signal: controller.signal,
				headers: { 'User-Agent': 'Dardcor-Code-Discovery' },
			});
			clearTimeout(timeout);

			if (res.ok) {
				const data = (await res.json()) as { models?: Array<{ name: string; size?: number; details?: any }> };
				if (data.models && Array.isArray(data.models)) {
					for (const m of data.models) {
						results.push({
							provider: 'ollama',
							id: m.name,
							name: m.name,
							endpoint: 'http://127.0.0.1:11434',
							size: m.size,
							details: m.details?.family || 'local',
						});
					}
				}
			}
		} catch {
			// Ollama not running or timed out
		}

		// 2. Probe LM Studio at default port 1234
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 1200);
			const res = await fetch('http://127.0.0.1:1234/v1/models', {
				signal: controller.signal,
				headers: { 'User-Agent': 'Dardcor-Code-Discovery' },
			});
			clearTimeout(timeout);

			if (res.ok) {
				const data = (await res.json()) as { data?: Array<{ id: string }> };
				if (data.data && Array.isArray(data.data)) {
					for (const m of data.data) {
						results.push({
							provider: 'lmstudio',
							id: m.id,
							name: m.id,
							endpoint: 'http://127.0.0.1:1234',
							details: 'LM Studio OpenAI compatibility',
						});
					}
				}
			}
		} catch {
			// LM Studio not running or timed out
		}

		// 3. Probe vLLM / LocalAI at default port 8000
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 1200);
			const res = await fetch('http://127.0.0.1:8000/v1/models', {
				signal: controller.signal,
				headers: { 'User-Agent': 'Dardcor-Code-Discovery' },
			});
			clearTimeout(timeout);

			if (res.ok) {
				const data = (await res.json()) as { data?: Array<{ id: string }> };
				if (data.data && Array.isArray(data.data)) {
					for (const m of data.data) {
						results.push({
							provider: 'vllm',
							id: m.id,
							name: m.id,
							endpoint: 'http://127.0.0.1:8000',
							details: 'vLLM OpenAI compatible server',
						});
					}
				}
			}
		} catch {
			// vLLM not running or timed out
		}

		this.discoveredModels = results;
		this.lastScanTime = now;
		return results;
	}

	public getCachedModels(): IDiscoveredLocalModel[] {
		return this.discoveredModels;
	}
}
