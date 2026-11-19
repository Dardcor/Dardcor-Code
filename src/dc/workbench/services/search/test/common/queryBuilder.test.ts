/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import * as glob from '../../../../../base/common/glob.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { escapeGlobPattern, resolveResourcesForSearchIncludes } from '../../common/queryBuilder.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';

suite('QueryBuilderCommon', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let context: IWorkspaceContextService;

	setup(() => {
		const workspace = testWorkspace(URI.file(isWindows ? 'C:\\testWorkspace' : '/testWorkspace'));
		context = new TestContextService(workspace);
	});

	test('resolveResourcesForSearchIncludes passes through paths without special glob characters', () => {
		const actual = resolveResourcesForSearchIncludes([URI.file(isWindows ? 'C:\\testWorkspace\\pages\\blog' : '/testWorkspace/pages/blog')], context);
		assert.deepStrictEqual(actual, ['./pages/blog']);
	});

	test('resolveResourcesForSearchIncludes escapes paths with special characters', () => {
		const actual = resolveResourcesForSearchIncludes([URI.file(isWindows ? 'C:\\testWorkspace\\pages\\blog\\[postId]' : '/testWorkspace/pages/blog/[postId]')], context);
		assert.deepStrictEqual(actual, ['./pages/blog/[[]postId[]]']);
	});

	test('escapeGlobPattern properly escapes square brackets for literal matching', () => {

		const fileName = 'file[test].txt';

		const unescapedResult = glob.match(fileName, fileName);
		assert.strictEqual(unescapedResult, false, 'Unescaped pattern should not match due to character class interpretation');

		const escapedPattern = escapeGlobPattern(fileName);
		const escapedResult = glob.match(escapedPattern, fileName);
		assert.strictEqual(escapedResult, true, 'Escaped pattern should match literally');
		assert.strictEqual(escapedPattern, 'file[[]test[]].txt', 'Pattern should have escaped brackets');
	});
});
