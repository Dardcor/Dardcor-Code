/**
 * Dardcor Code - Cancellable Delay (Task 91)
 * Mirrors: vs/base/common/async.ts delay/timeout
 */

import { CancellationToken } from './cancellation.js';

export interface ICancelableDelay extends Promise<void> {
	cancel(): void;
}

export function delay(ms: number, token?: CancellationToken): ICancelableDelay {
	let timeoutId: any;
	let rejectFn: (reason?: any) => void;

	const promise = new Promise<void>((resolve, reject) => {
		rejectFn = reject;
		timeoutId = setTimeout(resolve, ms);

		if (token) {
			if (token.isCancellationRequested) {
				clearTimeout(timeoutId);
				reject(new Error('Cancelled'));
				return;
			}
			const sub = token.onCancellationRequested(() => {
				clearTimeout(timeoutId);
				sub.dispose();
				reject(new Error('Cancelled'));
			});
		}
	});

	(promise as any).cancel = () => {
		clearTimeout(timeoutId);
		rejectFn?.(new Error('Cancelled'));
	};

	return promise as ICancelableDelay;
}

export function timeout(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function microtask(): Promise<void> {
	return Promise.resolve();
}

export function nextAnimationFrame(): Promise<number> {
	return new Promise(resolve => requestAnimationFrame(resolve));
}

export function nextIdleCallback(timeout?: number): Promise<void> {
	return new Promise(resolve => {
		if (typeof (globalThis as any).requestIdleCallback === 'function') {
			(globalThis as any).requestIdleCallback(() => resolve(), timeout ? { timeout } : undefined);
		} else {
			setTimeout(resolve, timeout ?? 50);
		}
	});
}
