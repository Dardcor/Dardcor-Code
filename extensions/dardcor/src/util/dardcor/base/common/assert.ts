
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError, onUnexpectedError } from './errors';

export function ok(value?: unknown, message?: string) {
	if (!value) {
		throw new Error(message ? `Assertion failed (${message})` : 'Assertion Failed');
	}
}

export function assertNever(value: never, message = 'Unreachable'): never {
	throw new Error(message);
}

export function softAssertNever(value: never): void {
}

export function assert(
	condition: boolean,
	messageOrError: string | Error = 'unexpected state',
): asserts condition {
	if (!condition) {
		const errorToThrow = typeof messageOrError === 'string'
			? new BugIndicatingError(`Assertion Failed: ${messageOrError}`)
			: messageOrError;

		throw errorToThrow;
	}
}

export function softAssert(condition: boolean, message = 'Soft Assertion Failed'): void {
	if (!condition) {
		onUnexpectedError(new BugIndicatingError(message));
	}
}

export function assertFn(condition: () => boolean): void {
	if (!condition()) {
		// eslint-disable-next-line no-debugger
		debugger;
		condition();
		onUnexpectedError(new BugIndicatingError('Assertion Failed'));
	}
}

export function checkAdjacentItems<T>(items: readonly T[], predicate: (item1: T, item2: T) => boolean): boolean {
	let i = 0;
	while (i < items.length - 1) {
		const a = items[i];
		const b = items[i + 1];
		if (!predicate(a, b)) {
			return false;
		}
		i++;
	}
	return true;
}
