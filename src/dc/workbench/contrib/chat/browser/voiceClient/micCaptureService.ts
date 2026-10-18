/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { addDisposableListener } from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { localize } from '../../../../../nls.js';
import { AgentsVoiceStorageKeys } from '../../../../contrib/agentsVoice/common/agentsVoice.js';
import { createPcmCaptureNode } from '../pcmCaptureWorklet.js';
import { mainWindow } from '../../../../../base/browser/window.js';

export const IMicCaptureService = createDecorator<IMicCaptureService>('micCaptureService');

export function getMediaCaptureWindow(targetWindow: Window & typeof globalThis): Window & typeof globalThis {
	return targetWindow === mainWindow ? targetWindow : mainWindow;
}

export const MIC_CAPTURE_CHUNK_SIZE = 512;

export function isMicrophonePermissionDeniedError(error: unknown): boolean {
	return (error instanceof DOMException || error instanceof Error) && error.name === 'NotAllowedError';
}

export interface IPttDiagnostic {
	readonly turnId: string;
	readonly msHeld: number;
	readonly chunksSent: number;
	readonly samplesSent: number;
	readonly drainFired: boolean;
	readonly drainChunks: number;
	readonly drainSamples: number;
	readonly drainWindowMs: number;
	readonly drainSkippedByMute: number;
	readonly drainSkippedBySuppression: number;
	readonly postReleaseCallbacks: number;
	readonly postReleaseSamples: number;
	readonly postReleaseSkippedByMute: number;
	readonly postReleaseSkippedBySuppression: number;
	readonly postReleaseWindowMs: number;
	readonly releasedDuringAcquire: boolean;
	readonly pttUpWithoutCapture: boolean;
}

export interface IMicCaptureService {
	readonly _serviceBrand: undefined;

	prepare(window: Window & typeof globalThis): void;

	startCapture(window: Window & typeof globalThis): Promise<void>;

	stopCapture(): void;

	readonly isCapturing: boolean;

	readonly onPttStart: Event<boolean>;

	readonly onPttAudioChunk: Event<string>;

	readonly onPttEnd: Event<void>;

	readonly onPttDiagnostic: Event<IPttDiagnostic>;

	readonly analyserNode: AnalyserNode | undefined;

	pttDown(turnId: string, passive?: boolean): Promise<void>;

	pttUp(): void;

	abortPtt(): void;

	isMuted: boolean;

	suppressUntil(timestamp: number): void;
}

