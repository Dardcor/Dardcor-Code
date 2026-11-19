/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IRecordingData, IRecordingService, RecordingState } from '../browser/recordingService.js';

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const SIZE_LIMIT_THRESHOLD = 0.9;

export class NativeRecordingService extends Disposable implements IRecordingService {
	readonly _serviceBrand: undefined;
	readonly isSupported = typeof MediaRecorder !== 'undefined'
		&& typeof navigator !== 'undefined'
		&& !!navigator.mediaDevices?.getDisplayMedia;

	private _state = RecordingState.Idle;
	private readonly _onDidChangeState = this._register(new Emitter<RecordingState>());
	readonly onDidChangeState: Event<RecordingState> = this._onDidChangeState.event;

	private mediaRecorder: MediaRecorder | undefined;
	private mediaStream: MediaStream | undefined;
	private chunks: Blob[] = [];
	private bytesRecorded = 0;
	private stoppedBySize = false;
	private startTime = 0;

	constructor(
		@ILogService private readonly logService: ILogService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		super();

		this._register(toDisposable(() => this.cleanup()));
	}

	getScreenCapturePermissionStatus(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'> {
		return this.nativeHostService.getMediaAccessStatus('screen');
	}

	openScreenCapturePermissionSettings(): void {
		if (isMacintosh) {
			void this.nativeHostService.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
		}
	}

	get state(): RecordingState {
		return this._state;
	}

	private setState(state: RecordingState): void {
		if (this._state !== state) {
			this._state = state;
			this._onDidChangeState.fire(state);
		}
	}

	getSupportedFormats(): { mimeType: string; label: string; extension: string }[] {
		const formats: { mimeType: string; label: string; extension: string }[] = [];
		if (typeof MediaRecorder !== 'undefined') {
			if (MediaRecorder.isTypeSupported('video/mp4')) {
				formats.push({ mimeType: 'video/mp4', label: 'MP4', extension: 'mp4' });
			}
			if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
				formats.push({ mimeType: 'video/webm;codecs=vp9', label: 'WebM', extension: 'webm' });
			} else if (MediaRecorder.isTypeSupported('video/webm')) {
				formats.push({ mimeType: 'video/webm', label: 'WebM', extension: 'webm' });
			}
		}
		return formats;
	}

	async startRecording(preferredMimeType?: string): Promise<void> {
		if (!this.isSupported) {
			throw new Error('Recording is not supported in this environment (MediaRecorder / getDisplayMedia unavailable).');
		}
		if (this._state === RecordingState.Recording) {
			throw new Error('Recording already in progress.');
		}

		this.cleanup();

		try {
			this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: false,
			});
		} catch (err) {
			this.logService.error('[RecordingService] Failed to get display media:', err);
			throw new Error('Failed to start recording. The user may have cancelled the source picker.');
		}

		let mimeType: string;
		if (preferredMimeType && MediaRecorder.isTypeSupported(preferredMimeType)) {
			mimeType = preferredMimeType;
		} else if (MediaRecorder.isTypeSupported('video/mp4')) {
			mimeType = 'video/mp4';
		} else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
			mimeType = 'video/webm;codecs=vp9';
		} else {
			mimeType = 'video/webm';
		}

		this.chunks = [];
		this.bytesRecorded = 0;
		this.stoppedBySize = false;
		this.startTime = Date.now();

		try {
			this.mediaRecorder = new MediaRecorder(this.mediaStream, {
				mimeType,
				videoBitsPerSecond: 2_500_000,
			});
		} catch (err) {
			this.logService.error('[RecordingService] Failed to create MediaRecorder:', err);
			this.stopTracks();
			throw new Error('Failed to create media recorder.');
		}

		this.mediaRecorder.ondataavailable = e => {
			if (e.data && e.data.size > 0) {
				if (this.stoppedBySize) {
					return;
				}
				this.chunks.push(e.data);
				this.bytesRecorded += e.data.size;
				if (this.bytesRecorded >= MAX_FILE_SIZE_BYTES * SIZE_LIMIT_THRESHOLD && this._state === RecordingState.Recording) {
					this.logService.info('[RecordingService] Max file size reached, stopping recording.');
					this.stoppedBySize = true;
					this.mediaRecorder?.stop();
				}
			}
		};

		this.mediaRecorder.onstop = () => {
			if (this._state === RecordingState.Recording) {
				this.stopTracks();
				this.setState(RecordingState.Stopped);
			}
		};

		for (const track of this.mediaStream.getTracks()) {
			track.onended = () => {
				if (this._state === RecordingState.Recording && this.mediaRecorder?.state === 'recording') {
					this.mediaRecorder.stop();
				}
			};
		}

		this.mediaRecorder.start(1000);
		this.setState(RecordingState.Recording);
	}

	async stopRecording(): Promise<IRecordingData | undefined> {
		if (this._state !== RecordingState.Recording && this._state !== RecordingState.Stopped) {
			return undefined;
		}

		if (this._state === RecordingState.Recording && this.mediaRecorder?.state === 'recording') {
			const recorder = this.mediaRecorder;
			await new Promise<void>(resolve => {
				recorder.onstop = () => {
					resolve();
				};
				recorder.requestData();
				recorder.stop();
			});
		}

		this.stopTracks();

		if (this.chunks.length === 0) {
			this.setState(RecordingState.Idle);
			return undefined;
		}

		const mimeType = this.mediaRecorder?.mimeType ?? 'video/webm';
		const blob = new Blob(this.chunks, { type: mimeType });
		const durationMs = Date.now() - this.startTime;

		const data: IRecordingData = {
			blob,
			mimeType,
			durationMs,
			sizeBytes: blob.size,
			stoppedBySize: this.stoppedBySize,
		};

		this.chunks = [];
		this.mediaRecorder = undefined;
		this.setState(RecordingState.Idle);

		return data;
	}

	discardRecording(): void {
		if (this.mediaRecorder) {
			this.mediaRecorder.ondataavailable = null;
			this.mediaRecorder.onstop = null;
			if (this._state === RecordingState.Recording && this.mediaRecorder.state === 'recording') {
				this.mediaRecorder.stop();
			}
		}
		this.cleanup();
		this.setState(RecordingState.Idle);
	}

	private stopTracks(): void {
		if (this.mediaStream) {
			for (const track of this.mediaStream.getTracks()) {
				track.stop();
			}
			this.mediaStream = undefined;
		}
	}

	private cleanup(): void {
		this.stopTracks();
		this.chunks = [];
		this.bytesRecorded = 0;
		this.stoppedBySize = false;
		this.mediaRecorder = undefined;
	}
}
