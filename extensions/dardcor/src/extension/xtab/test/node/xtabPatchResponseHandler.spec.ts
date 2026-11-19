/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentId } from '../../../../platform/inlineEdits/common/dataTypes/documentId';
import { NoNextEditReason, StreamedEdit } from '../../../../platform/inlineEdits/common/statelessNextEditProvider';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { AsyncIterUtils } from '../../../../util/common/asyncIterableUtils';
import { AsyncIterableSource } from '../../../../util/dardcor/base/common/async';
import { LineReplacement } from '../../../../util/dardcor/editor/common/core/edits/lineEdit';
import { Position } from '../../../../util/dardcor/editor/common/core/position';
import { LineRange } from '../../../../util/dardcor/editor/common/core/ranges/lineRange';
import { StringText } from '../../../../util/dardcor/editor/common/core/text/abstractText';
import { ensureDependenciesAreSet } from '../../../../util/dardcor/editor/common/core/text/positionToOffset';
import { FetchStreamError } from '../../common/fetchStreamError';
import { CurrentDocument } from '../../common/xtabCurrentDocument';
import { DuplicateAdditionRemoval, tryRemoveDuplicateAdditions, XtabPatchResponseHandler } from '../../node/xtabPatchResponseHandler';
import { DuplicateAdditionsMode } from '../../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';

async function consumeHandleResponse(
	...args: Parameters<typeof XtabPatchResponseHandler.handleResponse>
): Promise<{ edits: StreamedEdit[]; returnValue: NoNextEditReason }> {
	const gen = XtabPatchResponseHandler.handleResponse(...args);
	const edits: StreamedEdit[] = [];
	for (; ;) {
		const result = await gen.next();
		if (result.done) {
			return { edits, returnValue: result.value };
		}
		edits.push(result.value);
	}
}

function callDedup(
	patch: { addedLines: string[]; removedLines: string[]; lineNumZeroBased: number },
	fileLines: string[],
): DuplicateAdditionRemoval | undefined {
	const text = new StringText(fileLines.join('\n'));
	const replacement = new LineReplacement(
		new LineRange(patch.lineNumZeroBased + 1, patch.lineNumZeroBased + 1 + patch.removedLines.length),
		patch.addedLines,
	);
	return tryRemoveDuplicateAdditions(replacement, text);
}

