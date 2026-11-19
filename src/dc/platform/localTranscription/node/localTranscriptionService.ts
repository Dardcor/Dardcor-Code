/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { dirname, join } from '../../../base/common/path.js';
import { ensureFoundryLocalRuntime } from './foundryLocalRuntime.js';
import {
	ILocalTranscriptionModelStatus,
	ILocalTranscriptionResult,
	ILocalTranscriptionService,
	DEFAULT_LOCAL_TRANSCRIPTION_MODEL,
	ILocalTranscriptionModelImportResult,
	LocalTranscriptionModelState,
} from '../common/localTranscription.js';
import { importFoundryLocalModel } from './foundryLocalModelImport.js';

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

const FOUNDRY_APP_NAME = 'vscode-dictation';

function runtimeCacheDir(modelCacheDir: string): string {
	return join(dirname(modelCacheDir), 'chatDictationRuntime');
}

type FoundryLocal = typeof import('foundry-local-sdk');
type FoundryLocalManager = import('foundry-local-sdk').FoundryLocalManager;
type IModel = import('foundry-local-sdk').IModel;
type LiveAudioTranscriptionSession = import('foundry-local-sdk').LiveAudioTranscriptionSession;
type LiveAudioTranscriptionResponse = import('foundry-local-sdk').LiveAudioTranscriptionResponse;

function classifyModelError(message: string): string {
	const text = message.toLowerCase();
	if (/\b(404|not found|no such file|does not exist|could not locate|repository not found|unknown model)\b/.test(text)) {
		return 'notFound';
	}
	if (/\b(network|fetch|econn|enotfound|etimedout|socket|dns|offline|proxy|tls|certificate|getaddrinfo|feed)\b/.test(text)) {
		return 'network';
	}
	if (/\b(out of memory|oom|enomem|allocation failed|cannot allocate)\b/.test(text)) {
		return 'memory';
	}
	if (/\b(enospc|no space left|disk)\b/.test(text)) {
		return 'disk';
	}
	if (/\b(eacces|eperm|permission denied|access is denied)\b/.test(text)) {
		return 'permission';
	}
	return 'unknown';
}

