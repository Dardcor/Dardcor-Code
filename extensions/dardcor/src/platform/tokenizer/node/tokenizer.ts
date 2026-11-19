/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OutputMode, Raw, toMode } from '@vscode/prompt-tsx';
import type { LanguageModelChatTool } from 'vscode';
import { LRUCache } from '../../../util/common/cache';
import { getImageDimensions } from '../../../util/common/imageUtils';
import { createServiceIdentifier } from '../../../util/common/services';
import { ITokenizer, TokenizerType } from '../../../util/common/tokenizer';
import { WorkerWithRpcProxy } from '../../../util/node/worker';
import { assertNever } from '../../../util/dardcor/base/common/assert';
import { Lazy } from '../../../util/dardcor/base/common/lazy';
import { Disposable, toDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { basename, join } from '../../../util/dardcor/base/common/path';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { TikTokenImpl } from './tikTokenizerImpl';

export const ITokenizerProvider = createServiceIdentifier<ITokenizerProvider>('ITokenizerProvider');

export interface TokenizationEndpoint {
	readonly tokenizer: TokenizerType;
}

export interface ITokenizerProvider {
	readonly _serviceBrand: undefined;

	acquireTokenizer(endpoint: TokenizationEndpoint): ITokenizer;
}

export const BaseTokensPerCompletion = 3;
export const BaseTokensPerMessage = 3;
export const BaseTokensPerName = 1;


export class TokenizerProvider implements ITokenizerProvider {
	declare readonly _serviceBrand: undefined;

	private readonly _cl100kTokenizer: Lazy<BPETokenizer>;
	private readonly _o200kTokenizer: Lazy<BPETokenizer>;

	constructor(
		useWorker: boolean,
		@ITelemetryService telmetryService: ITelemetryService
	) {
		this._cl100kTokenizer = new Lazy(() => new BPETokenizer(useWorker, join(__dirname, './cl100k_base.tiktoken'), 'cl100k_base', telmetryService));
		this._o200kTokenizer = new Lazy(() => new BPETokenizer(useWorker, join(__dirname, './o200k_base.tiktoken'), 'o200k_base', telmetryService));
	}

	dispose() {
		this._cl100kTokenizer.rawValue?.dispose();
		this._o200kTokenizer.rawValue?.dispose();
	}

	public acquireTokenizer(endpoint: TokenizationEndpoint): ITokenizer {
		switch (endpoint.tokenizer) {
			case TokenizerType.CL100K:
				return this._cl100kTokenizer.value;
			case TokenizerType.O200K:
				return this._o200kTokenizer.value;
			default:
				throw new Error(`Unknown tokenizer: ${endpoint.tokenizer}`);
		}
	}
}

type TikTokenWorker = {
	encode(text: string, allowedSpecial?: ReadonlyArray<string>): Promise<number[]>;
};

class BPETokenizer extends Disposable implements ITokenizer {

	private _tokenizer?: Promise<TikTokenWorker>;

	private readonly _cache = new LRUCache<number>(5000);

	protected readonly baseTokensPerMessage = BaseTokensPerMessage;
	protected readonly baseTokensPerName = BaseTokensPerName;

	public readonly mode = OutputMode.Raw;

	constructor(
		private readonly _useWorker: boolean,
		private readonly _tokenFilePath: string,
		private readonly _encoderName: string,
		@ITelemetryService private readonly _telemetryService: ITelemetryService
	) {
		super();
	}

	async countMessagesTokens(messages: Raw.ChatMessage[]): Promise<number> {
		let numTokens = BaseTokensPerMessage;
		for (const message of messages) {
			numTokens += await this.countMessageTokens(message);
		}
		return numTokens;
	}

	private async tokenize(text: string): Promise<number[]> {
		return (await this.ensureTokenizer()).encode(text);
	}

	async tokenLength(text: string | Raw.ChatCompletionContentPart): Promise<number> {
		if (typeof text === 'string') {
			return this._textTokenLength(text);
		}

		switch (text.type) {
			case Raw.ChatCompletionContentPartKind.Text:
				return this._textTokenLength(text.text);
			case Raw.ChatCompletionContentPartKind.Opaque:
				return text.tokenUsage || 0;
			case Raw.ChatCompletionContentPartKind.Image:
				if (text.imageUrl.url.startsWith('data:image/')) {
					try {
						return calculateImageTokenCost(text.imageUrl.url, text.imageUrl.detail);
					} catch {
						return this._textTokenLength(text.imageUrl.url);
					}
				}
				return this._textTokenLength(text.imageUrl.url);
			case Raw.ChatCompletionContentPartKind.CacheBreakpoint:
				return 0;
			case Raw.ChatCompletionContentPartKind.Document:
				return estimateDocumentTokenCost(text.documentData.data);
			default:
				assertNever(text, `unknown content part (${JSON.stringify(text)})`);
		}
	}

	private async _textTokenLength(text: string) {
		if (!text) {
			return 0;
		}
		let cacheValue = this._cache.get(text);
		if (!cacheValue) {
			cacheValue = (await this.tokenize(text)).length;
			this._cache.put(text, cacheValue);
		}
		return cacheValue;
	}

	async countMessageTokens(message: Raw.ChatMessage): Promise<number> {
		return this.baseTokensPerMessage + (await this.countMessageObjectTokens(toMode(OutputMode.OpenAI, message)));
	}

	async countToolTokens(tools: LanguageModelChatTool[]): Promise<number> {
		const baseToolTokens = 16;
		let numTokens = 0;
		if (tools.length) {
			numTokens += baseToolTokens;
		}

		const baseTokensPerTool = 8;
		for (const tool of tools) {
			numTokens += baseTokensPerTool;
			numTokens += await this.countObjectTokens({ name: tool.name, description: tool.description, parameters: tool.inputSchema });
		}

		return Math.floor(numTokens * 1.1);
	}

	private async countMessageObjectTokens(obj: any): Promise<number> {
		let numTokens = 0;
		for (const [key, value] of Object.entries(obj)) {
			if (!value) {
				continue;
			}

			if (typeof value === 'string') {
				numTokens += await this.tokenLength(value);
			} else if (value) {
				const casted = value as any;
				if (casted.type === 'text') {
					numTokens += await this.tokenLength(casted.text);
				} else if (casted.type === 'image_url' && casted.image_url) {
					if (casted.image_url.url.startsWith('data:image/')) {
						try {
							numTokens += calculateImageTokenCost(casted.image_url.url, casted.image_url.detail);
						} catch {
							numTokens += await this.tokenLength(casted.image_url.url);
						}
					} else {
						numTokens += await this.tokenLength(casted.image_url.url);
					}
				} else {
					let newTokens = await this.countMessageObjectTokens(value);
					if (key === 'tool_calls') {
						newTokens = Math.floor(newTokens * 1.5);
					}

					numTokens += newTokens;
				}
			}

			if (key === 'name' && value !== undefined) {
				numTokens += this.baseTokensPerName;
			}
		}

		return numTokens;
	}

	private async countObjectTokens(obj: any): Promise<number> {
		let numTokens = 0;
		for (const [key, value] of Object.entries(obj)) {
			if (!value) {
				continue;
			}

			numTokens += await this.tokenLength(key);
			if (typeof value === 'string') {
				numTokens += await this.tokenLength(value);
			} else if (value) {
				numTokens += await this.countMessageObjectTokens(value);
			}
		}

		return numTokens;
	}

	private ensureTokenizer(): Promise<TikTokenWorker> {
		this._tokenizer ??= this.doInitTokenizer();
		return this._tokenizer;
	}

	private async doInitTokenizer(): Promise<TikTokenWorker> {

		const useBinaryTokens = basename(__dirname) === 'dist';

		if (!this._useWorker) {
			const handle = TikTokenImpl.instance.init(this._tokenFilePath, this._encoderName, useBinaryTokens);

			const cleanup = toDisposable(() => {
				TikTokenImpl.instance.destroy(handle);
				this._store.deleteAndLeak(cleanup);
				this._tokenizer = undefined;
			});
			this._store.add(cleanup);

			return {
				encode: async (text, allowedSpecial) => {
					return TikTokenImpl.instance.encode(handle, text, allowedSpecial);
				}
			};
		} else {

			const workerPath = join(__dirname, 'tikTokenizerWorker.js');
			const worker = new WorkerWithRpcProxy<TikTokenImpl>(workerPath, { name: `TikToken worker (${this._encoderName})` });
			const handle = await worker.proxy.init(this._tokenFilePath, this._encoderName, useBinaryTokens);

			const cleanup = toDisposable(() => {
				worker.terminate();
				this._store.deleteAndLeak(cleanup);
				this._tokenizer = undefined;
			});

			let timeout: TimeoutHandle;

			return {
				encode: (text, allowedSpecial) => {
					const result = worker.proxy.encode(handle, text, allowedSpecial);

					clearTimeout(timeout);
					timeout = setTimeout(() => cleanup.dispose(), 15000);

					if (Math.random() < 1 / 1000) {
						worker.proxy.resetStats().then(stats => {
							this._telemetryService.sendMSFTTelemetryEvent('tokenizer.stats', undefined, stats);
						});
					}

					return result;
				}
			};
		}
	}
}



export function calculateImageTokenCost(imageUrl: string, detail: 'low' | 'high' | 'auto' | undefined): number {
	let { width, height } = getImageDimensions(imageUrl);

	if (detail === 'low') {
		return 85;
	}

	if (width > 2048 || height > 2048) {
		const scaleFactor = 2048 / Math.max(width, height);
		width = Math.round(width * scaleFactor);
		height = Math.round(height * scaleFactor);
	}

	const scaleFactor = 768 / Math.min(width, height);
	width = Math.round(width * scaleFactor);
	height = Math.round(height * scaleFactor);

	const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);

	return tiles * 170 + 85;
}

export function estimateDocumentTokenCost(base64Data: string | undefined): number {
	if (!base64Data) {
		return 0;
	}
	const length = base64Data.length;
	const estimatedBytes = Math.floor((length * 3) / 4);
	const estimatedTokens = Math.ceil(estimatedBytes / 8);
	return estimatedTokens;
}

