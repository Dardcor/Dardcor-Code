/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface HttpRequest {
	readonly url: string;
	readonly headers: Record<string, string>;
	method?: 'GET' | 'POST' | 'PUT';
	state?: Record<string, unknown>;
}

export interface HttpHeaders {
	get(name: string): string | null | undefined;
}

export interface HttpResponse {
	readonly status: number;
	readonly headers: HttpHeaders;
	readonly body: ReadableStream<Uint8Array> | null;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

export type HttpFetchFn = (request: HttpRequest) => Promise<HttpResponse>;

export type FetchMiddleware = (next: HttpFetchFn) => HttpFetchFn;

export interface WindowStateProvider {
	readonly isActive: boolean;
}

export class FetchBlockedError extends Error {
	constructor(message: string, readonly retryAfterMs: number) {
		super(message);
	}
}
