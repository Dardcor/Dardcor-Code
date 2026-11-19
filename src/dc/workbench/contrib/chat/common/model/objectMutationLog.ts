/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertNever } from '../../../../../base/common/assert.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { isUndefinedOrNull } from '../../../../../base/common/types.js';

function prefixError(e: Error, prefix: string): void {
	e.message = prefix + e.message;
	if (e.stack) {
		const nlIdx = e.stack.indexOf('\n');
		e.stack = nlIdx !== -1
			? `${e.name}: ${e.message}${e.stack.slice(nlIdx)}`
			: `${e.name}: ${e.message}`;
	}
}

function rethrowWithPathSegment(e: unknown, segment: string | number): never {
	if (e instanceof Error) {
		const part = typeof segment === 'number' ? `[${segment}]` : `.${segment}`;
		const needsSep = !e.message.startsWith('[') && !e.message.startsWith('.');
		prefixError(e, part + (needsSep ? ': ' : ''));
	}
	throw e;
}

const enum TransformKind {
	Key,
	Primitive,
	Array,
	Object,
}

export type SchemaEntries = [string, Transform<unknown, unknown>][];

interface TransformBase<TFrom, TTo> {
	readonly kind: TransformKind;
	extract(from: TFrom): TTo;
}

export interface TransformValue<TFrom, TTo> extends TransformBase<TFrom, TTo> {
	readonly kind: TransformKind.Key | TransformKind.Primitive;
	equals(a: TTo, b: TTo): boolean;
}

export interface TransformArray<TFrom, TTo> extends TransformBase<TFrom, TTo> {
	readonly kind: TransformKind.Array;
	readonly itemSchema: TransformObject<unknown, unknown> | TransformValue<unknown, unknown>;
}

export interface TransformObject<TFrom, TTo> extends TransformBase<TFrom, TTo> {
	readonly kind: TransformKind.Object;
	readonly children: SchemaEntries;
	sealed?(obj: TTo, wasSerialized: boolean): boolean;
}

export type Transform<TFrom, TTo> =
	| TransformValue<TFrom, TTo>
	| TransformArray<TFrom, TTo>
	| TransformObject<TFrom, TTo>;

export type Schema<TFrom, TTo> = {
	[K in keyof Required<TTo>]: Transform<TFrom, TTo[K]>
};

export function key<T, R = T>(comparator?: (a: R, b: R) => boolean): TransformValue<T, R> {
	return {
		kind: TransformKind.Key,
		extract: (from: T) => from as unknown as R,
		equals: comparator ?? ((a, b) => a === b),
	};
}

export function value<T, R extends string | number | boolean | undefined>(): TransformValue<T, R>;
export function value<T, R>(comparator: (a: R, b: R) => boolean): TransformValue<T, R>;
export function value<T, R>(comparator?: (a: R, b: R) => boolean): TransformValue<T, R> {
	return {
		kind: TransformKind.Primitive,
		extract: (from: T) => {
			let value = from as unknown as R;
			if (!!value && typeof value === 'object') {
				value = deepCloneWithFallback(value);
			}

			return value;
		},
		equals: comparator ?? ((a, b) => a === b),
	};
}

export function array<T, R>(schema: TransformObject<T, R> | TransformValue<T, R>): TransformArray<readonly T[], R[]> {
	return {
		kind: TransformKind.Array,
		itemSchema: schema,
		extract: from => from?.map((item, i) => {
			try {
				return schema.extract(item);
			} catch (e) {
				rethrowWithPathSegment(e, i);
			}
		}),
	};
}

export interface ObjectOptions<R> {
	sealed?: (obj: R, wasSerialized: boolean) => boolean;
}

export function object<T, R extends object>(schema: Schema<T, R>, options?: ObjectOptions<R>): TransformObject<T, R> {
	const entries = (Object.entries(schema) as [string, Transform<T, R[keyof R]>][]).sort(([, a], [, b]) => a.kind - b.kind);
	return {
		kind: TransformKind.Object,
		children: entries as SchemaEntries,
		sealed: options?.sealed,
		extract: (from: T) => {
			if (isUndefinedOrNull(from)) {
				return from as unknown as R;
			}

			const result: Record<string, unknown> = Object.create(null);
			for (const [key, transform] of entries) {
				try {
					result[key] = transform.extract(from);
				} catch (e) {
					rethrowWithPathSegment(e, key);
				}
			}
			return result as R;
		},
	};
}

