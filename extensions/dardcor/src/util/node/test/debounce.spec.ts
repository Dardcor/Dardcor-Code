/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'vitest';
import { Debouncer } from '../../common/debounce';

suite('Debouncing', function () {
	test('single debounce call', async function () {
		const debouncer = new Debouncer();
		await debouncer.debounce(1);
	});
	test('repeated call within time limit', async function () {
		const debouncer = new Debouncer();
		let result: boolean | undefined;
		(async () => {
			try {
				await debouncer.debounce(10);
				result = true;
			} catch {
				result = false;
			}
		})();
		await debouncer.debounce(1);
		assert.deepStrictEqual(result, false);
	});
	test('repeated call outside time limit', async function () {
		const debouncer = new Debouncer();
		let result: boolean | undefined;
		(async () => {
			try {
				await debouncer.debounce(1);
				result = true;
			} catch {
				result = false;
			}
		})();
		await new Promise(resolve => setTimeout(resolve, 5));
		await debouncer.debounce(1);
		assert.deepStrictEqual(result, true);
	});
	test('multiple debounce objects are independent', async function () {
		const debouncer1 = new Debouncer();
		const debouncer2 = new Debouncer();
		let result: boolean | undefined;
		(async () => {
			try {
				await debouncer1.debounce(10);
				result = true;
			} catch {
				result = false;
			}
		})();
		await debouncer2.debounce(1);
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.deepStrictEqual(result, true);
	});
});
