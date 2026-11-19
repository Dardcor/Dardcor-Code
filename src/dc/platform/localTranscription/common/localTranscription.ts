/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const ILocalTranscriptionService = createDecorator<ILocalTranscriptionService>('localTranscriptionService');

export const localTranscriptionChannelName = 'localTranscription';

export const DEFAULT_LOCAL_TRANSCRIPTION_MODEL = 'nemotron-3.5-asr-streaming-0.6b';

export interface ILocalTranscriptionModelImportResult {
	readonly model: string;
	readonly version: number;
}

export const enum LocalTranscriptionModelState {
	Idle = 'idle',
	Downloading = 'downloading',
	Loading = 'loading',
	Ready = 'ready',
	Error = 'error',
}

export interface ILocalTranscriptionModelStatus {
	readonly state: LocalTranscriptionModelState;
	readonly progress?: number;
	readonly downloaded?: boolean;
	readonly error?: string;
	readonly errorCode?: string;
}

export interface ILocalTranscriptionResult {
	readonly text: string;
	readonly isFinal: boolean;
	readonly finalizedText?: string;
}


export interface ILocalTranscriptionService {
	readonly _serviceBrand: undefined;

	readonly isSupported: boolean;

	readonly onDidChangeModelStatus: Event<ILocalTranscriptionModelStatus>;

	readonly onDidTranscribe: Event<ILocalTranscriptionResult>;

	getModelStatus(): Promise<ILocalTranscriptionModelStatus>;

	importModel(options: { readonly sourcePath: string; readonly cacheDir: string }): Promise<ILocalTranscriptionModelImportResult>;

	start(options: { readonly cacheDir: string; readonly model?: string; readonly language?: string; readonly proxyUrl?: string; readonly noProxy?: string; readonly proxyStrictSSL?: boolean; readonly proxyAuthorization?: string; readonly runtimeUrlTemplate?: string; readonly runtimeVersion?: string }): Promise<void>;

	pushAudio(chunk: VSBuffer): Promise<void>;

	stop(): Promise<string>;

	cancel(): Promise<void>;
}