export function t<T, O, R>(getter: (obj: T) => O, schema: Transform<O, R>): Transform<T, R> {
	return {
		...schema,
		extract: (from: T) => schema.extract(getter(from)),
	};
}

export function v<T, R extends string | number | boolean | undefined>(getter: (obj: T) => R): TransformValue<T, R>;
export function v<T, R>(getter: (obj: T) => R, comparator: (a: R, b: R) => boolean): TransformValue<T, R>;
export function v<T, R>(getter: (obj: T) => R, comparator?: (a: R, b: R) => boolean): TransformValue<T, R> {
	const inner = value(comparator!);
	return {
		...inner,
		extract: (from: T) => inner.extract(getter(from)),
	};
}


const enum EntryKind {
	Initial = 0,
	Set = 1,
	Push = 2,
	Delete = 3,
}

type ObjectPath = (string | number)[];

type Entry =
	| { kind: EntryKind.Initial; v: unknown }
	| { kind: EntryKind.Set; k: ObjectPath; v: unknown }
	| { kind: EntryKind.Delete; k: ObjectPath }
	| { kind: EntryKind.Push; k: ObjectPath; v?: unknown[]; i?: number };

const LF = VSBuffer.fromString('\n');

export const PERSIST_ENTRY_MAX_STRING_CHARS = 1 * 1024 * 1024;

export const PERSIST_ENTRY_MAX_TOTAL_CHARS = 100 * 1024 * 1024;

const TRUNCATION_MARKER_PREFIX = '[Dardcor Code: value truncated for persistence';
const TRUNCATION_MARKER_TOTAL = `${TRUNCATION_MARKER_PREFIX}; entry exceeded size budget]`;

export function stringifyEntryWithFallback(entry: unknown): string {
	try {
		return JSON.stringify(entry);
	} catch (e) {
		if (!(e instanceof RangeError)) {
			throw e;
		}
		return JSON.stringify(entry, makeTruncatingReplacer(PERSIST_ENTRY_MAX_STRING_CHARS, PERSIST_ENTRY_MAX_TOTAL_CHARS));
	}
}

export function deepCloneWithFallback<T>(value: T): T {
	return JSON.parse(stringifyEntryWithFallback(value)) as T;
}

export function makeTruncatingReplacer(maxStringChars: number, maxTotalChars: number): (key: string, value: unknown) => unknown {
	let total = 0;
	return (_key, val) => {
		if (typeof val === 'string') {
			let emitted: string;
			if (val.length > maxStringChars) {
				emitted = `${TRUNCATION_MARKER_PREFIX}; original ${val.length} chars]`;
			} else if (total + val.length + 2 > maxTotalChars) {
				emitted = TRUNCATION_MARKER_TOTAL;
			} else {
				total += val.length + 2;
				return val;
			}
			total += emitted.length + 2;
			return emitted;
		}
		return val;
	};
}

export class ObjectMutationLog<TFrom, TTo> {
	private _previous: TTo | undefined;
	private _entryCount = 0;
	private _hasPendingWrite = false;
	private _pendingPrevious: TTo | undefined;
	private _pendingEntryCount = 0;

	constructor(
		private readonly _transform: Transform<TFrom, TTo>,
		private readonly _compactAfterEntries = 512,
	) { }

	createInitial(current: TFrom): VSBuffer {
		return this.createInitialFromSerialized(this._transform.extract(current));
	}


	createInitialFromSerialized(value: TTo): VSBuffer {
		this._previous = value;
		this._entryCount = 1;
		this._clearPending();
		const entry: Entry = { kind: EntryKind.Initial, v: value };
		return VSBuffer.fromString(stringifyEntryWithFallback(entry) + '\n');
	}

