/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isThenable, Promises } from '../../../base/common/async.js';

export function handleVetos(vetos: (boolean | Promise<boolean>)[], onError: (error: Error) => void): Promise<boolean > {
	if (vetos.length === 0) {
		return Promise.resolve(false);
	}

	const promises: Promise<void>[] = [];
	let lazyValue = false;

	for (const valueOrPromise of vetos) {

		if (valueOrPromise === true) {
			return Promise.resolve(true);
		}

		if (isThenable(valueOrPromise)) {
			promises.push(valueOrPromise.then(value => {
				if (value) {
					lazyValue = true;
				}
			}, err => {
				onError(err);
				lazyValue = true;
			}));
		}
	}

	return Promises.settled(promises).then(() => lazyValue);
}
