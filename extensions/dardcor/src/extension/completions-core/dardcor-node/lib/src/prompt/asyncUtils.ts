/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from 'vscode';
import { CancellationToken } from 'vscode-languageserver-protocol';
import { ResolveOnTimeoutResult, ResolveResult } from '../../../types/src';
import { Deferred } from '../util/async';

export async function eventToPromise<T>(subscribe: (listener: (event: T) => void) => Disposable): Promise<T> {
	const deferred = new Deferred<T>();
	const disposable = subscribe((event: T) => {
		deferred.resolve(event);
		disposable.dispose();
	});
	return deferred.promise;
}

async function cancellationTokenToPromise(token: CancellationToken): Promise<void> {
	if (token.isCancellationRequested) { return; }
	const deferred = new Deferred<void>();
	const disposable = token.onCancellationRequested(() => {
		deferred.resolve();
		disposable.dispose();
	});
	await deferred.promise;
}

async function raceCancellation(promise: Promise<void>, token?: CancellationToken): Promise<void> {
	if (token) {
		const cancellationPromise = cancellationTokenToPromise(token);
		await Promise.race([promise, cancellationPromise]);
	} else {
		await promise;
	}
}

export function isArrayOfT<T>(value: ResolveOnTimeoutResult<T> | undefined): value is readonly T[] {
	return Array.isArray(value);
}

type ResolvedItem<T> =
	| {
		status: 'full' | 'partial';
		resolutionTime: number;
		value: T[];
	}
	| {
		status: 'none';
		resolutionTime: number;
		value: null;
	}
	| {
		status: 'error';
		resolutionTime: number;
		reason: unknown;
	};

export async function resolveAll<K, T>(
	resolvables: Map<K, ResolveResult<T>>,
	cancellationToken?: CancellationToken
): Promise<Map<K, ResolvedItem<T>>> {
	const results: Map<K, ResolvedItem<T>> = new Map();
	const promises: Promise<void>[] = [];
	for (const [key, resolvable] of resolvables.entries()) {
		const promise = (async () => {
			const result = await resolve(resolvable, cancellationToken);
			results.set(key, result);
		})();
		promises.push(promise);
	}
	await Promise.allSettled(promises.values());
	return results;
}

async function resolve<T>(
	resolvable: ResolveResult<T>,
	cancellationToken?: CancellationToken
): Promise<ResolvedItem<T>> {
	let result: ResolvedItem<T>;
	if (resolvable instanceof Promise) {
		result = await resolvePromise(resolvable, cancellationToken);
	} else {
		result = await resolveIterable(resolvable, cancellationToken);
	}
	return result;
}

async function resolvePromise<T>(
	promise: Promise<ResolveOnTimeoutResult<T>>,
	cancellationToken?: CancellationToken
): Promise<ResolvedItem<T>> {
	const startTime = performance.now();
	let resolved: ResolvedItem<T> = { status: 'none', resolutionTime: 0, value: null };
	const collectPromise = (async () => {
		try {
			const result = await promise;
			if (cancellationToken?.isCancellationRequested) {
				return;
			}
			resolved = { status: 'full', resolutionTime: 0, value: isArrayOfT<T>(result) ? [...result] : [result] };
		} catch (e) {
			if (cancellationToken?.isCancellationRequested) {
				return;
			}
			resolved = { status: 'error', resolutionTime: 0, reason: e };
		}
	})();
	await raceCancellation(collectPromise, cancellationToken);
	resolved.resolutionTime = performance.now() - startTime;
	return resolved;
}

async function resolveIterable<T>(
	iterable: AsyncIterable<T>,
	cancellationToken?: CancellationToken
): Promise<ResolvedItem<T>> {
	const startTime = performance.now();
	let resolved: ResolvedItem<T> = { status: 'none', resolutionTime: 0, value: null };
	const collectPromise = (async () => {
		try {
			for await (const item of iterable) {
				if (cancellationToken?.isCancellationRequested) {
					return;
				}
				if (resolved.status !== 'partial') {
					resolved = { status: 'partial', resolutionTime: 0, value: [] };
				}
				resolved.value.push(item);
			}
			if (!cancellationToken?.isCancellationRequested) {
				if (resolved.status !== 'partial') {
					resolved = { status: 'full', resolutionTime: 0, value: [] };
				} else {
					resolved.status = 'full';
				}
			}
		} catch (e) {
			if (cancellationToken?.isCancellationRequested) {
				return;
			}
			resolved = { status: 'error', resolutionTime: 0, reason: e };
		}
	})();
	await raceCancellation(collectPromise, cancellationToken);
	resolved.resolutionTime = performance.now() - startTime;
	return resolved;
}
