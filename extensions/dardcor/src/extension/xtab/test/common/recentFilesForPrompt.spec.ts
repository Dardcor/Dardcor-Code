/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';
import { DocumentId } from '../../../../platform/inlineEdits/common/dataTypes/documentId';
import { RootedEdit } from '../../../../platform/inlineEdits/common/dataTypes/edit';
import { LanguageContextResponse } from '../../../../platform/inlineEdits/common/dataTypes/languageContext';
import { DEFAULT_OPTIONS, IncludeLineNumbersOption, PromptOptions, RecentFileClippingStrategy } from '../../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { IXtabHistoryEditEntry, IXtabHistoryVisibleRangesEntry } from '../../../../platform/inlineEdits/common/workspaceEditTracker/nesXtabHistoryTracker';
import { ContextKind } from '../../../../platform/languageServer/common/languageContextService';
import { splitLines } from '../../../../util/dardcor/base/common/strings';
import { StringEdit } from '../../../../util/dardcor/editor/common/core/edits/stringEdit';
import { OffsetRange } from '../../../../util/dardcor/editor/common/core/ranges/offsetRange';
import { StringText } from '../../../../util/dardcor/editor/common/core/text/abstractText';
import { Uri } from '../../../../dardcorTypes';
import { LineRange0Based } from '../../common/lineRange';
import { appendLanguageContextSnippets, appendNeighborFileSnippets, buildCodeSnippetsUsingPagedClipping, computeFocalPageCost, historyEntriesToCodeSnippet, selectFocalRangesWithinSpanCap } from '../../common/recentFilesForPrompt';
import { INeighborFileSnippet } from '../../common/similarFilesContextService';

function nLines(n: number): StringText {
	return new StringText(new Array(n).fill(0).map((_, i) => `${i + 1}`).join('\n'));
}

function computeTokens(s: string) {
	return Math.ceil(s.length / 4);
}

function makeOpts(overrides: {
	maxTokens?: number;
	recentlyViewedFilesIncludeLineNumbers?: IncludeLineNumbersOption;
	includeViewedFiles?: boolean;
	pageSize?: number;
	clippingStrategy?: RecentFileClippingStrategy;
}): PromptOptions {
	return {
		...DEFAULT_OPTIONS,
		recentlyViewedDocuments: {
			...DEFAULT_OPTIONS.recentlyViewedDocuments,
			...(overrides.maxTokens !== undefined && { maxTokens: overrides.maxTokens }),
			...(overrides.recentlyViewedFilesIncludeLineNumbers !== undefined && { includeLineNumbers: overrides.recentlyViewedFilesIncludeLineNumbers }),
			...(overrides.includeViewedFiles !== undefined && { includeViewedFiles: overrides.includeViewedFiles }),
			...(overrides.clippingStrategy !== undefined && { clippingStrategy: overrides.clippingStrategy }),
		},
		pagedClipping: {
			pageSize: overrides.pageSize ?? DEFAULT_OPTIONS.pagedClipping.pageSize,
		},
	};
}

