/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { setTimeout0, setTimeout0IsFaster } from '../../../common/platform.js';
import { TimeApi } from './timeApi.js';
import { VirtualEvent } from './virtualClock.js';

export type Embedding = (
	nextEvent: VirtualEvent,
	then: () => void,
) => 'continueSync' | 'cbScheduled';

export const syncEmbedding: Embedding = () => 'continueSync';

export function drainMicrotasksEmbedding(realApi: TimeApi): Embedding {
	return (next, then) => {
		if (next.preferRealAnimationFrame && realApi.requestAnimationFrame) {
			realApi.requestAnimationFrame(() => then());
		} else {
			nextMacrotask(realApi, then);
		}
		return 'cbScheduled';
	};
}

export function nextMacrotask(api: TimeApi, cb: () => void): void {
	if (setTimeout0IsFaster) { setTimeout0(cb); return; }
	if (api.setImmediate) { api.setImmediate(cb); return; }
	api.setTimeout(cb, 0);
}
