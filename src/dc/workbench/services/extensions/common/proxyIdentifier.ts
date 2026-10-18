/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { VSBuffer } from '../../../../base/common/buffer.js';
import type { CancellationToken } from '../../../../base/common/cancellation.js';

export interface IRPCProtocol {
	getProxy<T>(identifier: ProxyIdentifier<T>): Proxied<T>;

	set<T, R extends T>(identifier: ProxyIdentifier<T>, instance: R): R;

	assertRegistered(identifiers: ProxyIdentifier<unknown>[]): void;

	drain(): Promise<void>;

	dispose(): void;
}

export class ProxyIdentifier<T> {
	public static count = 0;
	_proxyIdentifierBrand: void = undefined;

	public readonly sid: string;
	public readonly nid: number;

	constructor(sid: string) {
		this.sid = sid;
		this.nid = (++ProxyIdentifier.count);
	}
}

const identifiers: ProxyIdentifier<unknown>[] = [];

export function createProxyIdentifier<T>(identifier: string): ProxyIdentifier<T> {
	const result = new ProxyIdentifier<T>(identifier);
	identifiers[result.nid] = result;
	return result;
}

export type Dto<T> = T extends { toJSON(): infer U }
	? U
	: T extends VSBuffer
	? T
	: T extends CancellationToken
	? T
	: T extends Function
	? never
	: T extends object
	? { [k in keyof T]: Dto<T[k]>; }
	: T;

export type Proxied<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R
	? (...args: { [K in keyof A]: Dto<A[K]> }) => Promise<Dto<Awaited<R>>>
	: never
};

export function getStringIdentifierForProxy(nid: number): string {
	return identifiers[nid].sid;
}

export class SerializableObjectWithBuffers<T> {
	constructor(
		public readonly value: T
	) { }
}