describe('XtabCustomDiffPatchResponseHandler', () => {

	beforeEach(() => {
		ensureDependenciesAreSet();
	});

	async function collectPatches(patchText: string): Promise<string> {
		const linesStream = AsyncIterUtils.fromArray(patchText.split('\n'));
		const patches = await AsyncIterUtils.toArray(XtabPatchResponseHandler.extractEdits(linesStream));
		return patches.map(p => p.toString()).join('\n');
	}

	it('should parse a simple patch correctly', async () => {
		const patchText = `file1.txt:10
-Old line 1
-Old line 2
+New line 1
+New line 2`;
		const patches = await collectPatches(patchText);
		expect(patches).toEqual(patchText);
	});

	it('should parse a simple patch correctly despite trailing newline', async () => {
		const patchText = `file1.txt:10
-Old line 1
-Old line 2
+New line 1
+New line 2
`;
		const patches = await collectPatches(patchText);
		expect(patches).toEqual(patchText.trim());
	});

	it('should parse a simple patch correctly', async () => {
		const patchText = `/absolutePath/to/my_file.ts:1
-Old line 1
+New line 1
+New line 2
relative/path/to/another_file.js:42
-Removed line
+Added line`;
		const patches = await collectPatches(patchText);
		expect(patches).toEqual(patchText);
	});

	it('discard a patch if no valid header', async () => {
		const patchText = `myFile.ts:
+New line 1
+New line 2
another_file.js:32
-Removed line
+Added line`;
		const patches = await collectPatches(patchText);
		expect(patches).toMatchInlineSnapshot(`
			"another_file.js:32
			-Removed line
			+Added line"
		`);
	});

	it('discard a patch if no valid header - 2', async () => {
		const patchText = `myFile.ts:42
+New line 1
+New line 2
another_file.js:
-Removed line
+Added line`;
		const patches = await collectPatches(patchText);
		expect(patches).toMatchInlineSnapshot(`
			"myFile.ts:42
			+New line 1
			+New line 2"
		`);
	});

	it('discard a patch has no removed lines', async () => {
		const patchText = `myFile.ts:42
+New line 1
+New line 2`;
		const patches = await collectPatches(patchText);
		expect(patches).toMatchInlineSnapshot(`
			"myFile.ts:42
			+New line 1
			+New line 2"
		`);
	});

	it('discard a patch has no new lines', async () => {
		const patchText = `myFile.ts:42
-Old line 1
-Old line 2`;
		const patches = await collectPatches(patchText);
		expect(patches).toMatchInlineSnapshot(`
			"myFile.ts:42
			-Old line 1
			-Old line 2"
		`);
	});

	it('no-op diff', async () => {
		const patchText = `myFile.ts:42
-Old line 1
+Old line 1`;
		const patches = await collectPatches(patchText);
		expect(patches).toMatchInlineSnapshot(`
			"myFile.ts:42
			-Old line 1
			+Old line 1"
		`);
	});

	it('stops yielding edits when stream rejects with FetchStreamError', async () => {
		const cancellationReason = new NoNextEditReason.GotCancelled('afterFetchCall');
		const docId = DocumentId.create('file:///file.ts');
		const documentBeforeEdits = new CurrentDocument(new StringText('old\n'), new Position(1, 1));

		async function* makeStream(): AsyncGenerator<string> {
			yield '/file.ts:0';
			yield '-old';
			yield '+new';
			yield '/file.ts:5';
			yield '-another old';
			yield '+another new';
			throw new FetchStreamError(cancellationReason);
		}

		const { edits, returnValue } = await consumeHandleResponse(
			makeStream(),
			documentBeforeEdits,
			docId,
			undefined,
			undefined,
			new TestLogService(),
		);

		expect(edits).toHaveLength(1);
		expect(returnValue).toEqual(cancellationReason);
	});

	it('returns FetchStreamError reason when stream rejects before any patches', async () => {
		const cancellationReason = new NoNextEditReason.GotCancelled('afterFetchCall');
		const docId = DocumentId.create('file:///file.ts');
		const documentBeforeEdits = new CurrentDocument(new StringText('old\n'), new Position(1, 1));

		const source = new AsyncIterableSource<string>();
		source.reject(new FetchStreamError(cancellationReason));

		const { edits, returnValue } = await consumeHandleResponse(
			source.asyncIterable,
			documentBeforeEdits,
			docId,
			undefined,
			undefined,
			new TestLogService(),
		);

		expect(edits).toHaveLength(0);
		expect(returnValue).toBe(cancellationReason);
	});

	describe('tryRemoveDuplicateAdditions', () => {

		it('removes a single trailing duplicate (closing brace case)', () => {
			const fileLines = ['function foo() {', '    let x = 1;', '}'];
			const result = callDedup(
				{
					addedLines: ['    let x = 1;', '    let y = 2;', '}'],
					removedLines: ['    let x = 1;'],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result?.kind).toBe('suffix');
			expect(result?.newAdditions).toEqual(['    let x = 1;', '    let y = 2;']);
			expect(result?.removedLines).toEqual(['}']);
		});

		it('removes a multi-line trailing duplicate', () => {
			const fileLines = ['a', 'b', 'c', 'd', 'e'];
			const result = callDedup(
				{
					addedLines: ['B', 'c', 'd'],
					removedLines: ['b'],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result?.kind).toBe('suffix');
			expect(result?.newAdditions).toEqual(['B']);
			expect(result?.removedLines).toEqual(['c', 'd']);
		});

		it('picks the longest suffix match', () => {
			const fileLines = ['x', 'a', 'b', 'c'];
			const result = callDedup(
				{
					addedLines: ['new', 'a', 'b', 'c'],
					removedLines: [],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result?.kind).toBe('suffix');
			expect(result?.newAdditions).toEqual(['new']);
			expect(result?.removedLines).toEqual(['a', 'b', 'c']);
		});

		it('removes a leading duplicate when the line is meaningful', () => {
			const fileLines = ['header', 'existing line', 'trailer'];
			const result = callDedup(
				{
					addedLines: ['existing line', 'extra'],
					removedLines: [],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result?.kind).toBe('prefix');
			expect(result?.newAdditions).toEqual(['extra']);
			expect(result?.removedLines).toEqual(['existing line']);
		});

		it('drops a duplicate inner `}` when the patch is purely additive (headline bug fix)', () => {
			const fileLines = ['function f() {', '  doIt();', '}'];
			const result = callDedup(
				{
					addedLines: ['}'],
					removedLines: [],
					lineNumZeroBased: 2,
				},
				fileLines,
			);
			expect(result?.kind).toBe('suffix');
			expect(result?.newAdditions).toEqual([]);
			expect(result?.removedLines).toEqual(['}']);
		});

		it('drops a duplicate `}` even when the patch removes content first', () => {
			const fileLines = ['function outer() {', '  body();', '}'];
			const result = callDedup(
				{
					addedLines: ['}'],
					removedLines: ['  body();'],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result?.kind).toBe('suffix');
			expect(result?.newAdditions).toEqual([]);
			expect(result?.removedLines).toEqual(['}']);
		});

		it('does not drop a leading whitespace-only duplicate', () => {
			const fileLines = ['', '', 'existing'];
			const result = callDedup(
				{
					addedLines: ['', 'first new line'],
					removedLines: [],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result).toBeUndefined();
		});

		it('removes streamEdits-style middle duplicate but preserves new content after the matched range', () => {
			const fileLines = ['x', 'cont1 long', 'cont2 long', 'y'];
			const result = callDedup(
				{
					addedLines: ['new1', 'new2', 'cont1 long', 'cont2 long', 'extra'],
					removedLines: [],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result?.kind).toBe('middle');
			expect(result?.newAdditions).toEqual(['new1', 'new2', 'extra']);
			expect(result?.removedLines).toEqual(['cont1 long', 'cont2 long']);
		});

		it('greedily extends a middle match while the streamEdits regenerated context continues', () => {
			const fileLines = ['x', 'cont1 long', 'cont2 long', 'cont3 long', 'y'];
			const result = callDedup(
				{
					addedLines: ['new1', 'new2', 'cont1 long', 'cont2 long', 'cont3 long', 'tail'],
					removedLines: [],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result?.kind).toBe('middle');
			expect(result?.newAdditions).toEqual(['new1', 'new2', 'tail']);
			expect(result?.removedLines).toEqual(['cont1 long', 'cont2 long', 'cont3 long']);
		});

		it('does not match a middle pair when the following lines are not meaningful', () => {
			const fileLines = ['x', '', '', 'y'];
			const result = callDedup(
				{
					addedLines: ['new1', 'new2', '', '', 'extra'],
					removedLines: [],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result).toBeUndefined();
		});

		it('returns undefined when no duplicate is detected', () => {
			const fileLines = ['unrelated1', 'unrelated2'];
			const result = callDedup(
				{
					addedLines: ['new1', 'new2'],
					removedLines: [],
					lineNumZeroBased: 0,
				},
				fileLines,
			);
			expect(result).toBeUndefined();
		});

		it('returns undefined when there are no following lines', () => {
			const fileLines = ['only line'];
			const result = callDedup(
				{
					addedLines: ['new1'],
					removedLines: ['only line'],
					lineNumZeroBased: 0,
				},
				fileLines,
			);
			expect(result).toBeUndefined();
		});

		it('returns undefined when there are no additions', () => {
			const fileLines = ['a', 'b'];
			const result = callDedup(
				{
					addedLines: [],
					removedLines: ['a'],
					lineNumZeroBased: 0,
				},
				fileLines,
			);
			expect(result).toBeUndefined();
		});

		it('handles patch at the very end of the file (no following lines)', () => {
			const fileLines = ['line0', 'line1'];
			const result = callDedup(
				{
					addedLines: ['new1'],
					removedLines: ['line1'],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result).toBeUndefined();
		});

		it('does not chain shapes — suffix match returns immediately without firing middle', () => {
			const fileLines = ['  }', '}', 'nextLine'];
			const result = callDedup(
				{
					addedLines: ['  newCode();', '  }', '}', '  }', '}'],
					removedLines: [],
					lineNumZeroBased: 0,
				},
				fileLines,
			);
			expect(result?.kind).toBe('suffix');
			expect(result?.newAdditions).toEqual(['  newCode();', '  }', '}']);
			expect(result?.removedLines).toEqual(['  }', '}']);
		});

		it('handles file without trailing newline', () => {
			const fileLines = 'function foo() {\n    let x = 1;\n}'.split('\n');
			const result = callDedup(
				{
					addedLines: ['    let x = 1;', '    let y = 2;', '}'],
					removedLines: ['    let x = 1;'],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result?.kind).toBe('suffix');
			expect(result?.newAdditions).toEqual(['    let x = 1;', '    let y = 2;']);
		});

		it('handles file with trailing newline (extra empty line at end)', () => {
			const fileLines = 'function foo() {\n    let x = 1;\n}\n'.split('\n');
			const result = callDedup(
				{
					addedLines: ['    let x = 1;', '    let y = 2;', '}'],
					removedLines: ['    let x = 1;'],
					lineNumZeroBased: 1,
				},
				fileLines,
			);
			expect(result?.kind).toBe('suffix');
			expect(result?.newAdditions).toEqual(['    let x = 1;', '    let y = 2;']);
		});

		it('returns undefined for an out-of-range lineNumZeroBased', () => {
			const fileLines = ['a', 'b'];
			const result = callDedup(
				{
					addedLines: ['x'],
					removedLines: [],
					lineNumZeroBased: 100,
				},
				fileLines,
			);
			expect(result).toBeUndefined();
		});
	});

	describe('handleResponse with duplicateAdditionsMode', () => {

		it('strips trailing duplicate addition in TrimDuplicate mode', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 1));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let x = 1;';
				yield '+    let y = 2;';
				yield '+}';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.TrimDuplicate,
			);

			expect(edits).toHaveLength(1);
			const lineReplacement = edits[0].edit as LineReplacement;
			expect(lineReplacement.newLines).toEqual(['    let x = 1;', '    let y = 2;']);
		});

		it('does not strip duplicates in Off mode (default)', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 1));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let x = 1;';
				yield '+    let y = 2;';
				yield '+}';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
			);

			expect(edits).toHaveLength(1);
			const lineReplacement = edits[0].edit as LineReplacement;
			expect(lineReplacement.newLines).toEqual(['    let x = 1;', '    let y = 2;', '}']);
		});

		it('returns NoSuggestions (not FilteredOut) when every patch is dropped by TrimDuplicate dedup', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n    let y = 2;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(1, 1));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '+    let x = 1;';
			}

			const { edits, returnValue } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.TrimDuplicate,
			);

			expect(edits).toHaveLength(0);
			expect(returnValue).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('returns NoSuggestions when the model produces no edits at all', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const documentBeforeEdits = new CurrentDocument(new StringText('a\nb\n'), new Position(1, 1));

			async function* makeStream(): AsyncGenerator<string> {
			}

			const { edits, returnValue } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.TrimDuplicate,
			);

			expect(edits).toHaveLength(0);
			expect(returnValue).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('still returns NoSuggestions if at least one edit was yielded after dedup', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n    let y = 2;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 1));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let z = 99;';
				yield '/test.ts:2';
				yield '+    let y = 2;';
			}

			const { edits, returnValue } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.TrimDuplicate,
			);

			expect(edits).toHaveLength(1);
			expect(returnValue).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('skips dedup for non-active documents', async () => {
			const docId = DocumentId.create('file:///active.ts');
			const docContent = 'a\nb\nc\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(1, 1));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/other.ts:0';
				yield '-old';
				yield '+a';
				yield '+b';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.TrimDuplicate,
			);

			expect(edits).toHaveLength(1);
			const lineReplacement = edits[0].edit as LineReplacement;
			expect(lineReplacement.newLines).toEqual(['a', 'b']);
		});

		it('DropPatch mode drops the offending patch but continues yielding subsequent patches', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n}\nfunction bar() {\n    let y = 2;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 1));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let x = 1;';
				yield '+}';
				yield '/test.ts:4';
				yield '-    let y = 2;';
				yield '+    let y = 42;';
			}

			const { edits, returnValue } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.DropPatch,
			);

			expect(edits).toHaveLength(1);
			const lineReplacement = edits[0].edit as LineReplacement;
			expect(lineReplacement.newLines).toEqual(['    let y = 42;']);
			expect(returnValue).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('DropAllRemaining mode drops the offending patch and every subsequent patch', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n}\nfunction bar() {\n    let y = 2;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 1));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:0';
				yield '-function foo() {';
				yield '+function fooRenamed() {';
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let x = 1;';
				yield '+}';
				yield '/test.ts:4';
				yield '-    let y = 2;';
				yield '+    let y = 42;';
			}

			const { edits, returnValue } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.DropAllRemaining,
			);

			expect(edits).toHaveLength(1);
			const lineReplacement = edits[0].edit as LineReplacement;
			expect(lineReplacement.newLines).toEqual(['function fooRenamed() {']);
			expect(returnValue).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});
	});

	describe('progressive ghost-text reveal via extractEdits', () => {

		async function collectPatchesWithCursor(patchText: string, cursorLineZeroBased: number, activeDocPath: string = 'file.py', allowMultiLineRemoval: boolean = false): Promise<string> {
			const linesStream = AsyncIterUtils.fromArray(patchText.split('\n'));
			const patches = await AsyncIterUtils.toArray(XtabPatchResponseHandler.extractEdits(linesStream, cursorLineZeroBased, activeDocPath, allowMultiLineRemoval));
			return patches.map(p => p.toString()).join('\n');
		}

		it('splits ghost-text patch into cursor-line replacement and continuation insertion', async () => {
			const result = await collectPatchesWithCursor(
				[
					'file.py:4',
					'-lineA',
					'+lineA_extended',
					'+lineB',
					'+lineC',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'file.py:5',
				'+lineB',
				'+lineC',
			].join('\n'));
		});

		it('splits when removed line equals first added line', async () => {
			const result = await collectPatchesWithCursor(
				[
					'file.py:4',
					'-lineA',
					'+lineA',
					'+lineB',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA',
				'file.py:5',
				'+lineB',
			].join('\n'));
		});

		it('does not split when cursor line does not match patch line', async () => {
			const result = await collectPatchesWithCursor(
				[
					'file.py:4',
					'-lineA',
					'+lineA_extended',
					'+lineB',
				].join('\n'),
				10,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'+lineB',
			].join('\n'));
		});

		it('does not split when there are multiple removed lines', async () => {
			const result = await collectPatchesWithCursor(
				[
					'file.py:4',
					'-lineA',
					'-lineB',
					'+lineA_extended',
					'+lineC',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'-lineB',
				'+lineA_extended',
				'+lineC',
			].join('\n'));
		});

		it('does not split when edit is not additive', async () => {
			const result = await collectPatchesWithCursor(
				[
					'file.py:4',
					'-hello world',
					'+goodbye',
					'+lineB',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-hello world',
				'+goodbye',
				'+lineB',
			].join('\n'));
		});

		it('only splits the first patch, not subsequent ones', async () => {
			const result = await collectPatchesWithCursor(
				[
					'file.py:4',
					'-lineA',
					'+lineA_extended',
					'+lineB',
					'file.py:10',
					'-lineX',
					'+lineX_extended',
					'+lineY',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'file.py:5',
				'+lineB',
				'file.py:10',
				'-lineX',
				'+lineX_extended',
				'+lineY',
			].join('\n'));
		});

		it('handles ghost-text with only one added line (no continuation patch)', async () => {
			const result = await collectPatchesWithCursor(
				[
					'file.py:4',
					'-lineA',
					'+lineA_extended',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
			].join('\n'));
		});

		it('does not split when cursorLineZeroBased is not provided', async () => {
			const linesStream = AsyncIterUtils.fromArray([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'+lineB',
			]);
			const patches = await AsyncIterUtils.toArray(XtabPatchResponseHandler.extractEdits(linesStream));
			const result = patches.map(p => p.toString()).join('\n');
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'+lineB',
			].join('\n'));
		});

		it('does not split when patch targets a different file', async () => {
			const result = await collectPatchesWithCursor(
				[
					'other.py:4',
					'-lineA',
					'+lineA_extended',
					'+lineB',
				].join('\n'),
				4,
				'file.py',
			);
			expect(result).toEqual([
				'other.py:4',
				'-lineA',
				'+lineA_extended',
				'+lineB',
			].join('\n'));
		});

		it('does not split second patch even if it matches cursor line', async () => {
			const result = await collectPatchesWithCursor(
				[
					'file.py:0',
					'-import os',
					'+import sys',
					'file.py:4',
					'-lineA',
					'+lineA_extended',
					'+lineB',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:0',
				'-import os',
				'+import sys',
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'+lineB',
			].join('\n'));
		});
	});

	describe('progressive ghost-text reveal (multi-line) via extractEdits', () => {

		async function collectMultiLine(patchText: string, cursorLineZeroBased: number, activeDocPath: string = 'file.py'): Promise<string> {
			const linesStream = AsyncIterUtils.fromArray(patchText.split('\n'));
			const patches = await AsyncIterUtils.toArray(XtabPatchResponseHandler.extractEdits(linesStream, cursorLineZeroBased, activeDocPath, true));
			return patches.map(p => p.toString()).join('\n');
		}

		it('splits a multi-removed-line patch into cursor-line replacement + continuation replacement', async () => {
			const result = await collectMultiLine(
				[
					'file.py:4',
					'-lineA',
					'-lineB',
					'+lineA_extended',
					'+lineB_changed',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'file.py:5',
				'-lineB',
				'+lineB_changed',
			].join('\n'));
		});

		it('does not split a multi-removed-line patch when allowMultiLineRemoval is off', async () => {
			const linesStream = AsyncIterUtils.fromArray([
				'file.py:4',
				'-lineA',
				'-lineB',
				'+lineA_extended',
				'+lineB_changed',
			]);
			const patches = await AsyncIterUtils.toArray(XtabPatchResponseHandler.extractEdits(linesStream, 4, 'file.py'));
			const result = patches.map(p => p.toString()).join('\n');
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'-lineB',
				'+lineA_extended',
				'+lineB_changed',
			].join('\n'));
		});

		it('continuation is a deletion when fewer added than removed lines', async () => {
			const result = await collectMultiLine(
				[
					'file.py:4',
					'-lineA',
					'-lineB',
					'+lineA_extended',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'file.py:5',
				'-lineB',
			].join('\n'));
		});

		it('continuation replaces one line with many when more added than removed lines', async () => {
			const result = await collectMultiLine(
				[
					'file.py:4',
					'-lineA',
					'-lineB',
					'+lineA_extended',
					'+lineB1',
					'+lineB2',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'file.py:5',
				'-lineB',
				'+lineB1',
				'+lineB2',
			].join('\n'));
		});

		it('splits a single-removed-line patch identically when allowMultiLineRemoval is on', async () => {
			const result = await collectMultiLine(
				[
					'file.py:4',
					'-lineA',
					'+lineA_extended',
					'+lineB',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'+lineA_extended',
				'file.py:5',
				'+lineB',
			].join('\n'));
		});

		it('does not split when the first line edit is not additive', async () => {
			const result = await collectMultiLine(
				[
					'file.py:4',
					'-hello world',
					'-lineB',
					'+goodbye',
					'+lineC',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-hello world',
				'-lineB',
				'+goodbye',
				'+lineC',
			].join('\n'));
		});

		it('does not split when the cursor line does not match the patch line', async () => {
			const result = await collectMultiLine(
				[
					'file.py:4',
					'-lineA',
					'-lineB',
					'+lineA_extended',
					'+lineC',
				].join('\n'),
				10,
			);
			expect(result).toEqual([
				'file.py:4',
				'-lineA',
				'-lineB',
				'+lineA_extended',
				'+lineC',
			].join('\n'));
		});

		it('does not split an empty cursor line that merely absorbs the next line', async () => {
			const result = await collectMultiLine(
				[
					'file.py:4',
					'-',
					'-foo()',
					'+foo()',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-',
				'-foo()',
				'+foo()',
			].join('\n'));
		});

		it('splits an empty cursor line when the next line is genuinely different', async () => {
			const result = await collectMultiLine(
				[
					'file.py:4',
					'-',
					'-bar()',
					'+foo()',
					'+baz()',
				].join('\n'),
				4,
			);
			expect(result).toEqual([
				'file.py:4',
				'-',
				'+foo()',
				'file.py:5',
				'-bar()',
				'+baz()',
			].join('\n'));
		});
	});

	describe('handleResponse with enableProgressiveGhostText', () => {

		it('yields two edits for ghost-text when progressive reveal is enabled', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 5));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let x = 1;';
				yield '+    let y = 2;';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.Off,
				true,
			);

			expect(edits).toHaveLength(2);
			expect(edits[0].edit).toEqual(new LineReplacement(new LineRange(2, 3), ['    let x = 1;']));
			expect(edits[1].edit).toEqual(new LineReplacement(new LineRange(3, 3), ['    let y = 2;']));
		});

		it('yields single edit when progressive reveal is disabled (default)', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 5));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let x = 1;';
				yield '+    let y = 2;';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
			);

			expect(edits).toHaveLength(1);
			expect(edits[0].edit).toEqual(new LineReplacement(new LineRange(2, 3), ['    let x = 1;', '    let y = 2;']));
		});

		it('progressive reveal with TrimDuplicate trims continuation but keeps early edit', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 5));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let x = 1;';
				yield '+    let y = 2;';
				yield '+}';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.TrimDuplicate,
				true,
			);

			expect(edits).toHaveLength(2);
			expect(edits[0].edit).toEqual(new LineReplacement(new LineRange(2, 3), ['    let x = 1;']));
			expect(edits[1].edit).toEqual(new LineReplacement(new LineRange(3, 3), ['    let y = 2;']));
		});

		it('progressive reveal with DropPatch drops continuation but keeps early edit', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n}\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 5));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let x = 1;';
				yield '+}';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.DropPatch,
				true,
			);

			expect(edits).toHaveLength(1);
			expect(edits[0].edit).toEqual(new LineReplacement(new LineRange(2, 3), ['    let x = 1;']));
		});
	});

	describe('handleResponse with enableProgressiveGhostTextMultiLine', () => {

		const docContent = 'function foo() {\n    const a = 1;\n    doStuff(a);\n}\n';
		function makeDoc(): CurrentDocument {
			return new CurrentDocument(new StringText(docContent), new Position(2, 5));
		}

		async function* multiLineStream(): AsyncGenerator<string> {
			yield '/test.ts:1';
			yield '-    const a = 1;';
			yield '-    doStuff(a);';
			yield '+    const a = 1, b = 2;';
			yield '+    doStuff(a, b);';
		}

		it('yields two edits (cursor-line replacement + continuation replacement) when multi-line reveal is enabled', async () => {
			const { edits } = await consumeHandleResponse(
				multiLineStream(),
				makeDoc(),
				DocumentId.create('file:///test.ts'),
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.Off,
				true,
				false,
				true,
			);

			expect(edits).toHaveLength(2);
			expect(edits[0].edit).toEqual(new LineReplacement(new LineRange(2, 3), ['    const a = 1, b = 2;']));
			expect(edits[1].edit).toEqual(new LineReplacement(new LineRange(3, 4), ['    doStuff(a, b);']));
		});

		it('yields a single unsplit edit for a multi-removed-line patch when multi-line reveal is disabled (default)', async () => {
			const { edits } = await consumeHandleResponse(
				multiLineStream(),
				makeDoc(),
				DocumentId.create('file:///test.ts'),
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.Off,
				true,
			);

			expect(edits).toHaveLength(1);
			expect(edits[0].edit).toEqual(new LineReplacement(new LineRange(2, 4), ['    const a = 1, b = 2;', '    doStuff(a, b);']));
		});

		it('falls back to a single unsplit edit under DropPatch (unsafe dedup mode)', async () => {
			const { edits } = await consumeHandleResponse(
				multiLineStream(),
				makeDoc(),
				DocumentId.create('file:///test.ts'),
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.DropPatch,
				true,
				false,
				true,
			);

			expect(edits).toHaveLength(1);
			expect(edits[0].edit).toEqual(new LineReplacement(new LineRange(2, 4), ['    const a = 1, b = 2;', '    doStuff(a, b);']));
		});

		it('stays active under TrimDuplicate and keeps the continuation removal while trimming duplicate additions', async () => {
			const docWithReturn = 'function foo() {\n    const a = 1;\n    doStuff(a);\n    return a;\n}\n';
			const doc = new CurrentDocument(new StringText(docWithReturn), new Position(2, 5));

			async function* stream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    const a = 1;';
				yield '-    doStuff(a);';
				yield '+    const a = 1, b = 2;';
				yield '+    doStuff(a, b);';
				yield '+    return a;';
			}

			const { edits } = await consumeHandleResponse(
				stream(),
				doc,
				DocumentId.create('file:///test.ts'),
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.TrimDuplicate,
				true,
				false,
				true,
			);

			expect(edits).toHaveLength(2);
			expect(edits[0].edit).toEqual(new LineReplacement(new LineRange(2, 3), ['    const a = 1, b = 2;']));
			expect(edits[1].edit).toEqual(new LineReplacement(new LineRange(3, 4), ['    doStuff(a, b);']));
		});

		it('keeps the early cursor-line edit under TrimDuplicate when its added line matches the next removed line (cascade)', async () => {
			const docContent = 'f();\n    log(x)\n    log(x, y)\nz\n';
			const doc = new CurrentDocument(new StringText(docContent), new Position(2, 5));

			async function* stream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    log(x)';
				yield '-    log(x, y)';
				yield '+    log(x, y)';
				yield '+    log(x, y, z)';
			}

			const { edits } = await consumeHandleResponse(
				stream(),
				doc,
				DocumentId.create('file:///test.ts'),
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.TrimDuplicate,
				true,
				false,
				true,
			);

			expect(edits).toHaveLength(2);
			expect(edits[0].edit).toEqual(new LineReplacement(new LineRange(2, 3), ['    log(x, y)']));
			expect(edits[1].edit).toEqual(new LineReplacement(new LineRange(3, 4), ['    log(x, y, z)']));
		});
	});

	describe('splitReplacement', () => {

		it('splits a multi-hunk replacement into one replacement per changed region', () => {
			const removedLines = ['a', 'b', 'c', 'd', 'e'];
			const replacement = new LineReplacement(new LineRange(2, 7), ['a', 'B', 'c', 'D', 'e']);

			const result = XtabPatchResponseHandler.splitReplacement(replacement, removedLines);

			expect(result).toEqual([
				new LineReplacement(new LineRange(3, 4), ['B']),
				new LineReplacement(new LineRange(5, 6), ['D']),
			]);
		});

		it('leaves a single contiguous change unsplit', () => {
			const removedLines = ['a', 'b', 'c'];
			const replacement = new LineReplacement(new LineRange(10, 13), ['a', 'X', 'Y', 'c']);

			const result = XtabPatchResponseHandler.splitReplacement(replacement, removedLines);

			expect(result).toEqual([replacement]);
		});

		it('leaves a pure insertion unsplit', () => {
			const replacement = new LineReplacement(new LineRange(5, 5), ['x', 'y']);

			const result = XtabPatchResponseHandler.splitReplacement(replacement, []);

			expect(result).toEqual([replacement]);
		});

		it('leaves a pure deletion unsplit', () => {
			const replacement = new LineReplacement(new LineRange(5, 8), []);

			const result = XtabPatchResponseHandler.splitReplacement(replacement, ['x', 'y', 'z']);

			expect(result).toEqual([replacement]);
		});
	});

	describe('handleResponse with splitPatchOnDiff', () => {

		const docContent = '0\na\nb\nc\nd\ne\n';

		async function* makeStream(): AsyncGenerator<string> {
			yield '/test.ts:1';
			yield '-a';
			yield '-b';
			yield '-c';
			yield '-d';
			yield '-e';
			yield '+a';
			yield '+B';
			yield '+c';
			yield '+D';
			yield '+e';
		}

		it('splits one coarse patch into minimal replacements when enabled', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(1, 1));

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.Off,
				false,
				true,
			);

			expect(edits.map(e => e.edit)).toEqual([
				new LineReplacement(new LineRange(3, 4), ['B']),
				new LineReplacement(new LineRange(5, 6), ['D']),
			]);
		});

		it('yields a single coarse replacement when disabled (default)', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(1, 1));

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
			);

			expect(edits.map(e => e.edit)).toEqual([
				new LineReplacement(new LineRange(2, 7), ['a', 'B', 'c', 'D', 'e']),
			]);
		});
	});

	describe('patchIndex attribution', () => {

		it('extractEdits assigns an incrementing index per model patch header', async () => {
			const linesStream = AsyncIterUtils.fromArray([
				'a.ts:1',
				'-a',
				'+A',
				'b.ts:2',
				'-b',
				'+B',
				'c.ts:3',
				'-c',
				'+C',
			]);
			const patches = await AsyncIterUtils.toArray(XtabPatchResponseHandler.extractEdits(linesStream));
			expect(patches.map(p => p.patchIndex)).toEqual([0, 1, 2]);
		});

		it('extractEdits does not advance the index for an invalid header', async () => {
			const linesStream = AsyncIterUtils.fromArray([
				'a.ts:1',
				'-a',
				'+A',
				'not a valid header',
				'b.ts:2',
				'-b',
				'+B',
			]);
			const patches = await AsyncIterUtils.toArray(XtabPatchResponseHandler.extractEdits(linesStream));
			expect(patches.map(p => p.patchIndex)).toEqual([0, 1]);
		});

		it('all fragments of a split patch share the originating patchIndex', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = '0\na\nb\nc\nd\ne\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(1, 1));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-a';
				yield '-b';
				yield '-c';
				yield '-d';
				yield '-e';
				yield '+a';
				yield '+B';
				yield '+c';
				yield '+D';
				yield '+e';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.Off,
				false,
				true,
			);

			expect(edits).toHaveLength(2);
			expect(edits.map(e => e.patchIndex)).toEqual([0, 0]);
		});

		it('distinct model patches get distinct patchIndex values', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = '0\na\nb\nc\nd\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(1, 1));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-a';
				yield '+A';
				yield '/test.ts:3';
				yield '-c';
				yield '+C';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
			);

			expect(edits.map(e => e.patchIndex)).toEqual([0, 1]);
		});

		it('progressive ghost-text fragments share the patchIndex while a following patch advances it', async () => {
			const docId = DocumentId.create('file:///test.ts');
			const docContent = 'function foo() {\n    let x = 1;\n}\nbar();\n';
			const documentBeforeEdits = new CurrentDocument(new StringText(docContent), new Position(2, 5));

			async function* makeStream(): AsyncGenerator<string> {
				yield '/test.ts:1';
				yield '-    let x = 1;';
				yield '+    let x = 1;';
				yield '+    let y = 2;';
				yield '/test.ts:3';
				yield '-bar();';
				yield '+baz();';
			}

			const { edits } = await consumeHandleResponse(
				makeStream(),
				documentBeforeEdits,
				docId,
				undefined,
				undefined,
				new TestLogService(),
				DuplicateAdditionsMode.Off,
				true,
			);

			expect(edits.map(e => e.patchIndex)).toEqual([0, 0, 1]);
		});
	});
});
