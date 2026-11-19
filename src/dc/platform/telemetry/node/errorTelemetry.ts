/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isCancellationError, isSigPipeError, onUnexpectedError, setUnexpectedErrorHandler } from '../../../base/common/errors.js';
import BaseErrorTelemetry from '../common/errorTelemetry.js';

export default class ErrorTelemetry extends BaseErrorTelemetry {
	protected override installErrorListeners(): void {
		setUnexpectedErrorHandler(err => console.error(err));

		const unhandledPromises: Promise<unknown>[] = [];
		process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
			unhandledPromises.push(promise);
			setTimeout(() => {
				const idx = unhandledPromises.indexOf(promise);
				if (idx >= 0) {
					promise.catch(e => {
						unhandledPromises.splice(idx, 1);
						if (!isCancellationError(e)) {
							console.warn(`rejected promise not handled within 1 second: ${e}`);
							if (e.stack) {
								console.warn(`stack trace: ${e.stack}`);
							}
							if (reason) {
								onUnexpectedError(reason);
							}
						}
					});
				}
			}, 1000);
		});

		process.on('rejectionHandled', (promise: Promise<unknown>) => {
			const idx = unhandledPromises.indexOf(promise);
			if (idx >= 0) {
				unhandledPromises.splice(idx, 1);
			}
		});

		process.on('uncaughtException', (err: Error | NodeJS.ErrnoException) => {
			if (isSigPipeError(err)) {
				return;
			}

			onUnexpectedError(err);
		});
	}
}
