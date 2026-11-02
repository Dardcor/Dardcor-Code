/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { binarySearch } from '../../../base/common/arrays.js';
import { errorHandler, ErrorNoTelemetry, PendingMigrationError } from '../../../base/common/errors.js';
import { ListenerLeakError } from '../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { safeStringify } from '../../../base/common/objects.js';
import { FileOperationError } from '../../files/common/files.js';
import { ITelemetryService } from './telemetry.js';

export type ErrorEventFragment = {
	owner: 'lramos15, sbatten';
	comment: 'Whenever an error in Dardcor Code is thrown.';
	callstack: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The callstack of the error.' };
	msg?: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The message of the error. Normally the first line int the callstack.' };
	file?: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The file the error originated from.' };
	line?: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The line the error originate on.' };
	column?: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The column of the line which the error orginated on.' };
	uncaught_error_name?: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'If the error is uncaught what is the error type' };
	uncaught_error_msg?: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'If the error is uncaught this is just msg but for uncaught errors.' };
	count?: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'How many times this error has been thrown' };
};

type ListenerLeakDiagEvent = {
	kind?: string;
	listenerCount?: number;
};

type ListenerLeakDiagFragment = {
	kind?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the leak is dominated by a single subscriber or popular among many.' };
	listenerCount?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Number of listeners on the emitter when the leak was detected.' };
};

type UnhandledErrorEvent = ErrorEvent & ListenerLeakDiagEvent;
type UnhandledErrorClassification = ErrorEventFragment & ListenerLeakDiagFragment;

export interface ErrorEvent {
	callstack: string;
	msg?: string;
	file?: string;
	line?: number;
	column?: number;
	uncaught_error_name?: string;
	uncaught_error_msg?: string;
	count?: number;
}

export namespace ErrorEvent {
	export function compare(a: ErrorEvent, b: ErrorEvent) {
		if (a.callstack < b.callstack) {
			return -1;
		} else if (a.callstack > b.callstack) {
			return 1;
		}
		return 0;
	}
}

export function packErrorForTelemetry(err: any): { callstack: string | undefined; msg: string } {
	if (!err || typeof err !== 'object') {
		return { callstack: undefined, msg: safeStringify(err) };
	}
	const callstack: string | undefined = Array.isArray(err.stack) ? err.stack.join('\n') : err.stack;
	const msg = err.message ? err.message : safeStringify(err);
	return { callstack, msg };
}

export default abstract class BaseErrorTelemetry {

	public static ERROR_FLUSH_TIMEOUT: number = 5 * 1000;

	private _telemetryService: ITelemetryService;
	private _flushDelay: number;
	private _flushHandle: Timeout | undefined = undefined;
	private _buffer: ErrorEvent[] = [];
	protected readonly _disposables = new DisposableStore();

	constructor(telemetryService: ITelemetryService, flushDelay = BaseErrorTelemetry.ERROR_FLUSH_TIMEOUT) {
		this._telemetryService = telemetryService;
		this._flushDelay = flushDelay;

		const unbind = errorHandler.addListener((err) => this._onErrorEvent(err));
		this._disposables.add(toDisposable(unbind));

		this.installErrorListeners();
	}

	dispose() {
		clearTimeout(this._flushHandle);
		this._flushBuffer();
		this._disposables.dispose();
	}

	protected installErrorListeners(): void {
	}

	private _onErrorEvent(err: any): void {

		if (!err || err.code) {
			return;
		}

		if (err.detail && err.detail.stack) {
			err = err.detail;
		}

		if (ErrorNoTelemetry.isErrorNoTelemetry(err) || err instanceof FileOperationError || PendingMigrationError.is(err) || (typeof err?.message === 'string' && err.message.includes('Unable to read file'))) {
			return;
		}

		const { callstack, msg } = packErrorForTelemetry(err);

		if (!callstack) {
			return;
		}

		const errorEvent: ErrorEvent = { msg, callstack };

		if (ListenerLeakError.is(err)) {
			(errorEvent as UnhandledErrorEvent).kind = err.kind;
			(errorEvent as UnhandledErrorEvent).listenerCount = err.listenerCount;
		}

		this._enqueue(errorEvent);
	}

	protected _enqueue(e: ErrorEvent): void {

		const idx = binarySearch(this._buffer, e, ErrorEvent.compare);
		if (idx < 0) {
			e.count = 1;
			this._buffer.splice(~idx, 0, e);
		} else {
			if (!this._buffer[idx].count) {
				this._buffer[idx].count = 0;
			}
			this._buffer[idx].count += 1;
		}

		if (this._flushHandle === undefined) {
			this._flushHandle = setTimeout(() => {
				this._flushBuffer();
				this._flushHandle = undefined;
			}, this._flushDelay);
		}
	}

	private _flushBuffer(): void {
		for (const error of this._buffer) {
			this._telemetryService.publicLogError2<UnhandledErrorEvent, UnhandledErrorClassification>('UnhandledError', error as UnhandledErrorEvent);
		}
		this._buffer.length = 0;
	}
}
