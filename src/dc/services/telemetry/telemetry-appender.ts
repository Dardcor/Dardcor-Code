/**
 * Dardcor Code - Telemetry Appender (Task 162)
 * Mirrors: vs/platform/telemetry/common/telemetryAppender.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { ITelemetryEvent } from './telemetry-service.js';
import { TelemetrySanitizer } from './telemetry-sanitizer.js';

export interface ITelemetryAppender extends IDisposable {
	log(event: ITelemetryEvent): void;
	flush(): Promise<void>;
}

export class HTTPTelemetryAppender implements ITelemetryAppender {
	private _queue: ITelemetryEvent[] = [];

	constructor(private readonly _endpointUrl: string) {}

	log(event: ITelemetryEvent): void {
		const cleanData = event.data ? TelemetrySanitizer.sanitizeObject(event.data) : undefined;
		this._queue.push({
			...event,
			data: cleanData
		});
		if (this._queue.length >= 20) {
			this.flush();
		}
	}

	async flush(): Promise<void> {
		if (this._queue.length === 0) return;
		const batch = [...this._queue];
		this._queue = [];
		try {
			await fetch(this._endpointUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(batch),
			});
		} catch {
			// ignore analytics network failure
		}
	}

	dispose(): void {
		this.flush();
	}
}
