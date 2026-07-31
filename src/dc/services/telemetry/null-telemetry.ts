/**
 * Dardcor Code - Null Telemetry Provider (Task 190)
 * Mirrors: vs/platform/telemetry/common/telemetry.ts NullTelemetryService
 */

import { Event } from '../../core/events/emitter.js';
import { IDisposable } from '../../core/lifecycle/disposable.js';
import { ITelemetryService, ITelemetryData, ITelemetryPayload } from './telemetry-service.js';

export class NullTelemetryService implements ITelemetryService {
	declare readonly _serviceBrand: undefined;
	readonly sessionId = 'null-session';
	readonly machineId = 'null-machine';
	readonly onDidChangeTelemetryEnabled = Event.None;

	isTelemetryEnabled(): boolean {
		return false;
	}

	setTelemetryEnabled(_enabled: boolean): void {}

	sendTelemetryEvent(_eventName: string, _data?: ITelemetryData): void {}

	sendErrorEvent(_error: Error, _data?: ITelemetryData): void {}

	addAppender(_appender: (payload: ITelemetryPayload) => void): IDisposable {
		return { dispose: () => {} };
	}

	dispose(): void {}
}
