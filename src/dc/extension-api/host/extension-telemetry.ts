import { IDisposable } from '../../core/lifecycle/disposable.js';

export type TelemetryPropertyValue = string | number | boolean;

export interface ITelemetryEvent {
	readonly kind: 'event' | 'exception';
	readonly extensionId: string;
	readonly eventName: string;
	readonly properties?: Record<string, TelemetryPropertyValue>;
	readonly measurements?: Record<string, number>;
	readonly error?: unknown;
}

export type TelemetrySink = (event: ITelemetryEvent) => void;

const instances = new Set<ExtensionTelemetry>();
let telemetrySink: TelemetrySink | undefined;

export function setTelemetrySink(sink: TelemetrySink | undefined): void {
	telemetrySink = sink;
	if (sink) {
		for (const instance of instances) {
			instance.flush();
		}
	}
}

export function getTelemetrySink(): TelemetrySink | undefined {
	return telemetrySink;
}

export class ExtensionTelemetry implements IDisposable {
	private readonly _queue: ITelemetryEvent[] = [];
	private _disposed = false;

	constructor(private readonly _extensionId: string) {
		instances.add(this);
	}

	public sendTelemetryEvent(eventName: string, properties?: Record<string, TelemetryPropertyValue>, measurements?: Record<string, number>): void {
		this._enqueue({ kind: 'event', extensionId: this._extensionId, eventName, properties, measurements });
	}

	public sendExceptionEvent(eventName: string, properties?: Record<string, TelemetryPropertyValue>, measurements?: Record<string, number>, error?: unknown): void {
		this._enqueue({ kind: 'exception', extensionId: this._extensionId, eventName, properties, measurements, error });
	}

	public flush(): void {
		if (this._queue.length === 0) {
			return;
		}
		const events = this._queue.splice(0, this._queue.length);
		if (!telemetrySink) {
			return;
		}
		for (const event of events) {
			try {
				telemetrySink(event);
			} catch {
			}
		}
	}

	public get pendingCount(): number {
		return this._queue.length;
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this.flush();
		instances.delete(this);
	}

	private _enqueue(event: ITelemetryEvent): void {
		this._queue.push(event);
		if (telemetrySink) {
			this.flush();
		}
	}
}
