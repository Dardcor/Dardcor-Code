/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Progress } from 'vscode';


export async function reportProgressOnSlowPromise<T, P extends Promise<any>>(progress: Progress<T>, progressToReport: T, promise: P, timeToWait: number): Promise<Awaited<P>> {
	let timeoutId: any | null = null;
	let promiseResolved = false;

	timeoutId = setTimeout(() => {
		if (!promiseResolved) {
			progress.report(progressToReport);
		}
	}, timeToWait);

	try {
		const result = await promise;
		promiseResolved = true;
		return result;
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}
