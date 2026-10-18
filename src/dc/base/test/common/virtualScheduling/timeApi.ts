/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface TimeoutId { readonly _timeoutIdBrand: void }
export interface IntervalId { readonly _intervalIdBrand: void }
export interface ImmediateId { readonly _immediateIdBrand: void }
export type AnimationFrameId = number & { readonly _animationFrameIdBrand: void };

export interface TimeApi {
	setTimeout(handler: () => void, timeout?: number): TimeoutId;
	clearTimeout(id: TimeoutId): void;
	setInterval(handler: () => void, interval: number): IntervalId;
	clearInterval(id: IntervalId): void;
	setImmediate?: ((handler: () => void) => ImmediateId);
	clearImmediate?: ((id: ImmediateId) => void);
	requestAnimationFrame?: ((cb: (time: number) => void) => AnimationFrameId);
	cancelAnimationFrame?: ((id: AnimationFrameId) => void);
	Date: DateConstructor;
	performanceNow: () => number;
	performanceTimeOrigin: number;
}

export function captureGlobalTimeApi(): TimeApi {
	return {
		setTimeout: globalThis.setTimeout.bind(globalThis) as unknown as TimeApi['setTimeout'],
		clearTimeout: globalThis.clearTimeout.bind(globalThis) as unknown as TimeApi['clearTimeout'],
		setInterval: globalThis.setInterval.bind(globalThis) as unknown as TimeApi['setInterval'],
		clearInterval: globalThis.clearInterval.bind(globalThis) as unknown as TimeApi['clearInterval'],
		setImmediate: globalThis.setImmediate?.bind(globalThis) as unknown as TimeApi['setImmediate'],
		clearImmediate: globalThis.clearImmediate?.bind(globalThis) as unknown as TimeApi['clearImmediate'],
		requestAnimationFrame: globalThis.requestAnimationFrame?.bind(globalThis) as unknown as TimeApi['requestAnimationFrame'],
		cancelAnimationFrame: globalThis.cancelAnimationFrame?.bind(globalThis) as unknown as TimeApi['cancelAnimationFrame'],
		Date: globalThis.Date,
		performanceNow: globalThis.performance?.now.bind(globalThis.performance) ?? globalThis.Date.now.bind(globalThis.Date),
		performanceTimeOrigin: globalThis.performance?.timeOrigin ?? 0,
	};
}

export const realTimeApi: TimeApi = captureGlobalTimeApi();
