/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { DocumentInfoWithOffset, SimilarFileInfo } from '../prompt';
import {
	SimilarFilesOptions,
	defaultSimilarFilesOptions,
	getSimilarSnippets,
	nullSimilarFilesOptions,
} from '../snippetInclusion/similarFiles';
import * as assert from 'assert';
import dedent from 'ts-dedent';

suite('Test Multiple Snippet Selection', function () {
	const docSource: string = dedent`
	  A
		  B
		  C
	  D|
		  E
	  F
	  G`;
	const doc: DocumentInfoWithOffset = {
		relativePath: 'source1',
		uri: 'source1',
		source: docSource,
		languageId: 'python',
		offset: docSource.indexOf('|'),
	};

	const similarFiles: SimilarFileInfo[] = [
		{
			relativePath: 'similarFile1',
			uri: 'similarFile1',
			source: dedent`
		  A
			  B
			  C
			  H
		  X
			  Y
			  Z
		  `,
		},
		{
			relativePath: 'similarFile2',
			uri: 'similarFile2',
			source: dedent`
		  D
			  H
		  `,
		},
	];

	const fixedWinDocSrc =
		'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'
			.split('')
			.join('\n');
	const fixedWinDoc: DocumentInfoWithOffset = {
		relativePath: 'source1',
		uri: 'source1',
		source: fixedWinDocSrc,
		languageId: 'python',
		offset: fixedWinDocSrc.length,
	};

	const fixedWinSimilarFiles: SimilarFileInfo[] = [
		{
			relativePath: 'similarFile1',
			uri: 'similarFile1',
			source: 'abcdefghijklmno1234567890abcdefghijklmnopqrstuvwxyzabcdefghijklmno1234567890abcdefghijklmnopqrstuvwxyzabcdefghijklmno1234567890abcdefghijklmnopqrstuvwxyz'
				.split('')
				.join('\n'),
		},
	];

	test('FixedWindow Matcher None', async function () {
		const options: SimilarFilesOptions = nullSimilarFilesOptions;
		const snippets = await getSimilarSnippets(doc, similarFiles, options);

		assert.deepStrictEqual(snippets, []);
	});

	test('FixedWindow Matcher Eager No Selection Option', async function () {
		const options: SimilarFilesOptions = defaultSimilarFilesOptions;
		const snippetLocationsTop1 = (await getSimilarSnippets(fixedWinDoc, fixedWinSimilarFiles, options)).map(
			snippet => [snippet.startLine, snippet.endLine]
		);
		const correctSnippetLocations: number[][] = [[0, 60]];
		assert.deepStrictEqual(snippetLocationsTop1.sort(), correctSnippetLocations.sort());
	});
});
