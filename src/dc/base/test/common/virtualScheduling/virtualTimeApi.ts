/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../common/lifecycle.js';
import { realTimeApi, TimeApi } from './timeApi.js';
import { ROOT_TRACE, TraceContext } from './trace.js';
import { VirtualClock } from './virtualClock.js';

if (typeof Error.stackTraceLimit === 'number' && Error.stackTraceLimit < 50) {
	Error.stackTraceLimit = 50;
}

function asDisposable(id: unknown): IDisposable | undefined {
	if (id === null || typeof id !== 'object') { return undefined; }
	const maybe = id as Partial<IDisposable>;
	return typeof maybe.dispose === 'function' ? id as IDisposable : undefined;
}

export interface CreateVirtualTimeApiOptions {
	readonly fakeRequestAnimationFrame?: boolean;
}

export function createVirtualTimeApi(
	clock: VirtualClock,
	options?: CreateVirtualTimeApiOptions,
): TimeApi {
	const performanceTimeOrigin = clock.now;

	function virtualSetTimeout(handler: () => void, timeout: number = 0): IDisposable {
		const stack = new Error().stack;
		const trace = TraceContext.instance.currentTrace().child(`setTimeout(${timeout}ms)`, stack);
		return clock.schedule({
			time: clock.now + timeout,
			run: handler,
			source: { toString: () => 'setTimeout', stackTrace: stack },
			trace,
		});
	}

	function virtualClearTimeout(id: unknown): void {
		asDisposable(id)?.dispose();
	}

	function virtualSetInterval(handler: () => void, interval: number): IDisposable {
		const stack = new Error().stack;
		const baseTrace = TraceContext.instance.currentTrace().child(`setInterval(${interval}ms)`, stack);
		let iter = 0;
		let disposed = false;
		let lastDisposable: IDisposable;

		const arm = (): void => {
			iter++;
			const myIter = iter;
			lastDisposable = clock.schedule({
				time: clock.now + interval,
				run: () => {
					if (disposed) { return; }
					arm();
					handler();
				},
				source: { toString: () => `setInterval (iteration ${myIter})`, stackTrace: stack },
				trace: baseTrace.child(`tick #${myIter}`),
			});
		};

		arm();
		return {
			dispose: () => {
				if (disposed) { return; }
				disposed = true;
				lastDisposable.dispose();
			},
		};
	}

	function virtualClearInterval(id: unknown): void {
		asDisposable(id)?.dispose();
	}

	const OriginalDate = realTimeApi.Date;
	function VirtualDate(this: unknown, ...args: unknown[]): unknown {
		if (!(this instanceof VirtualDate)) {
			return new OriginalDate(clock.now).toString();
		}
		if (args.length === 0) {
			return new OriginalDate(clock.now);
		}
		return new (OriginalDate as new (...a: unknown[]) => Date)(...args);
	}
	const dateStatics = VirtualDate as unknown as Record<string, unknown>;
	const originalStatics = OriginalDate as unknown as Record<string, unknown>;
	for (const key of Object.getOwnPropertyNames(OriginalDate)) {
		const desc = Object.getOwnPropertyDescriptor(OriginalDate, key);
		if (desc && (desc.writable || desc.set)) {
			dateStatics[key] = originalStatics[key];
		}
	}
	dateStatics.now = () => clock.now;
	dateStatics.parse = OriginalDate.parse;
	dateStatics.UTC = OriginalDate.UTC;
	VirtualDate.prototype = OriginalDate.prototype;

	const api: TimeApi = {
		setTimeout: virtualSetTimeout as unknown as TimeApi['setTimeout'],
		clearTimeout: virtualClearTimeout,
		setInterval: virtualSetInterval as unknown as TimeApi['setInterval'],
		clearInterval: virtualClearInterval,
		Date: VirtualDate as unknown as DateConstructor,
		performanceNow: () => clock.now - performanceTimeOrigin,
		performanceTimeOrigin,
	};

	(api.setTimeout as unknown as { originalFn: TimeApi['setTimeout'] }).originalFn = realTimeApi.setTimeout;

	if (options?.fakeRequestAnimationFrame) {
		let rafIdCounter = 0;
		const rafDisposables = new Map<number, IDisposable>();

		api.requestAnimationFrame = ((callback: (time: number) => void) => {
			const id = ++rafIdCounter;
			const stack = new Error().stack;
			const trace = TraceContext.instance.currentTrace().child('requestAnimationFrame', stack);
			const d = clock.schedule({
				time: clock.now + 16,
				preferRealAnimationFrame: true,
				run: () => {
					rafDisposables.delete(id);
					callback(api.performanceNow());
				},
				source: { toString: () => 'requestAnimationFrame', stackTrace: stack },
				trace,
			});
			rafDisposables.set(id, d);
			return id;
		}) as TimeApi['requestAnimationFrame'];

		api.cancelAnimationFrame = ((id: number) => {
			const d = rafDisposables.get(id);
			if (d) {
				d.dispose();
				rafDisposables.delete(id);
			}
		}) as TimeApi['cancelAnimationFrame'];
	}

	void ROOT_TRACE;

	return api;
}


export { pushGlobalTimeApi } from './globalTimeApi.js';
