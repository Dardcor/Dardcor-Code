/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ErrorUtils } from './errors';

export type Result<T, E> = ResultOk<T> | ResultError<E>;

export namespace Result {

	export function ok<T>(value: T): ResultOk<T> {
		return new ResultOk(value);
	}

	export function error<E>(value: E): ResultError<E> {
		return new ResultError(value);
	}

	export function fromString(errorMessage: string): ResultError<Error> {
		return Result.error(new Error(errorMessage));
	}

	export function tryWith<T>(f: () => T): Result<T, Error> {
		try {
			return Result.ok(f());
		} catch (err) {
			return Result.error(ErrorUtils.fromUnknown(err));
		}
	}

	export async function tryWithAsync<T>(f: () => Promise<T>): Promise<Result<T, Error>> {
		try {
			return Result.ok(await f());
		} catch (err) {
			return Result.error(ErrorUtils.fromUnknown(err));
		}
	}
}

class ResultOk<T> {
	constructor(readonly val: T) { }

	map<U>(f: (value: T) => U): ResultOk<U> {
		return new ResultOk(f(this.val));
	}

	mapError<E2>(_f: (error: never) => E2): ResultOk<T> {
		return this;
	}

	flatMap<U, E2>(f: (value: T) => Result<U, E2>): Result<U, E2> {
		return f(this.val);
	}

	unwrap(): T {
		return this.val;
	}

	unwrapOr(_defaultValue: T): T {
		return this.val;
	}

	isOk(): this is ResultOk<T> {
		return true;
	}

	isError(): this is ResultError<never> {
		return false;
	}
}

class ResultError<E> {
	constructor(
		public readonly err: E,
	) { }

	map<U>(_f: (value: never) => U): ResultError<E> {
		return this;
	}

	mapError<E2>(f: (error: E) => E2): ResultError<E2> {
		return new ResultError(f(this.err));
	}

	flatMap<U, E2>(_f: (value: never) => Result<U, E2>): ResultError<E> {
		return this;
	}

	unwrap(): never {
		if (this.err instanceof Error) {
			throw this.err;
		}
		throw ErrorUtils.fromUnknown(this.err);
	}

	unwrapOr<T>(defaultValue: T): T {
		return defaultValue;
	}

	isOk(): this is ResultOk<never> {
		return false;
	}

	isError(): this is ResultError<E> {
		return true;
	}
}
