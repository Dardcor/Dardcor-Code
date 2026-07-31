/**
 * Dardcor Code - Assert / Invariant Checks (Task 75)
 * Mirrors: vs/base/common/assert.ts
 */

export class BugIndicatingError extends Error {
	constructor(message?: string) {
		super(message || 'Bug Indicating Error');
		this.name = 'BugIndicatingError';
		Object.setPrototypeOf(this, BugIndicatingError.prototype);
	}
}

export function ok(value?: unknown, message?: string): void {
	if (!value) {
		throw new Error(message ? `Assertion failed (${message})` : 'Assertion Failed');
	}
}

export function assert(
	condition: boolean,
	messageOrError: string | Error = 'unexpected state'
): asserts condition {
	if (!condition) {
		const errorToThrow = typeof messageOrError === 'string'
			? new BugIndicatingError(`Assertion Failed: ${messageOrError}`)
			: messageOrError;
		throw errorToThrow;
	}
}

export function assertNever(value: never, message = 'Unreachable'): never {
	throw new Error(message);
}

export function softAssertNever(_value: never): void {
	// no-op
}

export function softAssert(condition: boolean, message = 'Soft Assertion Failed'): void {
	if (!condition) {
		console.error(new BugIndicatingError(message));
	}
}

export function assertFn(condition: () => boolean): void {
	if (!condition()) {
		debugger;
		condition();
		console.error(new BugIndicatingError('Assertion Failed'));
	}
}

export function checkAdjacentItems<T>(items: readonly T[], predicate: (item1: T, item2: T) => boolean): boolean {
	let i = 0;
	while (i < items.length - 1) {
		const a = items[i];
		const b = items[i + 1];
		if (!predicate(a, b)) return false;
		i++;
	}
	return true;
}

export function assertIsDefined<T>(value: T | undefined | null, message?: string): T {
	if (value === undefined || value === null) {
		throw new BugIndicatingError(message || 'Expected value to be defined');
	}
	return value;
}

export function assertType(condition: unknown, type?: string): asserts condition {
	if (!condition) {
		throw new BugIndicatingError(type ? `Unexpected type: expected ${type}` : 'Unexpected type');
	}
}