	read(content: VSBuffer): TTo {
		let state: unknown;
		let lineCount = 0;

		let start = 0;
		const len = content.byteLength;
		while (start < len) {
			let end = content.indexOf(LF, start);
			if (end === -1) {
				end = len;
			}

			if (end > start) {
				const line = content.slice(start, end);
				if (line.byteLength > 0) {
					lineCount++;
					const entry = JSON.parse(line.toString()) as Entry;
					switch (entry.kind) {
						case EntryKind.Initial:
							state = entry.v;
							break;
						case EntryKind.Set:
							if (state === undefined) {
								throw new Error('Log file is missing an initial entry');
							}
							this._applySet(state, entry.k, entry.v);
							break;
						case EntryKind.Push:
							if (state === undefined) {
								throw new Error('Log file is missing an initial entry');
							}
							this._applyPush(state, entry.k, entry.v, entry.i);
							break;
						case EntryKind.Delete:
							if (state === undefined) {
								throw new Error('Log file is missing an initial entry');
							}
							this._applySet(state, entry.k, undefined);
							break;
						default:
							assertNever(entry);
					}
				}
			}
			start = end + 1;
		}

		if (lineCount === 0) {
			throw new Error('Empty log file');
		}

		this._previous = state as TTo;
		this._entryCount = lineCount;
		this._clearPending();
		return state as TTo;
	}

	write(current: TFrom): { op: 'append' | 'replace'; data: VSBuffer } {
		const currentValue = this._transform.extract(current);

		if (!this._previous || this._entryCount > this._compactAfterEntries) {
			this._hasPendingWrite = true;
			this._pendingPrevious = currentValue;
			this._pendingEntryCount = 1;
			const entry: Entry = { kind: EntryKind.Initial, v: currentValue };
			return { op: 'replace', data: VSBuffer.fromString(stringifyEntryWithFallback(entry) + '\n') };
		}

		const entries: Entry[] = [];
		const path: ObjectPath = [];
		try {
			this._diff(this._transform, path, this._previous, currentValue, entries);
		} catch (e) {
			if (e instanceof Error) {
				const pathStr = path.map(s => typeof s === 'number' ? `[${s}]` : `.${s}`).join('') || '<root>';
				prefixError(e, `error diffing at ${pathStr}: `);
			}
			throw e;
		}

		if (entries.length === 0) {
			this._clearPending();
			return { op: 'append', data: VSBuffer.fromString('') };
		}

		this._hasPendingWrite = true;
		this._pendingEntryCount = this._entryCount + entries.length;
		this._pendingPrevious = currentValue;

		let data = '';
		for (const e of entries) {
			data += stringifyEntryWithFallback(e) + '\n';
		}
		return { op: 'append', data: VSBuffer.fromString(data) };
	}

	confirmWrite(): void {
		if (this._hasPendingWrite) {
			this._previous = this._pendingPrevious;
			this._entryCount = this._pendingEntryCount;
			this._clearPending();
		}
	}

	private _clearPending(): void {
		this._hasPendingWrite = false;
		this._pendingPrevious = undefined;
		this._pendingEntryCount = 0;
	}

	private _applySet(state: unknown, path: ObjectPath, value: unknown): void {
		if (path.length === 0) {
			return;
		}

		let current = state as Record<string | number, unknown>;
		for (let i = 0; i < path.length - 1; i++) {
			current = current[path[i]] as Record<string | number, unknown>;
		}

		current[path[path.length - 1]] = value;
	}

	private _applyPush(state: unknown, path: ObjectPath, values: unknown[] | undefined, startIndex: number | undefined): void {
		let current = state as Record<string | number, unknown>;
		for (let i = 0; i < path.length - 1; i++) {
			current = current[path[i]] as Record<string | number, unknown>;
		}

		const arrayKey = path[path.length - 1];
		const arr = current[arrayKey] as unknown[] || [];

		if (startIndex !== undefined) {
			arr.length = startIndex;
		}

		if (values && values.length > 0) {
			arr.push(...values);
		}

		current[arrayKey] = arr;
	}

