/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MakeRequestOptions, RequestMetadata } from '@vscode/copilot-api';
import { createAdvancedFetch } from '../../../shared-fetch-utils/common/advancedFetcher';
import type { HttpResponse } from '../../../shared-fetch-utils/common/fetchTypes';
import { FetchedValue } from '../../../shared-fetch-utils/common/fetchedValue';
import { authBlockedMiddleware } from '../../../shared-fetch-utils/common/middleware/authBlockedMiddleware';
import { etagMiddleware } from '../../../shared-fetch-utils/common/middleware/etagMiddleware';
import { serverErrorBackoffMiddleware } from '../../../shared-fetch-utils/common/middleware/serverErrorBackoffMiddleware';
import type { ICAPIClientService } from '../../endpoint/common/capiClient';
import type { IEnvService } from '../../env/common/envService';

export interface CapiClientFetchedValueOptions<T> {
	readonly request: (() => MakeRequestOptions | Promise<MakeRequestOptions>);

	readonly requestMetadata: RequestMetadata;

	readonly parseResponse: (response: HttpResponse) => Promise<T>;

	readonly isStale: (value: T) => boolean;

	readonly keepCacheHot?: boolean;
}

export function createCapiClientFetchedValue<T>(
	capiClientService: ICAPIClientService,
	envService: IEnvService,
	options: CapiClientFetchedValueOptions<T>,
): FetchedValue<T> {
	const {
		request,
		requestMetadata,
		parseResponse,
		isStale,
		keepCacheHot,
	} = options;

	const fetch = createAdvancedFetch<T>({
		request: async () => {
			const currentRequestOpts = await request();
			return {
				url: `capi:${requestMetadata.type}`,
				headers: currentRequestOpts.headers ?? {},
				method: currentRequestOpts.method ?? 'GET',
				state: currentRequestOpts
			};
		},
		httpFetch: async (httpRequest) => {
			const response = await capiClientService.makeRequest<Response>({
				...(httpRequest.state ?? {}),
				method: httpRequest.method,
				headers: httpRequest.headers,
			}, requestMetadata);

			return response;
		},
		parseResponse,
		middleware: [
			etagMiddleware(),
			authBlockedMiddleware(),
			serverErrorBackoffMiddleware(),
		],
	});

	return new FetchedValue<T>({
		fetch,
		isStale,
		keepCacheHot,
	});
}
