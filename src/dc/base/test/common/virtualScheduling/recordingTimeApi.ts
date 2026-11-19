/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { realTimeApi, TimeApi } from './timeApi.js';
import { Trace, TraceContext } from './trace.js';
import { EventSource } from './virtualClock.js';

export interface RecordedTimerEvent {
	readonly time: number;
	readonly source: EventSource;
	readonly trace?: Trace;
}

export function createRecordingRealTimeApi(history: RecordedTimerEvent[]): TimeApi {
	const realSetTimeout = realTimeApi.setTimeout;

	function record(label: string, stack: string | undefined, trace: Trace): void {
		history.push({
			time: realTimeApi.Date.now(),
			source: { toString: () => label, stackTrace: stack },
			trace,
		});
	}

	function runAsHandlerReal(trace: Trace, handler: () => void): void {
		TraceContext.instance.runAsHandler(trace, handler, {
			afterMicrotaskClosure: cb => { realSetTimeout(cb, 0); },
		});
	}

	const api: TimeApi = {
		setTimeout(handler, ms = 0) {
			const stack = new Error().stack;
			const trace = TraceContext.instance.currentTrace().child(`setTimeout(${ms}ms)`, stack);
			return realTimeApi.setTimeout(() => {
				record('setTimeout', stack, trace);
				runAsHandlerReal(trace, handler);
			}, ms);
		},
		clearTimeout: realTimeApi.clearTimeout,
		setInterval(handler, ms) {
			const stack = new Error().stack;
			const baseTrace = TraceContext.instance.currentTrace().child(`setInterval(${ms}ms)`, stack);
			let iter = 0;
			return realTimeApi.setInterval(() => {
				iter++;
				const tickTrace = baseTrace.child(`tick #${iter}`);
				record(`setInterval (iteration ${iter})`, stack, tickTrace);
				runAsHandlerReal(tickTrace, handler);
			}, ms);
		},
		clearInterval: realTimeApi.clearInterval,
		setImmediate: realTimeApi.setImmediate ? handler => {
			const stack = new Error().stack;
			const trace = TraceContext.instance.currentTrace().child('setImmediate', stack);
			return realTimeApi.setImmediate!(() => {
				record('setImmediate', stack, trace);
				runAsHandlerReal(trace, handler);
			});
		} : undefined,
		clearImmediate: realTimeApi.clearImmediate,
		requestAnimationFrame: realTimeApi.requestAnimationFrame ? (cb => {
			const stack = new Error().stack;
			const trace = TraceContext.instance.currentTrace().child('requestAnimationFrame', stack);
			return realTimeApi.requestAnimationFrame!(t => {
				record('requestAnimationFrame', stack, trace);
				runAsHandlerReal(trace, () => cb(t));
			});
		}) as TimeApi['requestAnimationFrame'] : undefined,
		cancelAnimationFrame: realTimeApi.cancelAnimationFrame,
		Date: realTimeApi.Date,
		performanceNow: realTimeApi.performanceNow,
		performanceTimeOrigin: realTimeApi.performanceTimeOrigin,
	};

	(api.setTimeout as unknown as { originalFn: TimeApi['setTimeout'] }).originalFn = realTimeApi.setTimeout;

	return api;
}
