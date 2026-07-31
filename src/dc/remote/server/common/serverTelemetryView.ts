import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerTelemetryViewEntry {
	readonly id: string;
	readonly eventName: string;
	readonly properties: Record<string, any>;
	readonly timestamp: number;
}

export interface IServerTelemetryViewService {
	readonly onDidLogTelemetry: Event<IServerTelemetryViewEntry>;
	readonly onDidChangeTelemetryEnablement: Event<boolean>;
	getTelemetryEntries(): IServerTelemetryViewEntry[];
	isTelemetryEnabled(): boolean;
	setTelemetryEnabled(enabled: boolean): void;
	clearTelemetry(): void;
	logTelemetry(eventName: string, properties?: Record<string, any>): void;
}

export class ServerTelemetryViewCommon implements IServerTelemetryViewService {
	private readonly _entries: IServerTelemetryViewEntry[] = [];
	private _isTelemetryEnabled = true;

	private readonly _onDidLogTelemetry = new Emitter<IServerTelemetryViewEntry>();
	readonly onDidLogTelemetry = this._onDidLogTelemetry.event;

	private readonly _onDidChangeTelemetryEnablement = new Emitter<boolean>();
	readonly onDidChangeTelemetryEnablement = this._onDidChangeTelemetryEnablement.event;

	getTelemetryEntries(): IServerTelemetryViewEntry[] {
		return [...this._entries];
	}

	isTelemetryEnabled(): boolean {
		return this._isTelemetryEnabled;
	}

	setTelemetryEnabled(enabled: boolean): void {
		if (this._isTelemetryEnabled !== enabled) {
			this._isTelemetryEnabled = enabled;
			this._onDidChangeTelemetryEnablement.fire(enabled);
		}
	}

	clearTelemetry(): void {
		this._entries.length = 0;
	}

	logTelemetry(eventName: string, properties?: Record<string, any>): void {
		if (this._isTelemetryEnabled) {
			const entry: IServerTelemetryViewEntry = {
				id: `telemetry-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
				eventName,
				properties: properties || {},
				timestamp: Date.now()
			};
			this._entries.unshift(entry);
			if (this._entries.length > 1000) {
				this._entries.pop();
			}
			this._onDidLogTelemetry.fire(entry);
		}
	}
}
