/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from './utils.js';
import { IterativePagedModel, IIterativePager, IIterativePage } from '../../common/paging.js';

function createTestPager(pageSize: number, maxPages: number): IIterativePager<number> {
	let currentPage = 0;

	const createPage = (page: number): IIterativePage<number> => {
		const start = page * pageSize;
		const items: number[] = [];
		for (let i = 0; i < pageSize; i++) {
			items.push(start + i);
		}
		const hasMore = page + 1 < maxPages;
		return { items, hasMore };
	};

	return {
		firstPage: createPage(currentPage++),
		getNextPage: async (cancellationToken: CancellationToken): Promise<IIterativePage<number>> => {
			if (currentPage >= maxPages) {
				return { items: [], hasMore: false };
			}
			return createPage(currentPage++);
		}
	};
}

suite('IterativePagedModel', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('initial state', () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));

		assert.strictEqual(model.length, 11);
		assert.strictEqual(model.isResolved(0), true);
		assert.strictEqual(model.isResolved(9), true);
		assert.strictEqual(model.isResolved(10), false);
	});

	test('load first page via sentinel access', async () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));

		const item = await model.resolve(0, CancellationToken.None);

		assert.strictEqual(item, 0);
		assert.strictEqual(model.length, 11);
		assert.strictEqual(model.isResolved(0), true);
		assert.strictEqual(model.isResolved(9), true);
		assert.strictEqual(model.isResolved(10), false);
	});

	test('load multiple pages', async () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));

		assert.strictEqual(model.length, 11);

		await model.resolve(10, CancellationToken.None);
		assert.strictEqual(model.length, 21);
		assert.strictEqual(model.get(10), 10);

		await model.resolve(20, CancellationToken.None);
		assert.strictEqual(model.length, 30);
	});

	test('onDidIncrementLength event fires correctly', async () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));
		const lengths: number[] = [];

		store.add(model.onDidIncrementLength((length: number) => lengths.push(length)));

		await model.resolve(10, CancellationToken.None);

		assert.strictEqual(lengths.length, 1);
		assert.strictEqual(lengths[0], 21);

		await model.resolve(20, CancellationToken.None);

		assert.strictEqual(lengths.length, 2);
		assert.strictEqual(lengths[1], 30);
	});

	test('accessing regular items does not trigger loading', async () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));

		const initialLength = model.length;

		assert.strictEqual(model.get(5), 5);
		assert.strictEqual(model.isResolved(5), true);

		assert.strictEqual(model.length, initialLength);
	});

	test('reaching end of data removes sentinel', async () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));

		await model.resolve(10, CancellationToken.None);
		await model.resolve(20, CancellationToken.None);

		assert.strictEqual(model.length, 30);

		assert.strictEqual(model.isResolved(29), true);
		assert.strictEqual(model.isResolved(30), false);
	});

	test('concurrent access to sentinel only loads once', async () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));

		const [item1, item2, item3] = await Promise.all([
			model.resolve(10, CancellationToken.None),
			model.resolve(10, CancellationToken.None),
			model.resolve(10, CancellationToken.None)
		]);

		assert.strictEqual(item1, 10);
		assert.strictEqual(item2, 10);
		assert.strictEqual(item3, 10);
		assert.strictEqual(model.length, 21);
	});

	test('empty pager with no items', () => {
		const emptyPager: IIterativePager<number> = {
			firstPage: { items: [], hasMore: false },
			getNextPage: async () => ({ items: [], hasMore: false })
		};
		const model = store.add(new IterativePagedModel(emptyPager));

		assert.strictEqual(model.length, 0);
		assert.strictEqual(model.isResolved(0), false);
	});

	test('single page pager with no more pages', () => {
		const singlePagePager: IIterativePager<number> = {
			firstPage: { items: [1, 2, 3], hasMore: false },
			getNextPage: async () => ({ items: [], hasMore: false })
		};
		const model = store.add(new IterativePagedModel(singlePagePager));

		assert.strictEqual(model.length, 3);
		assert.strictEqual(model.isResolved(0), true);
		assert.strictEqual(model.isResolved(2), true);
		assert.strictEqual(model.isResolved(3), false);
		assert.strictEqual(model.get(0), 1);
		assert.strictEqual(model.get(2), 3);
	});

	test('accessing item beyond loaded range throws', () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));

		assert.throws(() => model.get(15), /Item not resolved yet/);
	});

	test('resolving item beyond all pages throws', async () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));

		await model.resolve(10, CancellationToken.None);
		await model.resolve(20, CancellationToken.None);

		await assert.rejects(
			async () => model.resolve(30, CancellationToken.None),
			/Index out of bounds/
		);
	});

	test('cancelled token during initial resolve', async () => {
		const pager = createTestPager(10, 3);
		const model = store.add(new IterativePagedModel(pager));

		const cts = new CancellationTokenSource();
		cts.cancel();

		await assert.rejects(
			async () => model.resolve(0, cts.token),
			/Canceled/
		);
	});

	test('event fires for each page load', async () => {
		const pager = createTestPager(5, 4);
		const model = store.add(new IterativePagedModel(pager));
		const lengths: number[] = [];

		store.add(model.onDidIncrementLength((length: number) => lengths.push(length)));

		assert.strictEqual(model.length, 6);

		await model.resolve(5, CancellationToken.None);
		assert.deepStrictEqual(lengths, [11]);

		await model.resolve(10, CancellationToken.None);
		assert.deepStrictEqual(lengths, [11, 16]);

		await model.resolve(15, CancellationToken.None);
		assert.deepStrictEqual(lengths, [11, 16, 20]);
	});

	test('sequential page loads work correctly', async () => {
		const pager = createTestPager(5, 3);
		const model = store.add(new IterativePagedModel(pager));

		for (let page = 1; page < 3; page++) {
			const sentinelIndex = page * 5;
			await model.resolve(sentinelIndex, CancellationToken.None);
		}

		assert.strictEqual(model.length, 15);
		for (let i = 0; i < 15; i++) {
			assert.strictEqual(model.get(i), i);
			assert.strictEqual(model.isResolved(i), true);
		}
	});

	test('accessing items after loading all pages', async () => {
		const pager = createTestPager(10, 2);
		const model = store.add(new IterativePagedModel(pager));

		await model.resolve(10, CancellationToken.None);

		assert.strictEqual(model.length, 20);
		assert.strictEqual(model.isResolved(19), true);
		assert.strictEqual(model.isResolved(20), false);

		for (let i = 0; i < 20; i++) {
			assert.strictEqual(model.get(i), i);
		}
	});

	test('pager with varying page sizes', async () => {
		let pageNum = 0;
		const varyingPager: IIterativePager<string> = {
			firstPage: { items: ['a', 'b', 'c'], hasMore: true },
			getNextPage: async (): Promise<IIterativePage<string>> => {
				pageNum++;
				if (pageNum === 1) {
					return { items: ['d', 'e'], hasMore: true };
				} else if (pageNum === 2) {
					return { items: ['f', 'g', 'h', 'i'], hasMore: false };
				}
				return { items: [], hasMore: false };
			}
		};

		const model = store.add(new IterativePagedModel(varyingPager));

		assert.strictEqual(model.length, 4);

		await model.resolve(3, CancellationToken.None);
		assert.strictEqual(model.length, 6);
		assert.strictEqual(model.get(3), 'd');

		await model.resolve(5, CancellationToken.None);
		assert.strictEqual(model.length, 9);
		assert.strictEqual(model.get(5), 'f');
		assert.strictEqual(model.get(8), 'i');
	});
});
