/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Progress } from '../../../../../platform/progress/common/progress.js';
import { ITextQuery, QueryType } from '../../common/search.js';
import { ProviderResult, Range, TextSearchComplete2, TextSearchMatch2, TextSearchProviderOptions, TextSearchProvider2, TextSearchQuery2, TextSearchResult2 } from '../../common/searchExtTypes.js';
import { NativeTextSearchManager } from '../../node/textSearchManager.js';

suite('NativeTextSearchManager', () => {
	test('fixes encoding', async () => {
		let correctEncoding = false;
		const provider: TextSearchProvider2 = {
			provideTextSearchResults(query: TextSearchQuery2, options: TextSearchProviderOptions, progress: Progress<TextSearchResult2>, token: CancellationToken): ProviderResult<TextSearchComplete2> {
				correctEncoding = options.folderOptions[0].encoding === 'windows-1252';

				return null;
			}
		};

		const query: ITextQuery = {
			type: QueryType.Text,
			contentPattern: {
				pattern: 'a'
			},
			folderQueries: [{
				folder: URI.file('/some/folder'),
				fileEncoding: 'windows1252'
			}]
		};

		const m = new NativeTextSearchManager(query, provider);
		await m.search(() => { }, CancellationToken.None);

		assert.ok(correctEncoding);
	});

	test('handles result from unmatched folder gracefully via optional chaining', async () => {
		let receivedResults = 0;
		const provider: TextSearchProvider2 = {
			provideTextSearchResults(query: TextSearchQuery2, options: TextSearchProviderOptions, progress: Progress<TextSearchResult2>, token: CancellationToken): ProviderResult<TextSearchComplete2> {
				const range = new Range(0, 0, 0, 5);

				progress.report(new TextSearchMatch2(
					URI.file('/folder1/test.txt'),
					[{ sourceRange: range, previewRange: range }],
					'test match'
				));

				progress.report(new TextSearchMatch2(
					URI.file('/unknown/folder/file.txt'),
					[{ sourceRange: range, previewRange: range }],
					'unmatched result'
				));

				return null;
			}
		};

		const query: ITextQuery = {
			type: QueryType.Text,
			contentPattern: {
				pattern: 'a'
			},
			folderQueries: [
				{ folder: URI.file('/folder1') }
			]
		};

		const m = new NativeTextSearchManager(query, provider);
		await m.search((results) => {
			receivedResults += results.length;
		}, CancellationToken.None);

		assert.strictEqual(receivedResults, 1);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
