/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FetchMiddleware, HttpFetchFn, HttpRequest, HttpResponse } from './fetchTypes';

export function composeFetchMiddleware(...middlewares: readonly FetchMiddleware[]): FetchMiddleware {
	return (baseFetch) => middlewares.reduceRight<HttpFetchFn>((next, mw) => mw(next), baseFetch);
}


export interface AdvancedFetchOptions<T> {
	readonly request: HttpRequest | (() => HttpRequest | Promise<HttpRequest>);

	readonly httpFetch: HttpFetchFn;

	readonly parseResponse: (response: HttpResponse) => Promise<T>;

	readonly middleware?: readonly FetchMiddleware[];
}

export function createAdvancedFetch<T>(options: AdvancedFetchOptions<T>): () => Promise<T> {
	const { httpFetch, parseResponse, middleware = [] } = options;
	const composedFetch = composeFetchMiddleware(...middleware)(httpFetch);

	return async () => {
		const request = typeof options.request === 'function' ? await options.request() : options.request;
		const response = await composedFetch(request);
		return parseResponse(response);
	};
}
