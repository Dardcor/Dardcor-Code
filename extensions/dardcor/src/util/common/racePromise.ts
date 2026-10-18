/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellation, raceTimeout } from '../dardcor/base/common/async';
import { CancellationToken, CancellationTokenSource } from '../dardcor/base/common/cancellation';
import { CancellationError } from '../dardcor/base/common/errors';

const CANCELLED = Symbol('cancelled');

export async function raceTimeoutAndCancellationError<T>(
	promiseGenerator: (cancellationToken: CancellationToken) => Promise<T>,
	parentToken: CancellationToken,
	timeoutInMs: number,
	timeoutMessage: string): Promise<T> {
	const cancellationSource = new CancellationTokenSource(parentToken);
	try {
		const result = await raceTimeout(raceCancellation(promiseGenerator(cancellationSource.token), cancellationSource.token, CANCELLED as T), timeoutInMs);

		if (result === CANCELLED) {
			throw new CancellationError();
		}

		if (result === undefined) {
			cancellationSource.cancel();
			throw new Error(timeoutMessage);
		}

		return result;
	}
	finally {
		cancellationSource.dispose();
	}
}