	private _diff<T, R>(
		transform: Transform<T, R>,
		path: ObjectPath,
		prev: R,
		curr: R,
		entries: Entry[]
	): void {
		if (transform.kind === TransformKind.Key || transform.kind === TransformKind.Primitive) {
			if (!transform.equals(prev, curr)) {
				entries.push({ kind: EntryKind.Set, k: path.slice(), v: curr });
			}
		} else if (isUndefinedOrNull(prev) || isUndefinedOrNull(curr)) {
			if (prev !== curr) {
				if (curr === undefined) {
					entries.push({ kind: EntryKind.Delete, k: path.slice() });
				} else if (curr === null) {
					entries.push({ kind: EntryKind.Set, k: path.slice(), v: null });
				} else {
					entries.push({ kind: EntryKind.Set, k: path.slice(), v: curr });
				}
			}
		} else if (transform.kind === TransformKind.Array) {
			this._diffArray(transform, path, prev as unknown[], curr as unknown[], entries);
		} else if (transform.kind === TransformKind.Object) {
			this._diffObject(transform.children, path, prev, curr, entries, transform.sealed as ((obj: unknown, wasSerialized: boolean) => boolean) | undefined);
		} else {
			throw new Error(`Unknown transform kind ${JSON.stringify(transform)}`);
		}
	}

	private _diffObject(
		children: SchemaEntries,
		path: ObjectPath,
		prev: unknown,
		curr: unknown,
		entries: Entry[],
		sealed?: (obj: unknown, wasSerialized: boolean) => boolean,
	): void {
		const prevObj = prev as Record<string, unknown> | undefined;
		const currObj = curr as Record<string, unknown>;

		let i = 0;
		for (; i < children.length; i++) {
			const [key, transform] = children[i];
			if (transform.kind !== TransformKind.Key) {
				break;
			}
			if (!transform.equals(prevObj?.[key], currObj[key])) {
				entries.push({ kind: EntryKind.Set, k: path.slice(), v: curr });
				return;
			}
		}

		if (sealed && sealed(prev, true) && sealed(curr, false)) {
			return;
		}

		for (; i < children.length; i++) {
			const [key, transform] = children[i];
			path.push(key);
			this._diff(transform, path, prevObj?.[key], currObj[key], entries);
			path.pop();
		}
	}

	private _diffArray<T, R>(
		transform: TransformArray<T, R>,
		path: ObjectPath,
		prev: unknown[] | undefined,
		curr: unknown[] | undefined,
		entries: Entry[]
	): void {
		const prevArr = prev || [];
		const currArr = curr || [];

		const itemSchema = transform.itemSchema;
		const minLen = Math.min(prevArr.length, currArr.length);

		if (itemSchema.kind === TransformKind.Object) {
			const childEntries = itemSchema.children;

			for (let i = 0; i < minLen; i++) {
				const prevItem = prevArr[i];
				const currItem = currArr[i];

				if (this._hasKeyMismatch(childEntries, prevItem, currItem)) {
					const newItems = currArr.slice(i);
					entries.push({ kind: EntryKind.Push, k: path.slice(), v: newItems.length > 0 ? newItems : undefined, i });
					return;
				}

				path.push(i);
				this._diffObject(childEntries, path, prevItem, currItem, entries, itemSchema.sealed);
				path.pop();
			}

			if (currArr.length > prevArr.length) {
				entries.push({ kind: EntryKind.Push, k: path.slice(), v: currArr.slice(prevArr.length) });
			} else if (currArr.length < prevArr.length) {
				entries.push({ kind: EntryKind.Push, k: path.slice(), i: currArr.length });
			}
		} else {
			let firstMismatch = -1;

			for (let i = 0; i < minLen; i++) {
				if (!itemSchema.equals(prevArr[i], currArr[i])) {
					firstMismatch = i;
					break;
				}
			}

			if (firstMismatch === -1) {
				if (currArr.length > prevArr.length) {
					entries.push({ kind: EntryKind.Push, k: path.slice(), v: currArr.slice(prevArr.length) });
				} else if (currArr.length < prevArr.length) {
					entries.push({ kind: EntryKind.Push, k: path.slice(), i: currArr.length });
				}
			} else {
				const newItems = currArr.slice(firstMismatch);
				entries.push({ kind: EntryKind.Push, k: path.slice(), v: newItems.length > 0 ? newItems : undefined, i: firstMismatch });
			}
		}
	}

	private _hasKeyMismatch(children: SchemaEntries, prev: unknown, curr: unknown): boolean {
		const prevObj = prev as Record<string, unknown> | undefined;
		const currObj = curr as Record<string, unknown>;
		for (const [key, transform] of children) {
			if (transform.kind !== TransformKind.Key) {
				break;
			}
			if (!transform.equals(prevObj?.[key], currObj[key])) {
				return true;
			}
		}
		return false;
	}
}
