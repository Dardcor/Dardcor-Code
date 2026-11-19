/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { DisposableStore } from '../../dardcor/base/common/lifecycle';
import { throwIfDisposablesAreLeaked, throwIfDisposablesAreLeakedAsync } from './testUtils';

describe('testUtils', () => {
	describe('throwIfDisposablesAreLeaked', () => {
		it('should not throw when no disposables are leaked', () => {
			expect(() => {
				throwIfDisposablesAreLeaked(() => {
					const store = new DisposableStore();
					store.add({ dispose: () => { } });
					store.dispose();
				});
			}).not.toThrow();
		});

		it('should throw when disposables are leaked', () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
			try {
				expect(() => {
					throwIfDisposablesAreLeaked(() => {
						const store = new DisposableStore();
						store.add({ dispose: () => { } });
					});
				}).toThrow(/There are \d+ undisposed disposables!/);
			} finally {
				consoleSpy.mockRestore();
			}
		});
	});

	describe('throwIfDisposablesAreLeakedAsync', () => {
		it('should not throw when no disposables are leaked in async context', async () => {
			await expect(
				throwIfDisposablesAreLeakedAsync(async () => {
					const store = new DisposableStore();
					store.add({ dispose: () => { } });
					store.dispose();
				})
			).resolves.not.toThrow();
		});

		it('should throw when disposables are leaked in async context', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
			try {
				await expect(
					throwIfDisposablesAreLeakedAsync(async () => {
						const store = new DisposableStore();
						store.add({ dispose: () => { } });
					})
				).rejects.toThrow(/There are \d+ undisposed disposables!/);
			} finally {
				consoleSpy.mockRestore();
			}
		});

		it('should work with async operations', async () => {
			await expect(
				throwIfDisposablesAreLeakedAsync(async () => {
					const store = new DisposableStore();
					store.add({ dispose: () => { } });

					await new Promise(resolve => setTimeout(resolve, 1));

					store.dispose();
				})
			).resolves.not.toThrow();
		});
	});
});
