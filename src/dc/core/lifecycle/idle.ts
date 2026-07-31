/**
 * Dardcor Code - Idle Callback Scheduler
 */

import { IDisposable } from './disposable.js';

export function runWhenIdle(runner: () => void, timeout = 1000): IDisposable {
	if (typeof requestIdleCallback !== 'undefined') {
		const handle = requestIdleCallback(() => runner(), { timeout });
		return {
			dispose() {
				cancelIdleCallback(handle);
			}
		};
	}
	const handle = setTimeout(runner, 50);
	return {
		dispose() {
			clearTimeout(handle);
		}
	};
}
