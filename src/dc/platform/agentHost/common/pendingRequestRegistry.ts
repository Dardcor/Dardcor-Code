/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../base/common/async.js';
import { CancellationError } from '../../../base/common/errors.js';

type MetadataArgument<TMeta> = [TMeta] extends [void] ? [metadata?: TMeta] : [metadata: TMeta];

export class PendingRequestRegistry<TResult, TMeta = void> {
	private readonly _entries = new Map<string, { deferred: DeferredPromise<TResult>; metadata: TMeta }>();
	private readonly _earlyResults = new Map<string, TResult>();

	registerAndFire(key: string, fire: () => void, ...metadata: MetadataArgument<TMeta>): Promise<TResult> {
		if (this._earlyResults.has(key)) {
			const buffered = this._earlyResults.get(key) as TResult;
			this._earlyResults.delete(key);
			return Promise.resolve(buffered);
		}
		const deferred = new DeferredPromise<TResult>();
		this._entries.set(key, { deferred, metadata: metadata[0] as TMeta });
		fire();
		return deferred.p;
	}

	register(key: string, ...metadata: MetadataArgument<TMeta>): Promise<TResult> {
		if (this._earlyResults.has(key)) {
			const buffered = this._earlyResults.get(key) as TResult;
			this._earlyResults.delete(key);
			return Promise.resolve(buffered);
		}
		const existing = this._entries.get(key);
		if (existing && !existing.deferred.isSettled) {
			existing.deferred.error(new CancellationError());
		}
		const deferred = new DeferredPromise<TResult>();
		this._entries.set(key, { deferred, metadata: metadata[0] as TMeta });
		return deferred.p;
	}

	respond(key: string, value: TResult): boolean {
		const entry = this._entries.get(key);
		if (!entry) {
			return false;
		}
		this._entries.delete(key);
		entry.deferred.complete(value);
		return true;
	}

	getMetadata(key: string): TMeta | undefined {
		return this._entries.get(key)?.metadata;
	}

	has(key: string): boolean {
		return this._entries.has(key);
	}

	*entries(): IterableIterator<readonly [key: string, metadata: TMeta]> {
		for (const [key, entry] of this._entries) {
			yield [key, entry.metadata];
		}
	}

	respondWhere(predicate: (metadata: TMeta, key: string) => boolean, value: TResult): number {
		let count = 0;
		for (const [key, entry] of this._entries) {
			if (predicate(entry.metadata, key) && this.respond(key, value)) {
				count++;
			}
		}
		return count;
	}

	respondOrBuffer(key: string, value: TResult): void {
		if (!this.respond(key, value)) {
			this._earlyResults.set(key, value);
		}
	}

	hasBufferedResult(key: string): boolean {
		return this._earlyResults.has(key);
	}

	denyAll(denyValue: TResult): void {
		for (const [, entry] of this._entries) {
			if (!entry.deferred.isSettled) {
				entry.deferred.complete(denyValue);
			}
		}
		this._entries.clear();
		this._earlyResults.clear();
	}

	rejectAll(error: Error): void {
		for (const [, entry] of this._entries) {
			if (!entry.deferred.isSettled) {
				entry.deferred.error(error);
			}
		}
		this._entries.clear();
		this._earlyResults.clear();
	}
}
