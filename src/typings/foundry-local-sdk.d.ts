/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'foundry-local-sdk' {
	export interface FoundryLocalConfig {
		appName?: string;
		cacheDir?: string;
		nativeDir?: string;
		logger?: any;
		telemetry?: any;
		[key: string]: any;
	}

	export interface TranscriptionContentPart {
		text?: string | null;
		transcript?: string | null;
	}

	export interface LiveAudioTranscriptionResponse {
		id?: string | null;
		is_final: boolean;
		content: TranscriptionContentPart[];
		start_time?: number | null;
		end_time?: number | null;
		[key: string]: any;
	}

	export class LiveAudioTranscriptionOptions {
		sampleRate: number;
		channels: number;
		bitsPerSample: number;
		language?: string;
		pushQueueCapacity: number;
	}

	export class LiveAudioTranscriptionSession {
		settings: LiveAudioTranscriptionOptions;
		start(): Promise<void>;
		append(pcmData: Uint8Array): Promise<void>;
		getStream(): AsyncGenerator<LiveAudioTranscriptionResponse>;
		stop(): Promise<void>;
		dispose(): Promise<void>;
		[key: string]: any;
	}

	export interface IModel {
		readonly id: string;
		readonly alias: string;
		readonly isCached: boolean;
		isLoaded(): Promise<boolean>;
		download(progressCallbackOrSignal?: ((progress: number) => void) | AbortSignal, signal?: AbortSignal): Promise<void>;
		load(): Promise<void>;
		removeFromCache(): void;
		unload(): Promise<void>;
		createAudioClient(): any;
		createChatClient(): any;
		createEmbeddingClient(): any;
		createResponsesClient(baseUrl: string): any;
		startLiveAudioTranscriptionSessionAsync?(options?: any, token?: any): Promise<LiveAudioTranscriptionSession>;
		dispose(): Promise<void>;
		[key: string]: any;
	}

	export class FoundryLocalManager {
		static create(config: FoundryLocalConfig): FoundryLocalManager;
		static createAsync(config: FoundryLocalConfig): Promise<FoundryLocalManager>;
		readonly catalog: any;
		readonly urls: string[];
		startWebService(): void;
		stopWebService(): void;
		readonly isWebServiceRunning(): boolean;
		loadModelAsync?(options?: any, token?: any): Promise<IModel>;
		dispose(): Promise<void>;
		[key: string]: any;
	}

	export const Catalog: any;
	export const Model: any;
	export const ModelVariant: any;
	export const ChatClient: any;
	export const AudioClient: any;
	export const EmbeddingClient: any;
	export const ResponsesClient: any;
	export const ModelLoadManager: any;
	export const CoreInterop: any;
	export const Configuration: any;
}
