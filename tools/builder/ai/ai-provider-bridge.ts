/**
 * Dardcor Code - LLM API Provider Gateway (Task 914)
 *
 * Unified completion gateway for OpenAI, Anthropic, and Ollama providers.
 * Uses only global `fetch`, supports configurable endpoints, streaming via
 * manual SSE line parsing, and AbortSignal cancellation. Provider-agnostic:
 * adding a provider is a matter of a request builder + response parser.
 */

export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
	readonly role: AiRole;
	readonly content: string;
}

export interface AiProviderConfig {
	readonly name: 'openai' | 'anthropic' | 'ollama' | string;
	readonly baseUrl?: string;
	readonly apiKey?: string;
	readonly model?: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly timeoutMs?: number;
}

export interface AiCompletionRequest {
	readonly provider: string;
	readonly messages: readonly AiMessage[];
	readonly config?: Partial<AiProviderConfig>;
}

export interface AiStreamChunk {
	readonly type: 'text' | 'error' | 'done';
	readonly text?: string;
	readonly error?: string;
}

export interface AiProviderBridgeEvents {
	onChunk?: (chunk: AiStreamChunk) => void;
	onDone?: (fullText: string) => void;
	onError?: (error: Error) => void;
}

const DEFAULT_ENDPOINTS: Record<string, string> = {
	openai: 'https://api.openai.com/v1',
	anthropic: 'https://api.anthropic.com/v1',
	ollama: 'http://localhost:11434/v1',
};

const DEFAULT_MODELS: Record<string, string> = {
	openai: 'gpt-4o-mini',
	anthropic: 'claude-3-5-haiku-latest',
	ollama: 'llama3.2',
};

export class AiProviderBridge {
	private readonly _providers = new Map<string, AiProviderConfig>();

	constructor(providers?: readonly AiProviderConfig[]) {
		for (const provider of providers ?? []) {
			this.register(provider);
		}
	}

	register(config: AiProviderConfig): void {
		this._providers.set(config.name, config);
	}

	unregister(name: string): void {
		this._providers.delete(name);
	}

	hasProvider(name: string): boolean {
		return this._providers.has(name);
	}

	private _resolveConfig(request: AiCompletionRequest): AiProviderConfig {
		const registered = this._providers.get(request.provider);
		const fallback: AiProviderConfig = {
			name: request.provider,
			baseUrl: DEFAULT_ENDPOINTS[request.provider],
			apiKey: request.config?.apiKey ?? process.env[`DC_AI_${request.provider.toUpperCase()}_KEY`] ?? '',
			model: DEFAULT_MODELS[request.provider],
			maxTokens: 4096,
			temperature: 0.4,
			timeoutMs: 60000,
		};
		return { ...fallback, ...registered, ...request.config };
	}

	async complete(request: AiCompletionRequest): Promise<string> {
		const config = this._resolveConfig(request);
		const { url, init } = this._buildHttpRequest(config, request.messages, false);
		const response = await this._fetchWithTimeout(url, init, config.timeoutMs ?? 60000);
		if (!response.ok) {
			throw new Error(`AI request failed (${response.status} ${response.statusText}): ${await response.text()}`);
		}
		const payload = await response.json();
		return this._extractCompletion(config.name, payload);
	}

	async stream(request: AiCompletionRequest, events: AiProviderBridgeEvents, signal?: AbortSignal): Promise<string> {
		const config = this._resolveConfig(request);
		const { url, init } = this._buildHttpRequest(config, request.messages, true);
		if (signal) {
			signal.addEventListener('abort', () => { (init.signal as AbortController | undefined)?.abort(); }, { once: true });
		}
		const controller = new AbortController();
		init.signal = controller.signal;
		const response = await this._fetchWithTimeout(url, init, config.timeoutMs ?? 60000);
		if (!response.ok) {
			const detail = await response.text();
			const error = new Error(`AI stream failed (${response.status}): ${detail}`);
			events.onError?.(error);
			events.onChunk?.({ type: 'error', error: error.message });
			throw error;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('streaming not supported by response');
		}
		const decoder = new TextDecoder();
		let buffer = '';
		let fullText = '';
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const eventsOut = this._parseSse(buffer, config.name, text => {
					fullText += text;
					events.onChunk?.({ type: 'text', text });
				});
				buffer = eventsOut.rest;
			}
			events.onChunk?.({ type: 'done', text: fullText });
			events.onDone?.(fullText);
			return fullText;
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			events.onError?.(error);
			throw error;
		} finally {
			controller.abort();
			reader.releaseLock();
		}
	}

	private _buildHttpRequest(config: AiProviderConfig, messages: readonly AiMessage[], stream: boolean): { url: string; init: RequestInit } {
		const base = (config.baseUrl ?? DEFAULT_ENDPOINTS[config.name] ?? '').replace(/\/+$/, '');
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		let url = '';
		let body: unknown;

		if (config.name === 'anthropic') {
			url = `${base}/messages`;
			if (config.apiKey) headers['x-api-key'] = config.apiKey;
			headers['anthropic-version'] = '2023-06-01';
			body = {
				model: config.model,
				max_tokens: config.maxTokens ?? 4096,
				temperature: config.temperature,
				stream,
				messages: messages.map(m => ({ role: m.role, content: m.content })),
			};
		} else {
			// openai & ollama (ollama exposes an OpenAI-compatible endpoint)
			url = `${base}/chat/completions`;
			if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
			body = {
				model: config.model,
				max_tokens: config.maxTokens,
				temperature: config.temperature,
				stream,
				messages,
			};
		}
		return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
	}

	private async _fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(url, { ...init, signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
	}

	private _extractCompletion(provider: string, payload: any): string {
		if (provider === 'anthropic') {
			return (payload.content ?? [])
				.filter((b: any) => b.type === 'text')
				.map((b: any) => b.text ?? '')
				.join('');
		}
		const choice = payload.choices?.[0];
		const message = choice?.message ?? choice?.delta;
		return message?.content ?? message?.text ?? '';
	}

	private _parseSse(buffer: string, provider: string, onText: (text: string) => void): { rest: string } {
		let rest = buffer;
		while (true) {
			const split = rest.indexOf('\n\n');
			if (split === -1) break;
			const rawEvent = rest.slice(0, split);
			rest = rest.slice(split + 2);
			for (const line of rawEvent.split('\n')) {
				if (!line.startsWith('data:')) continue;
				const data = line.slice(5).trim();
				if (data === '[DONE]') return { rest };
				try {
					const json = JSON.parse(data);
					const text = this._extractStreamText(provider, json);
					if (text) onText(text);
				} catch {
					// non-JSON SSE payload - ignore keep-alives
				}
			}
		}
		return { rest };
	}

	private _extractStreamText(provider: string, json: any): string {
		if (provider === 'anthropic') {
			return json.type === 'content_block_delta' ? (json.delta?.text ?? '') : '';
		}
		if (json.error) throw new Error(json.error.message ?? String(json.error));
		const delta = json.choices?.[0]?.delta;
		return delta?.content ?? delta?.text ?? '';
	}
}

export function createBridge(config: ReadonlyArray<AiProviderConfig>): AiProviderBridge {
	return new AiProviderBridge(config);
}
