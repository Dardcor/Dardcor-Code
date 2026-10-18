/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ToggleCellToolbarPositionAction } from '../../../browser/contrib/layout/layoutActions.js';

suite('Notebook Layout Actions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Toggle Cell Toolbar Position', async function () {
		const action = new ToggleCellToolbarPositionAction();

		assert.deepStrictEqual(action.togglePosition('test-nb', 'right'), {
			default: 'right',
			'test-nb': 'left'
		});

		assert.deepStrictEqual(action.togglePosition('test-nb', 'left'), {
			default: 'left',
			'test-nb': 'right'
		});

		assert.deepStrictEqual(action.togglePosition('test-nb', 'hidden'), {
			default: 'hidden',
			'test-nb': 'right'
		});

		assert.deepStrictEqual(action.togglePosition('test-nb', ''), {
			default: 'right',
			'test-nb': 'left'
		});

		assert.deepStrictEqual(action.togglePosition('test-nb', {
			default: 'right'
		}), {
			default: 'right',
			'test-nb': 'left'
		});

		assert.deepStrictEqual(action.togglePosition('test-nb', {
			default: 'left'
		}), {
			default: 'left',
			'test-nb': 'right'
		});

		assert.deepStrictEqual(action.togglePosition('test-nb', {
			default: 'hidden'
		}), {
			default: 'hidden',
			'test-nb': 'right'
		});
	});
});
