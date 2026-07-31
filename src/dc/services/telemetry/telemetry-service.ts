/**
 * Dardcor Code - Telemetry Event Dispatcher (Task 122)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { generateUuid } from '../../core/types/uuid.js';
import { IStorageService, StorageScope, StorageTarget } from '../storage/storage-service.js';
import { IEnvironmentService } from '../environment/environment-service.js';
import { TelemetrySanitizer } from './telemetry-sanitizer.js';

export interface ITelemetryData {
	[key: string]: any;
}

export interface ITelemetryEvent {
	readonly eventName: string;
	readonly data?: ITelemetryData;
	readonly time?: number;
}

export interface ITelemetryPayload {
	readonly type: 'event' | 'error';
	readonly eventName: string;
	readonly data: ITelemetryData;
	readonly sessionId: string;
	readonly machineId: string;
	readonly timestamp: number;
}

export interface ITelemetryService {
	readonly _serviceBrand: undefined;
	readonly sessionId: string;
	readonly machineId: string;
	readonly onDidChangeTelemetryEnabled: Event<boolean>;
	isTelemetryEnabled(): boolean;
	setTelemetryEnabled(enabled: boolean): void;
	sendTelemetryEvent(eventName: string, data?: ITelemetryData): void;
	sendErrorEvent(error: Error, data?: ITelemetryData): void;
	addAppender(appender: (payload: ITelemetryPayload) => void): IDisposable;
}

export const ITelemetryService = createDecorator<ITelemetryService>('telemetryService');

const MACHINE_ID_KEY = 'telemetry.machineId';

export class TelemetryService extends Disposable implements ITelemetryService {
	declare readonly _serviceBrand: undefined;

	readonly sessionId: string;
	readonly machineId: string;

	private _enabled: boolean = true;
	private readonly _appenders: Array<(payload: ITelemetryPayload) => void> = [];

	private readonly _onDidChangeTelemetryEnabled = this._register(new Emitter<boolean>());
	readonly onDidChangeTelemetryEnabled = this._onDidChangeTelemetryEnabled.event;

	constructor(
		private readonly _storageService: IStorageService,
		private readonly _environmentService: IEnvironmentService
	) {
		super();
		this.sessionId = generateUuid();
		let machineId = this._storageService.get(MACHINE_ID_KEY, StorageScope.GLOBAL, '');
		if (!machineId) {
			machineId = generateUuid();
			this._storageService.store(MACHINE_ID_KEY, machineId, StorageScope.GLOBAL, StorageTarget.MACHINE);
		}
		this.machineId = machineId;
	}

	public isTelemetryEnabled(): boolean {
		return this._enabled;
	}

	public setTelemetryEnabled(enabled: boolean): void {
		if (this._enabled === enabled) {
			return;
		}
		this._enabled = enabled;
		this._onDidChangeTelemetryEnabled.fire(enabled);
	}

	public sendTelemetryEvent(eventName: string, data: ITelemetryData = {}): void {
		if (!this._enabled) {
			return;
		}
		const safeData = TelemetrySanitizer.sanitize(data, this._protectedPaths());
		this._dispatch({ type: 'event', eventName, data: safeData ?? {}, sessionId: this.sessionId, machineId: this.machineId, timestamp: Date.now() });
	}

	public sendErrorEvent(error: Error, data: ITelemetryData = {}): void {
		if (!this._enabled) {
			return;
		}
		const sanitizedError = TelemetrySanitizer.sanitizeError(error, this._protectedPaths());
		const safeData = TelemetrySanitizer.sanitize(data, this._protectedPaths()) ?? {};
		this._dispatch({
			type: 'error',
			eventName: 'error',
			data: { ...safeData, error: sanitizedError },
			sessionId: this.sessionId,
			machineId: this.machineId,
			timestamp: Date.now()
		});
	}

	public addAppender(appender: (payload: ITelemetryPayload) => void): IDisposable {
		this._appenders.push(appender);
		return toDisposable(() => {
			const index = this._appenders.indexOf(appender);
			if (index >= 0) {
				this._appenders.splice(index, 1);
			}
		});
	}

	private _dispatch(payload: ITelemetryPayload): void {
		for (const appender of this._appenders) {
			try {
				appender(payload);
			} catch {
				// Appenders must never break telemetry flow.
			}
		}
	}

	private _protectedPaths(): string[] {
		return [
			this._environmentService.userHome,
			this._environmentService.userDataPath,
			this._environmentService.extensionsPath,
			this._environmentService.settingsFile
		];
	}
}