export class MicCaptureService extends Disposable implements IMicCaptureService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	private _window: (Window & typeof globalThis) | undefined;
	private _micStream: MediaStream | null = null;
	private _micCtx: AudioContext | undefined;
	private _workletNode: AudioWorkletNode | undefined;
	private _analyserNode: AnalyserNode | undefined;
	private _isCapturing = false;
	private _captureGeneration = 0;
	private _capturePromise: Promise<void> | undefined;
	private _pttGeneration = 0;
	private _pttHeld = false;
	private _pttStreaming = false;
	private _isMuted = false;
	private _suppressUntilTs = 0;
	private _pttAcquiring = false;
	private _pttReleasedDuringAcquire = false;

	private readonly _micTrackListeners = this._register(new DisposableStore());
	private _micMutedNotified = false;

	private static readonly _PTT_DRAIN_WINDOW_MS = 500;
	private _pttDrainTargetSamples = 0;
	private _pttDrainSamplesSent = 0;
	private _pttDrainFallbackTimer: ReturnType<typeof setTimeout> | undefined;

	private static readonly _DIAG_POST_RELEASE_WINDOW_MS = 1000;
	private _diagTurnId = '';
	private _diagPttDownTs = 0;
	private _diagPttUpTs = 0;
	private _diagChunksSent = 0;
	private _diagSamplesSent = 0;
	private _diagDrainFired = false;
	private _diagDrainChunks = 0;
	private _diagDrainSamples = 0;
	private _diagDrainSkippedByMute = 0;
	private _diagDrainSkippedBySuppression = 0;
	private _diagPostReleaseCallbacks = 0;
	private _diagPostReleaseSamples = 0;
	private _diagPostReleaseSkippedByMute = 0;
	private _diagPostReleaseSkippedBySuppression = 0;
	private _diagReleasedDuringAcquire = false;
	private _diagPttUpWithoutCapture = false;
	private _diagFireTimer: ReturnType<typeof setTimeout> | undefined;

	private readonly _onPttStart = this._register(new Emitter<boolean>());
	readonly onPttStart: Event<boolean> = this._onPttStart.event;

	private readonly _onPttAudioChunk = this._register(new Emitter<string>());
	readonly onPttAudioChunk: Event<string> = this._onPttAudioChunk.event;

	private readonly _onPttEnd = this._register(new Emitter<void>());
	readonly onPttEnd: Event<void> = this._onPttEnd.event;

	private readonly _onPttDiagnostic = this._register(new Emitter<IPttDiagnostic>());
	readonly onPttDiagnostic: Event<IPttDiagnostic> = this._onPttDiagnostic.event;

	get isCapturing(): boolean { return this._isCapturing; }
	get analyserNode(): AnalyserNode | undefined { return this._analyserNode; }

	get isMuted(): boolean { return this._isMuted; }
	set isMuted(value: boolean) { this._isMuted = value; }

	suppressUntil(timestamp: number): void {
		this._suppressUntilTs = timestamp;
	}

	protected getMediaCaptureWindow(targetWindow: Window & typeof globalThis): Window & typeof globalThis {
		return getMediaCaptureWindow(targetWindow);
	}

	prepare(window: Window & typeof globalThis): void {
		this._window = this.getMediaCaptureWindow(window);
	}

	async pttDown(turnId: string, passive: boolean = false): Promise<void> {
		if (this._pttHeld) { return; }
		const pttGeneration = ++this._pttGeneration;
		this._finishDrain();
		this._flushPendingDiagnostic();
		this._resetDiagnosticCounters(turnId);
		this._pttHeld = true;
		this._pttStreaming = true;
		this._pttReleasedDuringAcquire = false;
		this._isMuted = false;

		if (this._isCapturing) {
			this._onPttStart.fire(passive);
			return;
		}
		if (!this._window) { return; }
		if (this._pttAcquiring) { return; }

		this._pttAcquiring = true;
		try {
			await this.startCapture(this._window);
		} catch (err) {
			if (pttGeneration !== this._pttGeneration) {
				return;
			}
			this._pttHeld = false;
			this._pttStreaming = false;
			this._pttReleasedDuringAcquire = false;
			throw err;
		} finally {
			if (pttGeneration === this._pttGeneration) {
				this._pttAcquiring = false;
			}
		}
		if (pttGeneration !== this._pttGeneration || !this._isCapturing || !this._pttHeld) {
			this._pttReleasedDuringAcquire = false;
			return;
		}
		this._onPttStart.fire(passive);

		if (this._pttReleasedDuringAcquire) {
			this._pttReleasedDuringAcquire = false;
			this._pttStreaming = false;
			this._diagReleasedDuringAcquire = true;
			this._onPttEnd.fire();
			this.stopCapture();
			this._scheduleDiagnosticFire();
		}
	}

	pttUp(): void {
		if (!this._pttHeld) { return; }

		if (this._pttAcquiring) {
			this._pttReleasedDuringAcquire = true;
			this._diagReleasedDuringAcquire = true;
			this._diagPttUpTs = Date.now();
			this._scheduleDiagnosticFire();
			return;
		}

		if (!this._isCapturing) {
			this._pttHeld = false;
			this._pttStreaming = false;
			this._diagPttUpWithoutCapture = true;
			this._diagPttUpTs = Date.now();
			this._scheduleDiagnosticFire();
			return;
		}

		this._pttHeld = false;
		this._diagPttUpTs = Date.now();
		const sampleRate = this._micCtx?.sampleRate ?? 16000;
		this._pttDrainTargetSamples = Math.ceil(
			sampleRate * MicCaptureService._PTT_DRAIN_WINDOW_MS / 1000
		);
		this._pttDrainSamplesSent = 0;
		this._pttDrainFallbackTimer = setTimeout(() => {
			this._pttDrainFallbackTimer = undefined;
			this._finishDrain();
		}, MicCaptureService._PTT_DRAIN_WINDOW_MS + 250);
		this._scheduleDiagnosticFire();
	}

	abortPtt(): void {
		if (!this._pttHeld && !this._pttStreaming) { return; }
		if (this._pttDrainFallbackTimer) {
			clearTimeout(this._pttDrainFallbackTimer);
			this._pttDrainFallbackTimer = undefined;
		}
		this._pttDrainTargetSamples = 0;
		this._pttDrainSamplesSent = 0;
		this._pttGeneration++;
		this._pttAcquiring = false;
		this._pttHeld = false;
		this._pttStreaming = false;
		this._pttReleasedDuringAcquire = false;
		this._diagPttUpTs = Date.now();
		this._scheduleDiagnosticFire();
	}

	async startCapture(window: Window & typeof globalThis): Promise<void> {
		const captureWindow = this.getMediaCaptureWindow(window);
		this._window = captureWindow;
		if (this._isCapturing) { return; }
		if (this._capturePromise) {
			return this._capturePromise;
		}
		const capturePromise = this._startCapture(captureWindow);
		this._capturePromise = capturePromise;
		try {
			await capturePromise;
		} finally {
			if (this._capturePromise === capturePromise) {
				this._capturePromise = undefined;
			}
		}
	}

	private async _startCapture(window: Window & typeof globalThis): Promise<void> {
		const captureGeneration = this._captureGeneration;
		const deviceId = this.storageService.get(AgentsVoiceStorageKeys.MicrophoneDevice, StorageScope.APPLICATION);
		const audioConstraints: MediaTrackConstraints = {
			channelCount: 1,
			sampleRate: 16000,
			echoCancellation: true,
			noiseSuppression: true,
		};
		if (deviceId) {
			audioConstraints.deviceId = { exact: deviceId };
		}

		let micStream: MediaStream;
		try {
			micStream = await window.navigator.mediaDevices.getUserMedia({
				audio: audioConstraints,
			});
		} catch (err) {
			const isDeviceError = deviceId && err instanceof DOMException &&
				(err.name === 'OverconstrainedError' || err.name === 'NotFoundError');
			if (isDeviceError) {
				this.logService.warn(`[mic] Preferred device ${deviceId.slice(0, 8)}… unavailable, falling back to default`);
				delete audioConstraints.deviceId;
				try {
					micStream = await window.navigator.mediaDevices.getUserMedia({
						audio: audioConstraints,
					});
				} catch (retryErr) {
					this._notifyMicPermissionDenied(retryErr);
					throw retryErr;
				}
			} else {
				this._notifyMicPermissionDenied(err);
				throw err;
			}
		}
		if (captureGeneration !== this._captureGeneration) {
			micStream.getTracks().forEach(track => track.stop());
			return;
		}
		this._micStream = micStream;

		const cleanupFailedCapture = () => {
			if (this._micStream === micStream) {
				this._stopCaptureResources();
			} else {
				micStream.getTracks().forEach(track => track.stop());
			}
		};

		let ctx: AudioContext;
		let source: MediaStreamAudioSourceNode;
		try {
			this._micTrackListeners.clear();
			this._micMutedNotified = false;
			const audioTrack = micStream.getAudioTracks()[0];
			if (audioTrack) {
				if (audioTrack.muted) {
					this._notifyMicrophoneMuted();
				}
				this._micTrackListeners.add(addDisposableListener(audioTrack, 'mute', () => this._notifyMicrophoneMuted()));
				this._micTrackListeners.add(addDisposableListener(audioTrack, 'unmute', () => { this._micMutedNotified = false; }));
			}

			if (!this._micCtx) {
				this._micCtx = new window.AudioContext({ sampleRate: 16000 });
			}
			ctx = this._micCtx;
			source = ctx.createMediaStreamSource(micStream);

			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);
			this._analyserNode = analyser;
		} catch (err) {
			cleanupFailedCapture();
			throw err;
		}

		const captureNodePromise = createPcmCaptureNode(window, ctx, MIC_CAPTURE_CHUNK_SIZE, samples => {
			const nowTs = Date.now();
			const ptUpTs = this._diagPttUpTs;
			const isDrainCallback = this._pttStreaming && !this._pttHeld;
			const inDiagWindow =
				ptUpTs > 0 &&
				!this._pttHeld &&
				nowTs <= ptUpTs + MicCaptureService._DIAG_POST_RELEASE_WINDOW_MS;
			const isPostReleaseCallback = !this._pttStreaming && inDiagWindow;

			if (this._isMuted) {
				if (isDrainCallback) { this._diagDrainSkippedByMute++; }
				if (isPostReleaseCallback) { this._diagPostReleaseSkippedByMute++; }
				return;
			}

			if (nowTs < this._suppressUntilTs) {
				if (isDrainCallback) { this._diagDrainSkippedBySuppression++; }
				if (isPostReleaseCallback) { this._diagPostReleaseSkippedBySuppression++; }
				return;
			}

			if (!this._pttStreaming) {
				if (isPostReleaseCallback) {
					this._diagPostReleaseCallbacks++;
					this._diagPostReleaseSamples += samples.length;
				}
				return;
			}

			const b64 = encodeRawPcm16Base64(samples, this._window!);
			this._diagChunksSent++;
			this._diagSamplesSent += samples.length;
			if (isDrainCallback) {
				this._diagDrainFired = true;
				this._diagDrainChunks++;
				this._diagDrainSamples += samples.length;
				this._pttDrainSamplesSent += samples.length;
			}
			this._onPttAudioChunk.fire(b64);

			if (isDrainCallback && this._pttDrainSamplesSent >= this._pttDrainTargetSamples) {
				this._finishDrain();
			}
		});

		let node: AudioWorkletNode;
		try {
			node = (await captureNodePromise).node;
		} catch (err) {
			cleanupFailedCapture();
			throw err;
		}

		if (this._micCtx !== ctx) {
			try { node.disconnect(); } catch { }
			return;
		}

		try {
			this._workletNode = node;
			source.connect(node);
			node.connect(ctx.destination);
			this._isCapturing = true;
		} catch (err) {
			cleanupFailedCapture();
			throw err;
		}
	}

	private _notifyMicPermissionDenied(err: unknown): void {
		if (isMicrophonePermissionDeniedError(err)) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('mic.permissionDenied', "Microphone access was denied. Grant microphone permission in your system settings to use Voice Mode."),
			});
		}
	}

	private _notifyMicrophoneMuted(): void {
		if (this._micMutedNotified) {
			return;
		}
		this._micMutedNotified = true;
		this.logService.warn('[mic] Microphone track is muted — likely a hardware mute switch is enabled');
		this.notificationService.notify({
			severity: Severity.Warning,
			message: localize('mic.hardwareMuted', "Your microphone appears to be muted or disabled, possibly by a hardware switch. Voice Mode won't hear you until it's re-enabled."),
		});
	}

	private _stopCaptureResources(): void {
		this._captureGeneration++;
		this._capturePromise = undefined;
		if (this._workletNode) {
			this._workletNode.port.onmessage = null;
			try { this._workletNode.disconnect(); } catch { }
			this._workletNode = undefined;
		}
		this._analyserNode = undefined;
		this._micCtx?.close();
		this._micCtx = undefined;
		if (this._micStream) {
			this._micStream.getTracks().forEach(t => t.stop());
			this._micStream = null;
		}
		this._micTrackListeners.clear();
		this._micMutedNotified = false;
		this._isCapturing = false;
	}

	stopCapture(): void {
		this._stopCaptureResources();
		this._pttGeneration++;
		this._pttAcquiring = false;
		if (this._pttDrainFallbackTimer) {
			clearTimeout(this._pttDrainFallbackTimer);
			this._pttDrainFallbackTimer = undefined;
		}
		this._pttDrainTargetSamples = 0;
		this._pttDrainSamplesSent = 0;
		this._pttHeld = false;
		this._pttStreaming = false;
		this._pttReleasedDuringAcquire = false;
	}

	override dispose(): void {
		if (this._diagFireTimer) {
			clearTimeout(this._diagFireTimer);
			this._diagFireTimer = undefined;
		}
		if (this._pttDrainFallbackTimer) {
			clearTimeout(this._pttDrainFallbackTimer);
			this._pttDrainFallbackTimer = undefined;
		}
		this.stopCapture();
		super.dispose();
	}

	private _finishDrain(): void {
		if (this._pttDrainFallbackTimer) {
			clearTimeout(this._pttDrainFallbackTimer);
			this._pttDrainFallbackTimer = undefined;
		}
		this._pttDrainTargetSamples = 0;
		this._pttDrainSamplesSent = 0;
		if (this._pttStreaming && !this._pttHeld) {
			this._pttStreaming = false;
			this._onPttEnd.fire();
		}
	}

	private _resetDiagnosticCounters(turnId: string): void {
		this._diagTurnId = turnId;
		this._diagPttDownTs = Date.now();
		this._diagPttUpTs = 0;
		this._diagChunksSent = 0;
		this._diagSamplesSent = 0;
		this._diagDrainFired = false;
		this._diagDrainChunks = 0;
		this._diagDrainSamples = 0;
		this._diagDrainSkippedByMute = 0;
		this._diagDrainSkippedBySuppression = 0;
		this._diagPostReleaseCallbacks = 0;
		this._diagPostReleaseSamples = 0;
		this._diagPostReleaseSkippedByMute = 0;
		this._diagPostReleaseSkippedBySuppression = 0;
		this._diagReleasedDuringAcquire = false;
		this._diagPttUpWithoutCapture = false;
	}

	private _scheduleDiagnosticFire(): void {
		if (this._diagFireTimer) {
			clearTimeout(this._diagFireTimer);
			this._diagFireTimer = undefined;
		}
		this._diagFireTimer = setTimeout(() => {
			this._diagFireTimer = undefined;
			this._emitDiagnostic();
		}, MicCaptureService._DIAG_POST_RELEASE_WINDOW_MS);
	}

	private _flushPendingDiagnostic(): void {
		if (this._diagFireTimer) {
			clearTimeout(this._diagFireTimer);
			this._diagFireTimer = undefined;
			this._emitDiagnostic();
		}
	}

	private _emitDiagnostic(): void {
		if (!this._diagTurnId && this._diagPttDownTs === 0) { return; }
		const msHeld = this._diagPttUpTs > 0 ? this._diagPttUpTs - this._diagPttDownTs : 0;
		this._onPttDiagnostic.fire({
			turnId: this._diagTurnId,
			msHeld,
			chunksSent: this._diagChunksSent,
			samplesSent: this._diagSamplesSent,
			drainFired: this._diagDrainFired,
			drainChunks: this._diagDrainChunks,
			drainSamples: this._diagDrainSamples,
			drainWindowMs: MicCaptureService._PTT_DRAIN_WINDOW_MS,
			drainSkippedByMute: this._diagDrainSkippedByMute,
			drainSkippedBySuppression: this._diagDrainSkippedBySuppression,
			postReleaseCallbacks: this._diagPostReleaseCallbacks,
			postReleaseSamples: this._diagPostReleaseSamples,
			postReleaseSkippedByMute: this._diagPostReleaseSkippedByMute,
			postReleaseSkippedBySuppression: this._diagPostReleaseSkippedBySuppression,
			postReleaseWindowMs: MicCaptureService._DIAG_POST_RELEASE_WINDOW_MS,
			releasedDuringAcquire: this._diagReleasedDuringAcquire,
			pttUpWithoutCapture: this._diagPttUpWithoutCapture,
		});
	}
}

function encodeRawPcm16Base64(samples: Float32Array, win: Window & typeof globalThis): string {
	const buf = new ArrayBuffer(samples.length * 2);
	const view = new DataView(buf);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
	}
	const bytes = new Uint8Array(buf);
	let binaryStr = '';
	for (let i = 0; i < bytes.length; i++) {
		binaryStr += String.fromCharCode(bytes[i]);
	}
	return win.btoa(binaryStr);
}

registerSingleton(IMicCaptureService, MicCaptureService, InstantiationType.Delayed);
