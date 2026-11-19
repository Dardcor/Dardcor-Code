/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { distinct } from './arrays.js';
import { Iterable } from './iterator.js';
import { URI } from './uri.js';
import { generateUuid } from './uuid.js';

export interface IDataTransferFile {
	readonly id: string;
	readonly name: string;
	readonly uri?: URI;
	data(): Promise<Uint8Array>;
}

export interface IDataTransferItem {
	id?: string;
	asString(): Thenable<string>;
	asFile(): IDataTransferFile | undefined;
	value: unknown;
}

export function createStringDataTransferItem(stringOrPromise: string | Promise<string>, id?: string): IDataTransferItem {
	return {
		id,
		asString: async () => stringOrPromise,
		asFile: () => undefined,
		value: typeof stringOrPromise === 'string' ? stringOrPromise : undefined,
	};
}

export function createFileDataTransferItem(fileName: string, uri: URI | undefined, data: () => Promise<Uint8Array>, id?: string): IDataTransferItem {
	const file = { id: generateUuid(), name: fileName, uri, data };
	return {
		id,
		asString: async () => '',
		asFile: () => file,
		value: undefined,
	};
}

export interface IReadonlyVSDataTransfer extends Iterable<readonly [string, IDataTransferItem]> {
	get size(): number;

	has(mimeType: string): boolean;

	matches(pattern: string): boolean;

	get(mimeType: string): IDataTransferItem | undefined;
}

export class VSDataTransfer implements IReadonlyVSDataTransfer {

	private readonly _entries = new Map<string, IDataTransferItem[]>();

	public get size(): number {
		let size = 0;
		for (const _ of this._entries) {
			size++;
		}
		return size;
	}

	public has(mimeType: string): boolean {
		return this._entries.has(this.toKey(mimeType));
	}

	public matches(pattern: string): boolean {
		const mimes = [...this._entries.keys()];
		if (Iterable.some(this, ([_, item]) => item.asFile())) {
			mimes.push('files');
		}

		return matchesMimeType_normalized(normalizeMimeType(pattern), mimes);
	}

	public get(mimeType: string): IDataTransferItem | undefined {
		return this._entries.get(this.toKey(mimeType))?.[0];
	}

	public append(mimeType: string, value: IDataTransferItem): void {
		const existing = this._entries.get(mimeType);
		if (existing) {
			existing.push(value);
		} else {
			this._entries.set(this.toKey(mimeType), [value]);
		}
	}

	public replace(mimeType: string, value: IDataTransferItem): void {
		this._entries.set(this.toKey(mimeType), [value]);
	}

	public delete(mimeType: string) {
		this._entries.delete(this.toKey(mimeType));
	}

	public *[Symbol.iterator](): IterableIterator<readonly [string, IDataTransferItem]> {
		for (const [mine, items] of this._entries) {
			for (const item of items) {
				yield [mine, item];
			}
		}
	}

	private toKey(mimeType: string): string {
		return normalizeMimeType(mimeType);
	}
}

function normalizeMimeType(mimeType: string): string {
	return mimeType.toLowerCase();
}

export function matchesMimeType(pattern: string, mimeTypes: readonly string[]): boolean {
	return matchesMimeType_normalized(
		normalizeMimeType(pattern),
		mimeTypes.map(normalizeMimeType));
}

function matchesMimeType_normalized(normalizedPattern: string, normalizedMimeTypes: readonly string[]): boolean {
	if (normalizedPattern === '*/*') {
		return normalizedMimeTypes.length > 0;
	}

	if (normalizedMimeTypes.includes(normalizedPattern)) {
		return true;
	}

	const wildcard = normalizedPattern.match(/^([a-z]+)\/([a-z]+|\*)$/i);
	if (!wildcard) {
		return false;
	}

	const [_, type, subtype] = wildcard;
	if (subtype === '*') {
		return normalizedMimeTypes.some(mime => mime.startsWith(type + '/'));
	}

	return false;
}


export const UriList = Object.freeze({
	create: (entries: ReadonlyArray<string | URI>): string => {
		return distinct(entries.map(x => x.toString())).join('\r\n');
	},
	split: (str: string): string[] => {
		return str.split('\r\n');
	},
	parse: (str: string): string[] => {
		return UriList.split(str).filter(value => !value.startsWith('#'));
	}
});