function transcriptSeparator(current: string, next: string): '' | ' ' {
	if (!current || !next || /[\s([{]$/.test(current) || /^\s|^[,.;:!?)}\]'"]/.test(next)) {
		return '';
	}
	return ' ';
}

function appendTranscriptChunk(current: string, next: string): string {
	if (!next.trim()) {
		return current;
	}
	if (!current) {
		return next.trimStart();
	}
	return `${current}${next}`;
}

interface IFinalSegment {
	readonly order: number;
	readonly startTime: number | null;
	readonly endTime: number | null;
	text: string;
}

class TranscriptAccumulator {
	private readonly _segments = new Map<string, IFinalSegment>();
	private _nextOrder = 0;

	addFinal(text: string, startTime: number | null, endTime: number | null): void {
		const normalized = text.trim();
		if (!normalized) {
			return;
		}
		const key = (startTime !== null || endTime !== null)
			? `${startTime ?? 'na'}:${endTime ?? 'na'}`
			: `untimed:${this._nextOrder}`;
		const existing = this._segments.get(key);
		if (existing) {
			existing.text = normalized;
			return;
		}
		this._segments.set(key, { order: this._nextOrder, startTime, endTime, text: normalized });
		this._nextOrder++;
	}

	getText(): string {
		return [...this._segments.values()]
			.sort((a, b) => {
				if (a.startTime !== null && b.startTime !== null) {
					return a.startTime - b.startTime;
				}
				if (a.startTime !== null) {
					return -1;
				}
				if (b.startTime !== null) {
					return 1;
				}
				return a.order - b.order;
			})
			.reduce((text, seg) => `${text}${transcriptSeparator(text, seg.text)}${seg.text}`, '')
			.trim();
	}

	reset(): void {
		this._segments.clear();
		this._nextOrder = 0;
	}
}

export class LocalTranscriptionService extends Disposable implements ILocalTranscriptionService {

	declare readonly _serviceBrand: undefined;

	readonly isSupported = true;

	private readonly _onDidChangeModelStatus = this._register(new Emitter<ILocalTranscriptionModelStatus>());
	readonly onDidChangeModelStatus: Event<ILocalTranscriptionModelStatus> = this._onDidChangeModelStatus.event;

	private readonly _onDidTranscribe = this._register(new Emitter<ILocalTranscriptionResult>());
	readonly onDidTranscribe: Event<ILocalTranscriptionResult> = this._onDidTranscribe.event;

	private _status: ILocalTranscriptionModelStatus = { state: LocalTranscriptionModelState.Idle };

	private _sdk: FoundryLocal | undefined;
	private _manager: FoundryLocalManager | undefined;
	private _model: IModel | undefined;
	private _loadedModelId: string | undefined;
	private _modelPromise: Promise<IModel> | undefined;
	private _modelPrepareCts: CancellationTokenSource | undefined;

	private _runtimeDownload: { urlTemplate: string; version: string } | undefined;

	private _session: LiveAudioTranscriptionSession | undefined;
	private _consumePromise: Promise<void> | undefined;
	private _openPromise: Promise<void> | undefined;
	private _sessionActive = false;

	private readonly _accumulator = new TranscriptAccumulator();
	private _partialText = '';
	private _runtimeError: Error | undefined;

	private _pendingChunks: Uint8Array[] = [];

	private _appendChain: Promise<void> = Promise.resolve();

	private _generation = 0;

	constructor() {
		super();
		this._register(toDisposable(() => {
			void this._disposeSession();
			this._modelPrepareCts?.cancel();
			this._modelPrepareCts?.dispose();
			this._modelPrepareCts = undefined;
		}));
	}

	async getModelStatus(): Promise<ILocalTranscriptionModelStatus> {
		return this._status;
	}

	importModel(options: { sourcePath: string; cacheDir: string }): Promise<ILocalTranscriptionModelImportResult> {
		return importFoundryLocalModel(options.sourcePath, options.cacheDir);
	}

	private _setStatus(status: ILocalTranscriptionModelStatus): void {
		this._status = status;
		this._onDidChangeModelStatus.fire(status);
	}

	async start(options: { cacheDir: string; model?: string; language?: string; proxyUrl?: string; noProxy?: string; proxyStrictSSL?: boolean; proxyAuthorization?: string; runtimeUrlTemplate?: string; runtimeVersion?: string }): Promise<void> {
		this._applyProxyEnv(options.proxyUrl, options.noProxy, options.proxyStrictSSL, options.proxyAuthorization);

		this._runtimeDownload = options.runtimeUrlTemplate && options.runtimeVersion
			? { urlTemplate: options.runtimeUrlTemplate, version: options.runtimeVersion }
			: undefined;

		await this._disposeSession();
		this._generation++;
		const generation = this._generation;
		this._sessionActive = true;
		this._accumulator.reset();
		this._partialText = '';
		this._pendingChunks = [];
		this._runtimeError = undefined;

		const model = options.model ?? DEFAULT_LOCAL_TRANSCRIPTION_MODEL;
		const language = options.language;
		this._openPromise = this._openSession(options.cacheDir, model, language, generation);
		this._openPromise.catch(() => { });
	}

	private _applyProxyEnv(proxyUrl: string | undefined, noProxy: string | undefined, proxyStrictSSL: boolean | undefined, proxyAuthorization: string | undefined): void {
		if (proxyStrictSSL === false) {
			process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
		}
		if (!proxyUrl) {
			return;
		}
		const effectiveProxyUrl = this._embedProxyCredentials(proxyUrl, proxyAuthorization);
		process.env.HTTPS_PROXY = effectiveProxyUrl;
		process.env.HTTP_PROXY = effectiveProxyUrl;
		if (noProxy) {
			process.env.NO_PROXY = noProxy;
		}
	}

	private _embedProxyCredentials(proxyUrl: string, proxyAuthorization: string | undefined): string {
		if (!proxyAuthorization) {
			return proxyUrl;
		}
		const basic = /^Basic\s+(?<token>[A-Za-z0-9+/=]+)$/i.exec(proxyAuthorization.trim());
		if (!basic?.groups?.token) {
			return proxyUrl;
		}
		let parsed: URL;
		try {
			parsed = new URL(proxyUrl);
		} catch {
			return proxyUrl;
		}
		if (parsed.username || parsed.password) {
			return proxyUrl;
		}
		const decoded = Buffer.from(basic.groups.token, 'base64').toString('utf8');
		const separator = decoded.indexOf(':');
		if (separator < 0) {
			return proxyUrl;
		}
		parsed.username = encodeURIComponent(decoded.slice(0, separator));
		parsed.password = encodeURIComponent(decoded.slice(separator + 1));
		return parsed.toString();
	}

	private async _openSession(cacheDir: string, modelId: string, language: string | undefined, generation: number): Promise<void> {
		try {
			const model = await this._ensureModel(cacheDir, modelId);
			if (generation !== this._generation) {
				return;
			}

			const audioClient = model.createAudioClient();
			if (language) {
				audioClient.settings.language = language;
			}
			const session = audioClient.createLiveTranscriptionSession();
			session.settings.sampleRate = SAMPLE_RATE;
			session.settings.channels = CHANNELS;
			session.settings.bitsPerSample = BITS_PER_SAMPLE;
			if (language) {
				session.settings.language = language;
			}
			await session.start();

			if (generation !== this._generation) {
				await session.dispose();
				return;
			}

			this._session = session;
			this._setStatus({ state: LocalTranscriptionModelState.Ready });

			this._consumePromise = this._consume(session, generation);

			const buffered = this._pendingChunks;
			this._pendingChunks = [];
			for (const chunk of buffered) {
				if (generation !== this._generation) {
					break;
				}
				this._enqueueAppend(session, generation, chunk).catch(err => {
					if (generation === this._generation) {
						const message = String(err instanceof Error ? err.message : err);
						this._setStatus({ state: LocalTranscriptionModelState.Error, error: message, errorCode: classifyModelError(message) });
					}
				});
			}
		} catch (err) {
			if (generation === this._generation) {
				const message = String(err instanceof Error ? err.message : err);
				this._setStatus({ state: LocalTranscriptionModelState.Error, error: message, errorCode: classifyModelError(message) });
			}
			throw err;
		}
	}

	private _enqueueAppend(session: LiveAudioTranscriptionSession, generation: number, chunk: Uint8Array): Promise<void> {
		const result = this._appendChain.then(() => {
			if (generation !== this._generation || this._session !== session) {
				return;
			}
			return session.append(chunk);
		});
		this._appendChain = result.catch(() => { });
		return result;
	}

	private async _ensureModel(cacheDir: string, modelId: string): Promise<IModel> {
		if (this._model && this._loadedModelId === modelId) {
			return this._model;
		}
		if (this._modelPromise && this._loadedModelId === modelId) {
			return this._modelPromise;
		}

		this._loadedModelId = modelId;
		const cts = new CancellationTokenSource();
		this._modelPrepareCts = cts;
		this._modelPromise = (async () => {
			try {
				this._setStatus({ state: LocalTranscriptionModelState.Loading });

				if (this._runtimeDownload) {
					const nativeDir = await ensureFoundryLocalRuntime(runtimeCacheDir(cacheDir), this._runtimeDownload, cts.token);
					process.env.VSCODE_FOUNDRY_LOCAL_NATIVE_DIR = nativeDir;
				}

				if (!this._sdk) {
					this._sdk = await import('foundry-local-sdk');
				}
				if (!this._manager) {
					this._manager = await this._sdk.FoundryLocalManager.createAsync({
						appName: FOUNDRY_APP_NAME,
						modelCacheDir: cacheDir,
						logLevel: 'warn',
					});
				}

				const model = await this._manager.catalog.getModel(modelId);

				let didDownload = false;
				if (!model.isCached) {
					didDownload = true;
					this._setStatus({ state: LocalTranscriptionModelState.Downloading, progress: 0 });
					const ac = new AbortController();
					const sub = cts.token.onCancellationRequested(() => ac.abort());
					try {
						await model.download((percent: number) => {
							this._setStatus({ state: LocalTranscriptionModelState.Downloading, progress: Math.min(1, Math.max(0, percent / 100)) });
						}, ac.signal);
					} finally {
						sub.dispose();
					}
				}

				if (cts.token.isCancellationRequested) {
					throw new Error('cancelled');
				}
				this._setStatus({ state: LocalTranscriptionModelState.Loading });
				await model.load();

				this._model = model;
				this._setStatus({ state: LocalTranscriptionModelState.Ready, downloaded: didDownload });
				if (this._modelPrepareCts === cts) {
					this._modelPrepareCts = undefined;
				}
				return model;
			} catch (err) {
				this._model = undefined;
				this._modelPromise = undefined;
				this._loadedModelId = undefined;
				if (this._modelPrepareCts === cts) {
					this._modelPrepareCts = undefined;
				}
				throw err;
			}
		})();
		return this._modelPromise;
	}

	private async _consume(session: LiveAudioTranscriptionSession, generation: number): Promise<void> {
		try {
			for await (const result of session.getStream()) {
				if (generation !== this._generation) {
					break;
				}
				const text = this._resultText(result);
				if (result.is_final) {
					this._accumulator.addFinal(text, result.start_time ?? null, result.end_time ?? null);
					this._partialText = '';
				} else {
					this._partialText = appendTranscriptChunk(this._partialText, text);
				}
				if (this._sessionActive) {
					this._onDidTranscribe.fire({ text: this._cumulativeText(), isFinal: false, finalizedText: this._accumulator.getText() });
				}
			}
		} catch (err) {
			if (generation === this._generation && this._sessionActive) {
				const error = err instanceof Error ? err : new Error(String(err));
				this._runtimeError = error;
				this._setStatus({ state: LocalTranscriptionModelState.Error, error: error.message, errorCode: 'runtime' });
			}
		}
	}

	private _cumulativeText(): string {
		const finalized = this._accumulator.getText();
		const partial = this._partialText;
		if (!partial) {
			return finalized;
		}
		if (!finalized) {
			return partial;
		}
		return `${finalized}${transcriptSeparator(finalized, partial)}${partial}`;
	}

	private _resultText(result: LiveAudioTranscriptionResponse): string {
		const part = result.content?.[0];
		return part?.text ?? part?.transcript ?? '';
	}

	async pushAudio(chunk: VSBuffer): Promise<void> {
		if (!this._sessionActive) {
			return;
		}
		const bytes = chunk.buffer;
		const pcm = new Uint8Array(bytes.byteLength);
		pcm.set(bytes);
		if (this._session) {
			await this._enqueueAppend(this._session, this._generation, pcm);
		} else {
			this._pendingChunks.push(pcm);
		}
	}

	async stop(): Promise<string> {
		const generation = this._generation;
		this._sessionActive = false;

		if (this._openPromise) {
			try {
				await this._openPromise;
			} catch {
			}
		}

		if (generation !== this._generation) {
			return '';
		}

		const session = this._session;
		if (!session) {
			const text = this._cumulativeText();
			this._resetSessionState();
			return text;
		}

		try {
			try {
				await this._appendChain;
			} catch { }
			await session.stop();
		} catch {
		}
		if (this._consumePromise) {
			try {
				await this._consumePromise;
			} catch { }
		}

		const runtimeError = this._runtimeError;
		if (runtimeError && generation === this._generation) {
			await this._disposeSession();
			this._resetSessionState();
			throw runtimeError;
		}

		const text = this._cumulativeText();
		if (generation === this._generation) {
			this._onDidTranscribe.fire({ text, isFinal: true, finalizedText: text });
		}
		await this._disposeSession();
		this._resetSessionState();
		return text;
	}

	async cancel(): Promise<void> {
		this._modelPrepareCts?.cancel();
		this._modelPrepareCts = undefined;
		this._sessionActive = false;
		this._generation++;
		await this._disposeSession();
		this._resetSessionState();
	}

	private async _disposeSession(): Promise<void> {
		const session = this._session;
		this._session = undefined;
		const consume = this._consumePromise;
		this._consumePromise = undefined;
		if (session) {
			try {
				await session.dispose();
			} catch { }
		}
		if (consume) {
			try {
				await consume;
			} catch { }
		}
	}

	private _resetSessionState(): void {
		this._sessionActive = false;
		this._accumulator.reset();
		this._partialText = '';
		this._pendingChunks = [];
		this._appendChain = Promise.resolve();
		this._runtimeError = undefined;
	}
}
