/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from './assert';

export function isString(str: unknown): str is string {
	return (typeof str === 'string');
}

export function isStringArray(value: unknown): value is string[] {
	return isArrayOf(value, isString);
}

export function isArrayOf<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
	return Array.isArray(value) && value.every(check);
}

export function isObject(obj: unknown): obj is Object {
	return typeof obj === 'object'
		&& obj !== null
		&& !Array.isArray(obj)
		&& !(obj instanceof RegExp)
		&& !(obj instanceof Date);
}

export function isTypedArray(obj: unknown): obj is Object {
	const TypedArray = Object.getPrototypeOf(Uint8Array);
	return typeof obj === 'object'
		&& obj instanceof TypedArray;
}

export function isNumber(obj: unknown): obj is number {
	return (typeof obj === 'number' && !isNaN(obj));
}

export function isIterable<T>(obj: unknown): obj is Iterable<T> {
	// eslint-disable-next-line local/code-no-any-casts
	return !!obj && typeof (obj as any)[Symbol.iterator] === 'function';
}

export function isAsyncIterable<T>(obj: unknown): obj is AsyncIterable<T> {
	// eslint-disable-next-line local/code-no-any-casts
	return !!obj && typeof (obj as any)[Symbol.asyncIterator] === 'function';
}

export function isBoolean(obj: unknown): obj is boolean {
	return (obj === true || obj === false);
}

export function isUndefined(obj: unknown): obj is undefined {
	return (typeof obj === 'undefined');
}

export function isDefined<T>(arg: T | null | undefined): arg is T {
	return !isUndefinedOrNull(arg);
}

export function isUndefinedOrNull(obj: unknown): obj is undefined | null {
	return (isUndefined(obj) || obj === null);
}


export function assertType(condition: unknown, type?: string): asserts condition {
	if (!condition) {
		throw new Error(type ? `Unexpected type, expected '${type}'` : 'Unexpected type');
	}
}

export function assertReturnsDefined<T>(arg: T | null | undefined): NonNullable<T> {
	assert(
		arg !== null && arg !== undefined,
		'Argument is `undefined` or `null`.',
	);

	return arg;
}

export function assertDefined<T>(value: T, error: string | NonNullable<Error>): asserts value is NonNullable<T> {
	if (value === null || value === undefined) {
		const errorToThrow = typeof error === 'string' ? new Error(error) : error;

		throw errorToThrow;
	}
}

export function assertReturnsAllDefined<T1, T2>(t1: T1 | null | undefined, t2: T2 | null | undefined): [T1, T2];
export function assertReturnsAllDefined<T1, T2, T3>(t1: T1 | null | undefined, t2: T2 | null | undefined, t3: T3 | null | undefined): [T1, T2, T3];
export function assertReturnsAllDefined<T1, T2, T3, T4>(t1: T1 | null | undefined, t2: T2 | null | undefined, t3: T3 | null | undefined, t4: T4 | null | undefined): [T1, T2, T3, T4];
export function assertReturnsAllDefined(...args: (unknown | null | undefined)[]): unknown[] {
	const result = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (isUndefinedOrNull(arg)) {
			throw new Error(`Assertion Failed: argument at index ${i} is undefined or null`);
		}

		result.push(arg);
	}

	return result;
}

export const isOneOf = <TType, TSubtype extends TType>(
	value: TType,
	validValues: readonly TSubtype[],
): value is TSubtype => {
	return validValues.includes(<TSubtype>value);
};

export function typeCheck<T = never>(_thing: NoInfer<T>): void { }

const hasOwnProperty = Object.prototype.hasOwnProperty;

export function isEmptyObject(obj: unknown): obj is object {
	if (!isObject(obj)) {
		return false;
	}

	for (const key in obj) {
		if (hasOwnProperty.call(obj, key)) {
			return false;
		}
	}

	return true;
}

export function isFunction(obj: unknown): obj is Function {
	return (typeof obj === 'function');
}

export function areFunctions(...objects: unknown[]): boolean {
	return objects.length > 0 && objects.every(isFunction);
}

export type TypeConstraint = string | Function;

export function validateConstraints(args: unknown[], constraints: Array<TypeConstraint | undefined>): void {
	const len = Math.min(args.length, constraints.length);
	for (let i = 0; i < len; i++) {
		validateConstraint(args[i], constraints[i]);
	}
}

export function validateConstraint(arg: unknown, constraint: TypeConstraint | undefined): void {

	if (isString(constraint)) {
		if (typeof arg !== constraint) {
			throw new Error(`argument does not match constraint: typeof ${constraint}`);
		}
	} else if (isFunction(constraint)) {
		try {
			if (arg instanceof constraint) {
				return;
			}
		} catch {
		}
		// eslint-disable-next-line local/code-no-any-casts
		if (!isUndefinedOrNull(arg) && (arg as any).constructor === constraint) {
			return;
		}
		if (constraint.length === 1 && constraint.call(undefined, arg) === true) {
			return;
		}
		throw new Error(`argument does not match one of these constraints: arg instanceof constraint, arg.constructor === constraint, nor constraint(arg) === true`);
	}
}

export function upcast<Base, Sub extends Base = Base>(x: Sub): Base {
	return x;
}

type AddFirstParameterToFunction<T, TargetFunctionsReturnType, FirstParameter> = T extends (...args: any[]) => TargetFunctionsReturnType ?
	(firstArg: FirstParameter, ...args: Parameters<T>) => ReturnType<T> :

	T;

export type AddFirstParameterToFunctions<Target, TargetFunctionsReturnType, FirstParameter> = {
	[K in keyof Target]: AddFirstParameterToFunction<Target[K], TargetFunctionsReturnType, FirstParameter>;
};

export type AtLeastOne<T, U = { [K in keyof T]: Pick<T, K> }> = Partial<T> & U[keyof U];

export type OmitOptional<T> = { [K in keyof T as T[K] extends Required<T>[K] ? K : never]: T[K] };

export type Mutable<T> = {
	-readonly [P in keyof T]: T[P]
};

export type DeepImmutable<T> = T extends (infer U)[]
	? ReadonlyArray<DeepImmutable<U>>
	: T extends ReadonlyArray<infer U>
	? ReadonlyArray<DeepImmutable<U>>
	: T extends Map<infer K, infer V>
	? ReadonlyMap<K, DeepImmutable<V>>
	: T extends Set<infer U>
	? ReadonlySet<DeepImmutable<U>>
	: T extends object
	? {
		readonly [K in keyof T]: DeepImmutable<T[K]>;
	}
	: T;

export type SingleOrMany<T> = T | T[];

export type WithDefinedProps<T> = { [K in keyof Required<T>]: T[K] };


export type DeepRequiredNonNullable<T> = {
	[P in keyof T]-?: T[P] extends object ? DeepRequiredNonNullable<T[P]> : Required<NonNullable<T[P]>>;
};


export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : Partial<T[P]>;
};

export type PartialExcept<T, K extends keyof T> = Partial<Omit<T, K>> & Pick<T, K>;


type KeysOfUnionType<T> = T extends T ? keyof T : never;
type FilterType<T, TTest> = T extends TTest ? T : never;
type MakeOptionalAndTrue<T extends object> = { [K in keyof T]?: true };

export function hasKey<T extends object, TKeys extends MakeOptionalAndTrue<T>>(x: T, key: TKeys): x is FilterType<T, { [K in KeysOfUnionType<T> & keyof TKeys]: unknown }> {
	for (const k in key) {
		if (!(k in x)) {
			return false;
		}
	}
	return true;
}
