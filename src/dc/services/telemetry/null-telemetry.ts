/**
 * Dardcor Code - Null Telemetry Provider (Task 190)
 * Mirrors: vs/platform/telemetry/common/telemetry.ts NullTelemetryService
 */

import { Event } from '../../core/events/emitter';
import { IDisposable } from '../../core/lifecycle/disposable';
import { ITelemetryService, ITelemetryData, ITelemetryPayload } from './telemetry-service';

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

export const nullTelemetryService = new NullTelemetryService();
