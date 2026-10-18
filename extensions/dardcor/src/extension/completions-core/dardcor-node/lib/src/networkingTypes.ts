/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export { FetchOptions, Response } from '../../../../../platform/networking/common/fetcherService';


class HttpTimeoutError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'HttpTimeoutError';
	}
}

export function isAbortError(e: unknown): boolean {
	if (!e || typeof e !== 'object') {
		return false;
	}
	return (
		e instanceof HttpTimeoutError ||
		('name' in e && e.name === 'AbortError') ||
		('code' in e && e.code === 'ABORT_ERR')
	);
}

export interface IAbortController {
	readonly signal: IAbortSignal;
	abort(): void;
}

export interface IHeaders extends Iterable<[string, string]> {
	append(name: string, value: string): void;
	delete(name: string): void;
	get(name: string): string | null;
	has(name: string): boolean;
	set(name: string, value: string): void;

	entries(): Iterator<[string, string]>;
	keys(): Iterator<string>;
	values(): Iterator<string>;
	[Symbol.iterator](): Iterator<[string, string]>;
}

export interface IAbortSignal extends Pick<EventTarget, 'addEventListener' | 'removeEventListener'> {
	readonly aborted: boolean;
}

export type ReqHeaders = { [key: string]: string };
