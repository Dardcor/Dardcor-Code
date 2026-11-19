/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FetchBlockedError, type FetchMiddleware, type WindowStateProvider } from '../fetchTypes';

export class WindowInactiveError extends FetchBlockedError {
	constructor() {
		super('Window is inactive', 60_000);
	}
}

export function windowActiveMiddleware(provider: WindowStateProvider): FetchMiddleware {
	return (next) => async (request) => {
		if (!provider.isActive) {
			throw new WindowInactiveError();
		}
		return next(request);
	};
}
