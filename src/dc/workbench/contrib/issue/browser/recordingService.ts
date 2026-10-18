/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IRecordingData {
	readonly blob: Blob;
	readonly mimeType: string;
	readonly durationMs: number;
	readonly sizeBytes: number;
	readonly stoppedBySize?: boolean;
}

export const enum RecordingState {
	Idle = 'idle',
	Recording = 'recording',
	Stopped = 'stopped',
}

export const IRecordingService = createDecorator<IRecordingService>('recordingService');

export interface IRecordingService {
	readonly _serviceBrand: undefined;

	readonly isSupported: boolean;

	readonly state: RecordingState;

	readonly onDidChangeState: Event<RecordingState>;

	getSupportedFormats(): { mimeType: string; label: string; extension: string }[];

	startRecording(mimeType?: string): Promise<void>;

	stopRecording(): Promise<IRecordingData | undefined>;

	discardRecording(): void;

	getScreenCapturePermissionStatus(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>;

	openScreenCapturePermissionSettings(): void;
}

export class BrowserRecordingService implements IRecordingService {
	readonly _serviceBrand: undefined;
	readonly isSupported = false;
	readonly state = RecordingState.Idle;
	readonly onDidChangeState = Event.None;

	getSupportedFormats(): { mimeType: string; label: string; extension: string }[] {
		return [];
	}

	async startRecording(_mimeType?: string): Promise<void> {
		throw new Error('Recording is not supported in web browsers.');
	}

	async stopRecording(): Promise<IRecordingData | undefined> {
		return undefined;
	}

	discardRecording(): void {
	}

	async getScreenCapturePermissionStatus(): Promise<'granted'> {
		return 'granted';
	}

	openScreenCapturePermissionSettings(): void {
	}
}
