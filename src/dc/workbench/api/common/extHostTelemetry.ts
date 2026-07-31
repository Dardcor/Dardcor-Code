import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTelemetry {
	private _telemetryEnabled = true;

	get isTelemetryEnabled(): boolean {
		return this._telemetryEnabled;
	}

	readonly onDidChangeTelemetryEnabled = new Emitter<boolean>().event;

	publicLog(eventName: string, data?: any): void {
		if (this._telemetryEnabled) {
			console.log(`[Telemetry] ${eventName}`, data);
		}
	}

	publicLogError(eventName: string, data?: any): void {
		if (this._telemetryEnabled) {
			console.error(`[Telemetry Error] ${eventName}`, data);
		}
	}
}
