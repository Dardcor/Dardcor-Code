/**
 * Dardcor Code - Async Iterable Utilities (Task 77)
 * Mirrors: vs/base/common/async.ts async generator utilities
 */

export async function* mapAsync<T, R>(iterable: AsyncIterable<T>, fn: (item: T) => R | Promise<R>): AsyncIterable<R> {
	for await (const item of iterable) {
		yield await fn(item);
	}
}

export async function* filterAsync<T>(iterable: AsyncIterable<T>, predicate: (item: T) => boolean | Promise<boolean>): AsyncIterable<T> {
	for await (const item of iterable) {
		if (await predicate(item)) {
			yield item;
		}
	}
}

export async function* mergeAsync<T>(...iterables: AsyncIterable<T>[]): AsyncIterable<T> {
	const iterators = iterables.map(it => it[Symbol.asyncIterator]());
	const pending = new Map<number, Promise<{ index: number; result: IteratorResult<T> }>>();

	for (let i = 0; i < iterators.length; i++) {
		pending.set(i, iterators[i].next().then(result => ({ index: i, result })));
	}

	while (pending.size > 0) {
		const { index, result } = await Promise.race(pending.values());
		if (result.done) {
			pending.delete(index);
		} else {
			yield result.value;
			pending.set(index, iterators[index].next().then(result => ({ index, result })));
		}
	}
}

export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const result: T[] = [];
	for await (const item of iterable) {
		result.push(item);
	}
	return result;
}

export async function firstAsync<T>(iterable: AsyncIterable<T>, predicate?: (item: T) => boolean): Promise<T | undefined> {
	for await (const item of iterable) {
		if (!predicate || predicate(item)) {
			return item;
		}
	}
	return undefined;
}

export async function* takeAsync<T>(iterable: AsyncIterable<T>, count: number): AsyncIterable<T> {
	let taken = 0;
	for await (const item of iterable) {
		if (taken >= count) break;
		yield item;
		taken++;
	}
}

export async function* skipAsync<T>(iterable: AsyncIterable<T>, count: number): AsyncIterable<T> {
	let skipped = 0;
	for await (const item of iterable) {
		if (skipped < count) {
			skipped++;
			continue;
		}
		yield item;
	}
}