suite('Paged clipping - recently viewed files', () => {

	type FileEntry = {
		id: DocumentId;
		content: StringText;
		focalRanges?: readonly OffsetRange[];
		editEntryCount?: number;
	};

	function buildSnippets(
		files: FileEntry[],
		opts: PromptOptions,
	): { snippets: string[]; docsInPrompt: Set<DocumentId> } {
		return buildCodeSnippetsUsingPagedClipping(files, computeTokens, opts);
	}

	const id = DocumentId.create('file:///src/first.txt');
	const id2 = DocumentId.create('file:///src/second.txt');

	test('can page correctly by lines of 2', () => {
		const { snippets } = buildSnippets(
			[{ id, content: nLines(4) }],
			makeOpts({ maxTokens: 4, pageSize: 2 }),
		);

		expect(snippets).toMatchInlineSnapshot(`
			[
			  "<|recently_viewed_code_snippet|>
			code_snippet_file_path: /src/first.txt (truncated)
			1
			2
			<|/recently_viewed_code_snippet|>",
			]
		`);
	});

	test('can page correctly by lines of 4', () => {
		const { snippets } = buildSnippets(
			[{ id, content: nLines(4) }],
			makeOpts({ maxTokens: 2000, pageSize: 2 }),
		);

		expect(snippets).toMatchInlineSnapshot(`
			[
			  "<|recently_viewed_code_snippet|>
			code_snippet_file_path: /src/first.txt
			1
			2
			3
			4
			<|/recently_viewed_code_snippet|>",
			]
		`);
	});

	suite('includeLineNumbers', () => {

		test('includes line numbers starting from 0 when enabled and not truncated', () => {
			const { snippets } = buildSnippets(
				[{ id, content: nLines(4) }],
				makeOpts({ maxTokens: 2000, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.WithSpaceAfter, pageSize: 2 }),
			);

			expect(snippets).toMatchInlineSnapshot(`
				[
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/first.txt
				0| 1
				1| 2
				2| 3
				3| 4
				<|/recently_viewed_code_snippet|>",
				]
			`);
		});

		test('includes line numbers starting from 0 when truncated from beginning', () => {
			const { snippets } = buildSnippets(
				[{ id, content: nLines(10) }],
				makeOpts({ maxTokens: 4, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.WithSpaceAfter, pageSize: 2 }),
			);

			expect(snippets).toMatchInlineSnapshot(`
				[
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/first.txt (truncated)
				0| 1
				1| 2
				<|/recently_viewed_code_snippet|>",
				]
			`);
		});

		test('includes line numbers with correct offset when using visible ranges', () => {
			const content = new StringText('line0\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9');
			const focalRanges = [new OffsetRange(24, 30)];

			const { snippets } = buildSnippets(
				[{ id, content, focalRanges }],
				makeOpts({ maxTokens: 15, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.WithSpaceAfter, pageSize: 2, clippingStrategy: RecentFileClippingStrategy.AroundEditRange }),
			);

			expect(snippets).toMatchInlineSnapshot(`
				[
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/first.txt (truncated)
				4| line4
				5| line5
				<|/recently_viewed_code_snippet|>",
				]
			`);
		});

		test('includes line numbers with offset when visible range is in middle of file', () => {
			const lines = Array.from({ length: 20 }, (_, i) => `content_line_${i}`);
			const content = new StringText(lines.join('\n'));
			const lineLength = 'content_line_0\n'.length;
			const line10Start = 10 * lineLength;
			const focalRanges = [new OffsetRange(line10Start, line10Start + lineLength)];

			const { snippets } = buildSnippets(
				[{ id, content, focalRanges }],
				makeOpts({ maxTokens: 50, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.WithSpaceAfter, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.AroundEditRange }),
			);

			expect(snippets).toMatchInlineSnapshot(`
				[
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/first.txt (truncated)
				10| content_line_10
				11| content_line_11
				12| content_line_12
				13| content_line_13
				14| content_line_14
				<|/recently_viewed_code_snippet|>",
				]
			`);
		});

		test('does not include line numbers when disabled', () => {
			const { snippets } = buildSnippets(
				[{ id, content: nLines(4) }],
				makeOpts({ maxTokens: 2000, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.None, pageSize: 2 }),
			);

			expect(snippets).toMatchInlineSnapshot(`
				[
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/first.txt
				1
				2
				3
				4
				<|/recently_viewed_code_snippet|>",
				]
			`);
		});

		test('includes line numbers for multiple files', () => {
			const { snippets } = buildSnippets(
				[
					{ id, content: nLines(3) },
					{ id: id2, content: nLines(3) },
				],
				makeOpts({ maxTokens: 2000, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.WithSpaceAfter, pageSize: 10 }),
			);

			expect(snippets).toMatchInlineSnapshot(`
				[
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/second.txt
				0| 1
				1| 2
				2| 3
				<|/recently_viewed_code_snippet|>",
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/first.txt
				0| 1
				1| 2
				2| 3
				<|/recently_viewed_code_snippet|>",
				]
			`);
		});

		test('includes line numbers with partial truncation for first file only', () => {
			const { snippets } = buildSnippets(
				[
					{ id, content: nLines(6) },
					{ id: id2, content: nLines(4) },
				],
				makeOpts({ maxTokens: 10, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.WithSpaceAfter, pageSize: 2 }),
			);

			expect(snippets).toMatchInlineSnapshot(`
				[
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/first.txt (truncated)
				0| 1
				1| 2
				2| 3
				3| 4
				<|/recently_viewed_code_snippet|>",
				]
			`);
		});

		test('handles empty content gracefully with line numbers enabled', () => {
			const { snippets } = buildSnippets(
				[{ id, content: new StringText('') }],
				makeOpts({ maxTokens: 2000, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.WithSpaceAfter, pageSize: 2 }),
			);

			expect(snippets.map(splitLines)).toMatchInlineSnapshot(`
				[
				  [
				    "<|recently_viewed_code_snippet|>",
				    "code_snippet_file_path: /src/first.txt",
				    "0| ",
				    "<|/recently_viewed_code_snippet|>",
				  ],
				]
			`);
		});

		test('handles single line content with line numbers', () => {
			const { snippets } = buildSnippets(
				[{ id, content: new StringText('single line') }],
				makeOpts({ maxTokens: 2000, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.WithSpaceAfter, pageSize: 2 }),
			);

			expect(snippets).toMatchInlineSnapshot(`
				[
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/first.txt
				0| single line
				<|/recently_viewed_code_snippet|>",
				]
			`);
		});

		test('line numbers are formatted correctly for double-digit line numbers', () => {
			const { snippets } = buildSnippets(
				[{ id, content: nLines(15) }],
				makeOpts({ maxTokens: 2000, recentlyViewedFilesIncludeLineNumbers: IncludeLineNumbersOption.WithSpaceAfter, pageSize: 20 }),
			);

			expect(snippets).toMatchInlineSnapshot(`
				[
				  "<|recently_viewed_code_snippet|>
				code_snippet_file_path: /src/first.txt
				0| 1
				1| 2
				2| 3
				3| 4
				4| 5
				5| 6
				6| 7
				7| 8
				8| 9
				9| 10
				10| 11
				11| 12
				12| 13
				13| 14
				14| 15
				<|/recently_viewed_code_snippet|>",
				]
			`);
		});
	});

	suite('AroundEditRange strategy', () => {

		test('centers snippet on focal range instead of top of file', () => {
			const lines = Array.from({ length: 100 }, (_, i) => `line_${String(i).padStart(3, '0')}`);
			const content = new StringText(lines.join('\n'));
			const lineLen = 'line_000\n'.length;
			const focalRanges = [new OffsetRange(80 * lineLen, 81 * lineLen)];

			const { snippets } = buildSnippets(
				[{ id, content, focalRanges }],
				makeOpts({ maxTokens: 30, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.AroundEditRange }),
			);

			const snippet = snippets[0];
			expect(snippet).toContain('line_080');
			expect(snippet).not.toContain('line_000');
		});

		test('falls back to top-to-bottom for entries without focal ranges', () => {
			const { snippets } = buildSnippets(
				[{ id, content: nLines(20) }],
				makeOpts({ maxTokens: 10, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.AroundEditRange }),
			);

			const snippet = snippets[0];
			expect(snippet).toContain('1\n2\n3\n4\n5');
		});

		test('clips multiple files around their respective focal ranges', () => {
			const lines1 = Array.from({ length: 50 }, (_, i) => `fileA_${i}`);
			const content1 = new StringText(lines1.join('\n'));
			const lineLen1 = 'fileA_0\n'.length;
			const focalRanges1 = [new OffsetRange(40 * lineLen1, 41 * lineLen1)];

			const lines2 = Array.from({ length: 50 }, (_, i) => `fileB_${i}`);
			const content2 = new StringText(lines2.join('\n'));
			const lineLen2 = 'fileB_0\n'.length;
			const focalRanges2 = [new OffsetRange(10 * lineLen2, 11 * lineLen2)];

			const { snippets, docsInPrompt } = buildSnippets(
				[
					{ id, content: content1, focalRanges: focalRanges1 },
					{ id: id2, content: content2, focalRanges: focalRanges2 },
				],
				makeOpts({ maxTokens: 200, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.AroundEditRange }),
			);

			expect(docsInPrompt.size).toBe(2);
			expect(snippets.find(s => s.includes('fileA_40'))).toBeDefined();
			expect(snippets.find(s => s.includes('fileB_10'))).toBeDefined();
		});
	});

	suite('Proportional strategy', () => {

		test('distributes budget across files instead of greedily consuming', () => {
			const content1 = new StringText(Array.from({ length: 50 }, (_, i) => `A${i}`).join('\n'));
			const lineLen1 = 'A0\n'.length;
			const content2 = new StringText(Array.from({ length: 50 }, (_, i) => `B${i}`).join('\n'));
			const lineLen2 = 'B0\n'.length;

			const { snippets, docsInPrompt } = buildSnippets(
				[
					{ id, content: content1, focalRanges: [new OffsetRange(0, lineLen1)], editEntryCount: 1 },
					{ id: id2, content: content2, focalRanges: [new OffsetRange(0, lineLen2)], editEntryCount: 1 },
				],
				makeOpts({ maxTokens: 40, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.Proportional }),
			);

			expect(docsInPrompt.size).toBe(2);
			expect(snippets.length).toBe(2);
		});

		test('gives more budget to files with more edit locations', () => {
			const content = new StringText(Array.from({ length: 40 }, (_, i) => `x${i}`).join('\n'));
			const lineLen = 'x0\n'.length;

			const { snippets } = buildSnippets(
				[
					{ id, content, focalRanges: [new OffsetRange(0, lineLen)], editEntryCount: 3 },
					{ id: id2, content, focalRanges: [new OffsetRange(0, lineLen)], editEntryCount: 1 },
				],
				makeOpts({ maxTokens: 60, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.Proportional }),
			);

			expect(snippets.length).toBe(2);
			const fileASnippet = snippets.find(s => s.includes('/src/first.txt'))!;
			const fileBSnippet = snippets.find(s => s.includes('/src/second.txt'))!;
			expect(fileASnippet.length).toBeGreaterThan(fileBSnippet.length);
		});

		test('ensures minimum budget per file', () => {
			const smallContent = new StringText('hello\nworld');

			const { snippets, docsInPrompt } = buildSnippets(
				[
					{ id, content: nLines(50), focalRanges: [new OffsetRange(0, 5)], editEntryCount: 10 },
					{ id: id2, content: smallContent, focalRanges: [new OffsetRange(0, 3)], editEntryCount: 1 },
				],
				makeOpts({ maxTokens: 100, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.Proportional }),
			);

			expect(docsInPrompt.size).toBe(2);
			expect(snippets.length).toBe(2);
		});
	});

	suite('RC1: budget enforcement in clipAroundFocalRanges', () => {

		test('does not include content when budget is exhausted', () => {
			const content = new StringText(Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n'));
			const lineLen = 'line0\n'.length;
			const focalRanges = [new OffsetRange(5 * lineLen, 6 * lineLen)];

			const { snippets, docsInPrompt } = buildSnippets(
				[{ id, content, focalRanges }],
				makeOpts({ maxTokens: 0, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.AroundEditRange }),
			);

			expect(snippets.length).toBe(0);
			expect(docsInPrompt.size).toBe(0);
		});

		test('does not cascade negative budget to subsequent files', () => {
			const bigLine = 'x'.repeat(400);
			const bigContent = new StringText(Array.from({ length: 50 }, () => bigLine).join('\n'));
			const bigLineLen = bigLine.length + 1;
			const bigFocalRanges = [new OffsetRange(0, bigLineLen)];

			const smallContent = new StringText(Array.from({ length: 10 }, (_, i) => `small${i}`).join('\n'));
			const smallLineLen = 'small0\n'.length;
			const smallFocalRanges = [new OffsetRange(0, smallLineLen)];

			const { snippets } = buildSnippets(
				[
					{ id, content: bigContent, focalRanges: bigFocalRanges },
					{ id: id2, content: smallContent, focalRanges: smallFocalRanges },
				],
				makeOpts({ maxTokens: 5, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.AroundEditRange }),
			);

			expect(snippets.length).toBe(0);
		});

		test('proportional strategy drops oldest files when focal costs exceed budget', () => {
			const bigLine = 'x'.repeat(400);
			const bigContent = new StringText(Array.from({ length: 50 }, () => bigLine).join('\n'));
			const bigLineLen = bigLine.length + 1;

			const smallContent = new StringText(Array.from({ length: 10 }, (_, i) => `s${i}`).join('\n'));
			const smallLineLen = 's0\n'.length;

			const { snippets, docsInPrompt } = buildSnippets(
				[
					{ id, content: bigContent, focalRanges: [new OffsetRange(0, bigLineLen)], editEntryCount: 1 },
					{ id: id2, content: smallContent, focalRanges: [new OffsetRange(0, smallLineLen)], editEntryCount: 1 },
				],
				makeOpts({ maxTokens: 100, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.Proportional }),
			);

			expect(docsInPrompt.size).toBe(0);
			expect(snippets.length).toBe(0);
		});

		test('proportional strategy total tokens never exceed budget', () => {
			const id3 = DocumentId.create('file:///src/third.txt');
			const makeContent = (prefix: string) =>
				new StringText(Array.from({ length: 30 }, (_, i) => `${prefix}${i}`).join('\n'));
			const lineLen = 'A0\n'.length;

			const maxTokens = 300;
			const { snippets } = buildSnippets(
				[
					{ id, content: makeContent('A'), focalRanges: [new OffsetRange(0, lineLen)], editEntryCount: 2 },
					{ id: id2, content: makeContent('B'), focalRanges: [new OffsetRange(0, lineLen)], editEntryCount: 1 },
					{ id: id3, content: makeContent('C'), focalRanges: [new OffsetRange(0, lineLen)], editEntryCount: 1 },
				],
				makeOpts({ maxTokens, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.Proportional }),
			);

			const totalTokens = snippets.reduce((sum, s) => sum + computeTokens(s), 0);
			expect(totalTokens).toBeLessThanOrEqual(maxTokens);
		});

		test('proportional strategy drops oldest files first when over budget', () => {
			const id3 = DocumentId.create('file:///src/third.txt');
			const content = new StringText(Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n'));
			const lineLen = 'line0\n'.length;

			const focalCost = computeFocalPageCost(content, [new OffsetRange(0, lineLen)], 5, computeTokens)!;
			const maxTokens = focalCost * 2 + 1;

			const { docsInPrompt } = buildSnippets(
				[
					{ id, content, focalRanges: [new OffsetRange(0, lineLen)], editEntryCount: 1 },
					{ id: id2, content, focalRanges: [new OffsetRange(0, lineLen)], editEntryCount: 1 },
					{ id: id3, content, focalRanges: [new OffsetRange(0, lineLen)], editEntryCount: 1 },
				],
				makeOpts({ maxTokens, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.Proportional }),
			);

			expect(docsInPrompt.size).toBe(2);
			expect(docsInPrompt.has(id)).toBe(true);
			expect(docsInPrompt.has(id2)).toBe(true);
			expect(docsInPrompt.has(id3)).toBe(false);
		});

		test('single file gets full budget', () => {
			const content = new StringText(Array.from({ length: 50 }, (_, i) => `x${i}`).join('\n'));
			const lineLen = 'x0\n'.length;

			const { snippets, docsInPrompt } = buildSnippets(
				[{ id, content, focalRanges: [new OffsetRange(0, lineLen)], editEntryCount: 1 }],
				makeOpts({ maxTokens: 200, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.Proportional }),
			);

			expect(docsInPrompt.size).toBe(1);
			expect(snippets.length).toBe(1);
			expect(snippets[0]).toContain('x20');
		});
	});

	suite('RC3: focal range span capping', () => {

		test('wide-scatter focal ranges are capped to prioritize the most recent', () => {
			const lines = Array.from({ length: 100 }, (_, i) => `line_${String(i).padStart(3, '0')}`);
			const content = new StringText(lines.join('\n'));
			const lineLen = 'line_000\n'.length;

			const focalRanges = [
				new OffsetRange(5 * lineLen, 6 * lineLen),
				new OffsetRange(95 * lineLen, 96 * lineLen),
			];

			const { snippets } = buildSnippets(
				[{ id, content, focalRanges }],
				makeOpts({ maxTokens: 30, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.AroundEditRange }),
			);

			const snippet = snippets[0];
			expect(snippet).toContain('line_005');
			expect(snippet).not.toContain('line_095');
		});

		test('nearby focal ranges are all included within span cap', () => {
			const lines = Array.from({ length: 100 }, (_, i) => `line_${String(i).padStart(3, '0')}`);
			const content = new StringText(lines.join('\n'));
			const lineLen = 'line_000\n'.length;

			const focalRanges = [
				new OffsetRange(50 * lineLen, 51 * lineLen),
				new OffsetRange(52 * lineLen, 53 * lineLen),
			];

			const { snippets } = buildSnippets(
				[{ id, content, focalRanges }],
				makeOpts({ maxTokens: 50, pageSize: 5, clippingStrategy: RecentFileClippingStrategy.AroundEditRange }),
			);

			const snippet = snippets[0];
			expect(snippet).toContain('line_050');
			expect(snippet).toContain('line_052');
		});
	});
});

suite('selectFocalRangesWithinSpanCap', () => {
	const charsPerLine = 10;
	const getLineNumber = (offset: number) => Math.floor(offset / charsPerLine) + 1;

	test('returns all ranges when span fits within cap', () => {
		const ranges = [
			new OffsetRange(10, 20),
			new OffsetRange(20, 30),
		];
		const result = selectFocalRangesWithinSpanCap(ranges, getLineNumber, 10);
		expect(result).toEqual(ranges);
	});

	test('returns only the first range when adding the second exceeds span cap', () => {
		const ranges = [
			new OffsetRange(10, 20),
			new OffsetRange(500, 510),
		];
		const result = selectFocalRangesWithinSpanCap(ranges, getLineNumber, 10);
		expect(result).toEqual([ranges[0]]);
	});

	test('includes ranges greedily until cap is exceeded', () => {
		const ranges = [
			new OffsetRange(100, 110),
			new OffsetRange(120, 130),
			new OffsetRange(150, 160),
			new OffsetRange(500, 510),
		];
		const result = selectFocalRangesWithinSpanCap(ranges, getLineNumber, 10);
		expect(result).toEqual([ranges[0], ranges[1], ranges[2]]);
	});

	test('single range is always returned', () => {
		const ranges = [new OffsetRange(100, 110)];
		const result = selectFocalRangesWithinSpanCap(ranges, getLineNumber, 1);
		expect(result).toEqual(ranges);
	});

	test('empty ranges are handled', () => {
		const result = selectFocalRangesWithinSpanCap([], getLineNumber, 10);
		expect(result).toEqual([]);
	});
});

suite('historyEntriesToCodeSnippet', () => {

	const docId = DocumentId.create('file:///src/example.txt');

	function makeEditEntry(base: string, edit: StringEdit): IXtabHistoryEditEntry {
		return {
			kind: 'edit',
			docId,
			edit: new RootedEdit(new StringText(base), edit),
		};
	}

	function makeVisibleEntry(content: string, visibleRanges: readonly OffsetRange[]): IXtabHistoryVisibleRangesEntry {
		return {
			kind: 'visibleRanges',
			docId,
			documentContent: new StringText(content),
			visibleRanges,
		};
	}

	test('single edit entry returns its new ranges directly', () => {
		const edit = StringEdit.insert(5, ' world');
		const entry = makeEditEntry('hello', edit);

		const result = historyEntriesToCodeSnippet([entry]);

		expect(result.content.value).toBe('hello world');
		expect(result.focalRanges).toEqual([new OffsetRange(5, 11)]);
		expect(result.editEntryCount).toBe(1);
	});

	test('two edit entries: older ranges are transformed through the newer edit', () => {
		const olderEdit = StringEdit.replace(new OffsetRange(0, 2), 'XXX');
		const newerEdit = StringEdit.insert(0, 'YY');

		const olderEntry = makeEditEntry('AABB', olderEdit);
		const newerEntry = makeEditEntry('XXXBB', newerEdit);

		const result = historyEntriesToCodeSnippet([newerEntry, olderEntry]);

		expect(result.content.value).toBe('YYXXXBB');
		expect(result.focalRanges).toEqual([
			new OffsetRange(0, 2),
			new OffsetRange(2, 5),
		]);
		expect(result.editEntryCount).toBe(2);
	});

	test('three edit entries: ranges chain through two edits', () => {
		const e2 = makeEditEntry('abcdef', StringEdit.delete(new OffsetRange(0, 3)));
		const e1 = makeEditEntry('def', StringEdit.insert(0, 'XY'));
		const e0 = makeEditEntry('XYdef', StringEdit.insert(5, 'Z'));

		const result = historyEntriesToCodeSnippet([e0, e1, e2]);

		expect(result.content.value).toBe('XYdefZ');
		expect(result.focalRanges).toEqual([
			new OffsetRange(5, 6),
			new OffsetRange(0, 2),
			new OffsetRange(2, 2),
		]);
		expect(result.editEntryCount).toBe(3);
	});

	test('visibleRanges entries are skipped for focal range collection', () => {
		const edit = StringEdit.insert(5, ' world');
		const editEntry = makeEditEntry('hello', edit);
		const visibleEntry = makeVisibleEntry('hello world', [new OffsetRange(0, 5)]);

		const result = historyEntriesToCodeSnippet([visibleEntry, editEntry]);

		expect(result.content.value).toBe('hello world');
		expect(result.focalRanges).toEqual([new OffsetRange(5, 11)]);
		expect(result.editEntryCount).toBe(1);
	});

	test('only visibleRanges entries produce no focal ranges', () => {
		const entry = makeVisibleEntry('hello', [new OffsetRange(0, 3)]);

		const result = historyEntriesToCodeSnippet([entry]);

		expect(result.content.value).toBe('hello');
		expect(result.focalRanges).toBeUndefined();
		expect(result.editEntryCount).toBe(1);
	});

	test('edit after deletion: ranges are correctly shifted', () => {
		const olderEdit = StringEdit.delete(new OffsetRange(3, 8));
		const newerEdit = StringEdit.replace(new OffsetRange(0, 3), 'XX');

		const olderEntry = makeEditEntry('aaa_bbb_ccc', olderEdit);
		const newerEntry = makeEditEntry('aaaccc', newerEdit);

		const result = historyEntriesToCodeSnippet([newerEntry, olderEntry]);

		expect(result.content.value).toBe('XXccc');
		expect(result.focalRanges).toEqual([
			new OffsetRange(0, 2),
			new OffsetRange(2, 2),
		]);
	});
});

suite('appendLanguageContextSnippets', () => {

	test('does not add line numbers without a source range', () => {
		const languageContext: LanguageContextResponse = {
			start: 0,
			end: 0,
			items: [{
				context: {
					kind: ContextKind.Snippet,
					priority: 1,
					uri: Uri.parse('file:///src/context.ts'),
					value: 'first line\nsecond line',
				},
				timeStamp: 0,
				onTimeout: false,
			}],
		};
		const snippets: string[] = [];

		appendLanguageContextSnippets(languageContext, snippets, 100, computeTokens);

		expect(snippets).toMatchInlineSnapshot(`
			[
			  "<|recently_viewed_code_snippet|>
			code_snippet_file_path: /src/context.ts
			first line
			second line
			<|/recently_viewed_code_snippet|>",
			]
		`);
	});
});

suite('appendNeighborFileSnippets', () => {

	function makeNeighbor(uri: string, snippet: string, startLine: number, score = 0.5, isFromRelatedFile = false): INeighborFileSnippet {
		const lineCount = snippet.split(/\r?\n/).length;
		return { uri, relativePath: uri, snippet, lineRange: new LineRange0Based(startLine, startLine + lineCount), score, isFromRelatedFile };
	}

	test('uses the original source line range when adding line numbers', () => {
		const snippets: string[] = [];
		const docsInPrompt = new Set<DocumentId>();
		appendNeighborFileSnippets(
			[makeNeighbor('file:///src/n1.ts', 'a\nb', 5)],
			snippets,
			docsInPrompt,
			100,
			computeTokens,
			IncludeLineNumbersOption.WithSpaceAfter,
		);
		expect(snippets).toMatchInlineSnapshot(`
			[
			  "<|recently_viewed_code_snippet|>
			code_snippet_file_path: /src/n1.ts
			5| a
			6| b
			<|/recently_viewed_code_snippet|>",
			]
		`);
		expect(docsInPrompt.has(DocumentId.create('file:///src/n1.ts'))).toBe(true);
	});

	test('uses the original source line range without spacing after line numbers', () => {
		const snippets: string[] = [];
		appendNeighborFileSnippets(
			[makeNeighbor('file:///src/n1.ts', 'a\nb', 12)],
			snippets,
			new Set<DocumentId>(),
			100,
			computeTokens,
			IncludeLineNumbersOption.WithoutSpace,
		);
		expect(snippets).toMatchInlineSnapshot(`
			[
			  "<|recently_viewed_code_snippet|>
			code_snippet_file_path: /src/n1.ts
			12|a
			13|b
			<|/recently_viewed_code_snippet|>",
			]
		`);
	});

	test('omits line numbers for related-file snippets even when line numbers are requested', () => {
		const snippets: string[] = [];
		appendNeighborFileSnippets(
			[makeNeighbor('file:///src/related.ts', 'a\nb', 5, 0.5, true)],
			snippets,
			new Set<DocumentId>(),
			100,
			computeTokens,
			IncludeLineNumbersOption.WithSpaceAfter,
		);
		expect(snippets).toMatchInlineSnapshot(`
			[
			  "<|recently_viewed_code_snippet|>
			code_snippet_file_path: /src/related.ts
			a
			b
			<|/recently_viewed_code_snippet|>",
			]
		`);
	});

	test('skips oversize snippets but keeps trying smaller ones', () => {
		const snippets: string[] = [];
		const docsInPrompt = new Set<DocumentId>();
		appendNeighborFileSnippets(
			[
				makeNeighbor('file:///src/big.ts', 'b'.repeat(32), 0),
				makeNeighbor('file:///src/small.ts', 'aa', 0),
			],
			snippets,
			docsInPrompt,
			5,
			computeTokens,
			IncludeLineNumbersOption.None,
		);
		expect(snippets).toHaveLength(1);
		expect(snippets[0]).toContain('/src/small.ts');
	});

	test('skips snippets whose document is already in the prompt', () => {
		const dupDoc = DocumentId.create('file:///src/dup.ts');
		const docsInPrompt = new Set<DocumentId>([dupDoc]);
		const snippets: string[] = [];
		appendNeighborFileSnippets(
			[
				makeNeighbor('file:///src/dup.ts', 'duplicated', 0),
				makeNeighbor('file:///src/fresh.ts', 'fresh', 0),
			],
			snippets,
			docsInPrompt,
			100,
			computeTokens,
			IncludeLineNumbersOption.None,
		);
		expect(snippets).toHaveLength(1);
		expect(snippets[0]).toContain('/src/fresh.ts');
	});

	test('no-op when no snippets provided', () => {
		const snippets: string[] = [];
		const docsInPrompt = new Set<DocumentId>();
		const result = appendNeighborFileSnippets([], snippets, docsInPrompt, 100, computeTokens, IncludeLineNumbersOption.None);
		expect(snippets).toEqual([]);
		expect(result).toEqual({ nComputed: 0, nIncluded: 0, includedIndices: [], tokensConsumed: 0 });
	});

	test('selects highest-score snippets first when budget is tight', () => {
		const snippets: string[] = [];
		const docsInPrompt = new Set<DocumentId>();
		appendNeighborFileSnippets(
			[
				makeNeighbor('file:///src/low.ts', 'l'.repeat(32), 0, 0.1),
				makeNeighbor('file:///src/high.ts', 'h'.repeat(32), 0, 0.9),
			],
			snippets,
			docsInPrompt,
			10,
			computeTokens,
			IncludeLineNumbersOption.None,
		);
		expect(snippets).toHaveLength(1);
		expect(snippets[0]).toContain('/src/high.ts');
	});

	test('places highest-score snippet last (closest to current file)', () => {
		const snippets: string[] = [];
		const docsInPrompt = new Set<DocumentId>();
		appendNeighborFileSnippets(
			[
				makeNeighbor('file:///src/low.ts', 'low', 0, 0.1),
				makeNeighbor('file:///src/mid.ts', 'mid', 0, 0.5),
				makeNeighbor('file:///src/high.ts', 'high', 0, 0.9),
			],
			snippets,
			docsInPrompt,
			100,
			computeTokens,
			IncludeLineNumbersOption.None,
		);
		expect(snippets).toHaveLength(3);
		expect(snippets[0]).toContain('/src/low.ts');
		expect(snippets[1]).toContain('/src/mid.ts');
		expect(snippets[2]).toContain('/src/high.ts');
	});

	test('reports included indices, skipping oversize and budget-exhausted entries', () => {
		const snippets: string[] = [];
		const docsInPrompt = new Set<DocumentId>();
		const result = appendNeighborFileSnippets(
			[
				makeNeighbor('file:///src/i0.ts', 'a', 0, 0.1),
				makeNeighbor('file:///src/i1.ts', 'b', 0, 0.2),
				makeNeighbor('file:///src/i2.ts', 'c', 0, 0.3),
				makeNeighbor('file:///src/i3.ts', 'd', 0, 0.4),
				makeNeighbor('file:///src/i4.ts', 'e', 0, 0.5),
				makeNeighbor('file:///src/i5.ts', 'h'.repeat(64), 0, 0.6),
				makeNeighbor('file:///src/i6.ts', 'g', 0, 0.9),
			],
			snippets,
			docsInPrompt,
			4,
			computeTokens,
			IncludeLineNumbersOption.None,
		);
		expect(result).toEqual({ nComputed: 7, nIncluded: 4, includedIndices: [2, 3, 4, 6], tokensConsumed: 4 });
	});
});
