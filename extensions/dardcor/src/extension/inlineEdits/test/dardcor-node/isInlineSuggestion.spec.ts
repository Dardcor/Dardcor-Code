/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert, suite, test } from 'vitest';
import { Position, Range, type TextDocument, Uri } from 'vscode';
import { createTextDocumentData } from '../../../../util/common/test/shims/textDocument';
import { isSubword, toInlineSuggestion } from '../../dardcor-node/isInlineSuggestion';

suite('toInlineSuggestion', () => {

	function createMockDocument(lines: string[], languageId: string = 'typescript') {
		return createTextDocumentData(Uri.from({ scheme: 'test', path: '/test/file.ts' }), lines.join('\n'), languageId).document;
	}

	function getBaseCompletionScenario() {
		const document = createMockDocument(['This is line 1,', 'This is line,', 'This is line 3,']);
		const replaceRange = new Range(1, 0, 1, 13);
		const completionInsertionPoint = new Position(1, 12);
		const replaceText = 'This is line 2,';
		return { document, completionInsertionPoint, replaceRange, replaceText };
	}

	function applyEdit(document: TextDocument, range: Range, newText: string): string {
		const documentText = document.getText();
		return documentText.substring(0, document.offsetAt(range.start)) + newText + documentText.substring(document.offsetAt(range.end));
	}

	function canRepresentAsInlineSuggestion(document: TextDocument, cursorPosition: Position, range: Range, newText: string): boolean {
		const documentText = document.getText();
		const editedText = applyEdit(document, range, newText);
		const lineLength = document.lineAt(cursorPosition.line).text.length;

		for (let startCharacter = 0; startCharacter <= cursorPosition.character; startCharacter++) {
			for (let endCharacter = cursorPosition.character; endCharacter <= lineLength; endCharacter++) {
				const candidateRange = new Range(cursorPosition.line, startCharacter, cursorPosition.line, endCharacter);
				const prefix = documentText.substring(0, document.offsetAt(candidateRange.start));
				const suffix = documentText.substring(document.offsetAt(candidateRange.end));
				const candidateNewTextEnd = editedText.length - suffix.length;
				if (candidateNewTextEnd < prefix.length || !editedText.startsWith(prefix) || !editedText.endsWith(suffix)) {
					continue;
				}

				const candidateNewText = editedText.substring(prefix.length, candidateNewTextEnd);
				const replacedText = document.getText(candidateRange);
				const cursorOffset = cursorPosition.character - startCharacter;
				if (
					applyEdit(document, candidateRange, candidateNewText) === editedText
					&& replacedText.substring(0, cursorOffset) === candidateNewText.substring(0, cursorOffset)
					&& isSubword(replacedText, candidateNewText)
				) {
					return true;
				}
			}
		}

		return false;
	}

	test('line before completion', () => {
		const { document, completionInsertionPoint, replaceRange, replaceText } = getBaseCompletionScenario();

		const cursorPosition = new Position(completionInsertionPoint.line - 1, completionInsertionPoint.character);

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('same line before completion', () => {
		const { document, completionInsertionPoint, replaceRange, replaceText } = getBaseCompletionScenario();

		const cursorPosition = new Position(completionInsertionPoint.line, completionInsertionPoint.character - 1);

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, replaceRange);
		assert.strictEqual(result!.newText, replaceText);
	});

	test('same line at completion', () => {
		const { document, completionInsertionPoint, replaceRange, replaceText } = getBaseCompletionScenario();

		const cursorPosition = new Position(completionInsertionPoint.line, completionInsertionPoint.character);

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, replaceRange);
		assert.strictEqual(result!.newText, replaceText);
	});

	test('same line after completion', () => {
		const { document, completionInsertionPoint, replaceRange, replaceText } = getBaseCompletionScenario();

		const cursorPosition = new Position(completionInsertionPoint.line, completionInsertionPoint.character + 1);

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('line after completion', () => {
		const { document, completionInsertionPoint, replaceRange, replaceText } = getBaseCompletionScenario();

		const cursorPosition = new Position(completionInsertionPoint.line + 1, completionInsertionPoint.character);

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('multi-line replace range', () => {
		const document = createMockDocument(['This is line 1,', 'This is line,', 'This is line,']);
		const replaceRange = new Range(1, 0, 2, 13);
		const replaceText = 'This is line 2,\nThis is line 3,';

		const cursorPosition = replaceRange.start;

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('multi-line insertion on same line', () => {
		const document = createMockDocument(['This is line 1,', 'This is line,', 'This is line 5,']);
		const replaceRange = new Range(1, 12, 1, 13);
		const replaceText = ' 2,\nThis is line 3,\nThis is line 4,';

		const cursorPosition = replaceRange.start;

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, replaceRange);
		assert.strictEqual(result!.newText, replaceText);
	});

	test('multi-line insertion on next line extends range to cursor', () => {
		const document = createMockDocument(['This is line 1,', 'This is line 2,', 'This is line 5,']);
		const cursorPosition = new Position(1, 15);
		const replaceRange = new Range(2, 0, 2, 0);
		const replaceText = 'This is line 3,\nThis is line 4,\n';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(1, 15, 1, 15));
		assert.strictEqual(result!.newText, '\n' + replaceText.replace(/\r?\n$/, ''));
	});

	test('should not use ghost text when inserting on next line when none empty', () => {
		const document = createMockDocument(['This is line 1,', 'This is line 2,', 'line 3,']);
		const cursorPosition = new Position(1, 15);
		const replaceRange = new Range(2, 0, 2, 0);
		const replaceText = 'This is ';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('should not use ghost text when inserting on existing line below', () => {
		const document = createMockDocument(['This is line 1,', 'This is line 2,', '', 'This is line 4,']);
		const cursorPosition = new Position(1, 15);
		const replaceRange = new Range(2, 0, 2, 0);
		const replaceText = 'This is line 3,';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});


	test('multi-line insertion on next empty line without trailing newline is not an inline suggestion', () => {
		const document = createMockDocument(['function foo(', '', 'other']);
		const cursorPosition = new Position(0, 13);
		const replaceRange = new Range(1, 0, 1, 0);
		const replaceText = '  a: string,\n  b: number\n)';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('multi-line insertion on next non-empty line with trailing newline', () => {
		const document = createMockDocument(['function foo(', ')', 'other']);
		const cursorPosition = new Position(0, 13);
		const replaceRange = new Range(1, 0, 1, 0);
		const replaceText = '  a: string,\n  b: number\n';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(0, 13, 0, 13));
		assert.strictEqual(result!.newText, '\n' + replaceText.replace(/\r?\n$/, ''));
	});

	test('multi-line insertion without trailing newline rejected when target line has content', () => {
		const document = createMockDocument(['function foo(', ')', 'other']);
		const cursorPosition = new Position(0, 13);
		const replaceRange = new Range(1, 0, 1, 0);
		const replaceText = '  a: string,\n  b: number';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('single-line insertion on next empty line is not an inline suggestion', () => {
		const document = createMockDocument(['function foo(', '', 'other']);
		const cursorPosition = new Position(0, 13);
		const replaceRange = new Range(1, 0, 1, 0);
		const replaceText = '  a: string';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('next-line suggestion onto empty last line without trailing newline is not an inline suggestion', () => {

		const document = createMockDocument([`import * as vscode from 'vscode';
import { NodeTypesIndex } from './nodeTypesIndex';
import { Result } from './util/common/result';

export class NodeTypesOutlineProvider implements vscode.DocumentSymbolProvider {

	/**
	 * @remark This works only for valid tree-sitter \`node-types.json\` files.
	 */
	provideDocumentSymbols(
		document: vscode.TextDocument,
		token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {

		const nodeTypesIndex = new NodeTypesIndex(document);

		const astNodes = nodeTypesIndex.nodes;

		if (Result.isErr(astNodes)) {
			throw astNodes.err;
		}

		const symbols: vscode.DocumentSymbol[] = astNodes.val.map(astNode => {
			const range = new vscode.Range(
				document.positionAt(astNode.offset),
				document.positionAt(astNode.offset + astNode.length)
			);

			const revealRange = new vscode.Range(
				document.positionAt(astNode.type.offset),
				document.positionAt(astNode.type.offset + astNode.type.length)
			);

			return new vscode.DocumentSymbol(
				astNode.type.value,
				astNode.named.value ? 'Named' : 'Anonymous',
				vscode.SymbolKind.Object,
				range,
				revealRange,
			);
		});

		return symbols;
	}
}
function createDocumentSymbol(
`]);
		const cursorPosition = new Position(45, 30);
		const replaceRange = new Range(46, 0, 46, 0);
		const replaceText = `	astNode: { type: { value: string; offset: number; length: number }; named: { value: boolean }; offset: number; length: number },
	document: vscode.TextDocument
): vscode.DocumentSymbol {
	const range = new vscode.Range(
		document.positionAt(astNode.offset),
		document.positionAt(astNode.offset + astNode.length)
	);

	const revealRange = new vscode.Range(
		document.positionAt(astNode.type.offset),
		document.positionAt(astNode.type.offset + astNode.type.length)
	);

	return new vscode.DocumentSymbol(
		astNode.type.value,
		astNode.named.value ? 'Named' : 'Anonymous',
		vscode.SymbolKind.Object,
		range,
		revealRange,
	);
}`;

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});


	test('next-line: cursor mid-line extends through the unchanged line suffix', () => {
		const document = createMockDocument(['function foo(bar', '', 'other']);
		const cursorPosition = new Position(0, 8);
		const replaceRange = new Range(1, 0, 1, 0);
		const replaceText = '  param1,\n  param2\n';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.deepStrictEqual(result, {
			range: new Range(0, 8, 0, 16),
			newText: ' foo(bar\n  param1,\n  param2',
		});
		assert.strictEqual(applyEdit(document, result!.range, result!.newText), applyEdit(document, replaceRange, replaceText));
	});

	test('next-line: non-empty range on next line falls through and is rejected', () => {
		const document = createMockDocument(['function foo(', 'old content', 'other']);
		const cursorPosition = new Position(0, 13);
		const replaceRange = new Range(1, 0, 1, 11);
		const replaceText = 'new content\n';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('next-line: non-empty replace range covering only whitespace on next line', () => {
		const document = createMockDocument([
			'    for item in items:',
			'        ',
			'other_code',
		], 'python');
		const cursorPosition = new Position(1, 4);
		const replaceRange = new Range(0, 22, 1, 8);
		const replaceText = '\n        process(item)\n    return result';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
	});

	test('next-line: range 2 lines ahead is rejected', () => {
		const document = createMockDocument(['line 0', 'line 1', '', 'line 3']);
		const cursorPosition = new Position(0, 6);
		const replaceRange = new Range(2, 0, 2, 0);
		const replaceText = 'inserted\n';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('next-line: empty range at non-zero column on next line is rejected', () => {
		const document = createMockDocument(['function foo(', '    ', 'other']);
		const cursorPosition = new Position(0, 13);
		const replaceRange = new Range(1, 4, 1, 4);
		const replaceText = 'a: string,\n  b: number\n';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('next-line: inserting just a newline character', () => {
		const document = createMockDocument(['line 0', '', 'line 2']);
		const cursorPosition = new Position(0, 6);
		const replaceRange = new Range(1, 0, 1, 0);
		const replaceText = '\n';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(0, 6, 0, 6));
		assert.strictEqual(result!.newText, '\n');
	});

	test('next-line: cursor at end of an empty line', () => {
		const document = createMockDocument(['', '', 'other']);
		const cursorPosition = new Position(0, 0);
		const replaceRange = new Range(1, 0, 1, 0);
		const replaceText = 'new line\n';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(0, 0, 0, 0));
		assert.strictEqual(result!.newText, '\nnew line');
	});

	test('next-line: range on line before cursor is rejected', () => {
		const document = createMockDocument(['line 0', 'line 1', 'line 2']);
		const cursorPosition = new Position(2, 6);
		const replaceRange = new Range(1, 0, 1, 0);
		const replaceText = 'inserted\n';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	suite('equivalent edit rebasing', () => {

		test('rebases a next-line replacement preserving the closing line', () => {
			const document = createMockDocument([
				'\tprivate gatherNeighborSnippets(',
				'\t\tactiveDocument: StatelessNextEditDocument,',
				'\t) {',
				'\t\treturn undefined;',
			]);
			const cursorPosition = document.lineAt(1).range.end;
			const replaceRange = new Range(2, 0, 2, 4);
			const replaceText = [
				'\t\tcurrentDocument: StatelessNextEditDocument,',
				'\t\tpromptOptions: ModelConfig,',
				'\t\tdelaySession: DelaySession,',
				'\t\ttracer: RequestTracingContext,',
				'\t\tcancellationToken: CancellationToken,',
				'\t) {',
			].join('\n');

			const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);

			assert.deepStrictEqual(result, {
				range: new Range(cursorPosition, cursorPosition),
				newText: [
					'',
					'\t\tcurrentDocument: StatelessNextEditDocument,',
					'\t\tpromptOptions: ModelConfig,',
					'\t\tdelaySession: DelaySession,',
					'\t\ttracer: RequestTracingContext,',
					'\t\tcancellationToken: CancellationToken,',
				].join('\n'),
			});
			assert.strictEqual(applyEdit(document, result!.range, result!.newText), applyEdit(document, replaceRange, replaceText));

			assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText, false));
		});

		test('rebases a replacement starting after indentation on the next line', () => {
			const document = createMockDocument(['function foo(', '  close', 'other']);
			const cursorPosition = new Position(0, 13);
			const replaceRange = new Range(1, 2, 1, 7);
			const replaceText = 'item\n  close';

			const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);

			assert.deepStrictEqual(result, {
				range: new Range(cursorPosition, cursorPosition),
				newText: '\n  item',
			});
			assert.strictEqual(applyEdit(document, result!.range, result!.newText), applyEdit(document, replaceRange, replaceText));
		});

		test('does not rebase when the replacement changes the closing line', () => {
			const document = createMockDocument(['function foo(', '  close', 'other']);
			const cursorPosition = new Position(0, 13);
			const replaceRange = new Range(1, 2, 1, 7);
			const replaceText = 'item\n  changed';

			assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
		});

		test('collapses a multi-line edit around the cursor using unchanged prefix and suffix', () => {
			const document = createMockDocument(['header', 'abc', 'close']);
			const cursorPosition = new Position(1, 1);
			const replaceRange = new Range(0, 0, 2, 5);
			const replaceText = 'header\naXbc\nclose';

			const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);

			assert.deepStrictEqual(result, {
				range: new Range(1, 1, 1, 3),
				newText: 'Xbc',
			});
			assert.strictEqual(applyEdit(document, result!.range, result!.newText), applyEdit(document, replaceRange, replaceText));
		});

		test('matches the representability oracle over a finite exhaustive corpus', () => {
			const documents: readonly { text: string; eol: '\n' | '\r\n' }[] = [
				{ text: '', eol: '\n' },
				{ text: 'a', eol: '\n' },
				{ text: 'ab', eol: '\n' },
				{ text: 'a\n', eol: '\n' },
				{ text: 'a\nb', eol: '\n' },
				{ text: 'ab\nc', eol: '\n' },
				{ text: 'a\nb\nc', eol: '\n' },
				{ text: 'a\r\nb', eol: '\r\n' },
				{ text: 'ab\r\nc', eol: '\r\n' },
			];
			const newTexts = ['', 'a', 'b', 'ab', '\n', '\r\n', 'a\n', 'a\r\n', '\nb', '\r\nb', 'a\nb', 'a\r\nb', 'b\na', 'a\nb\nc'];

			for (const { text: documentText, eol } of documents) {
				const document = createTextDocumentData(Uri.from({ scheme: 'test', path: '/test/file.ts' }), documentText, 'typescript', eol).document;
				const positions: Position[] = [];
				for (let line = 0; line < document.lineCount; line++) {
					for (let character = 0; character <= document.lineAt(line).text.length; character++) {
						positions.push(new Position(line, character));
					}
				}

				for (const cursorPosition of positions) {
					for (let startIndex = 0; startIndex < positions.length; startIndex++) {
						for (let endIndex = startIndex; endIndex < positions.length; endIndex++) {
							const range = new Range(positions[startIndex], positions[endIndex]);
							for (const newText of newTexts) {
								const representable = canRepresentAsInlineSuggestion(document, cursorPosition, range, newText);
								const result = toInlineSuggestion(cursorPosition, document, range, newText);
								const scenario = JSON.stringify({ documentText, cursorPosition, range, newText });

								if (representable) {
									assert.isDefined(result, scenario);
								}
								if (result !== undefined) {
									assert.strictEqual(applyEdit(document, result.range, result.newText), applyEdit(document, range, newText), scenario);
								}
							}
						}
					}
				}
			}
		});
	});


	test('same-line: edit after cursor is extended back to cursor', () => {
		const document = createMockDocument(['abcdef']);
		const cursorPosition = new Position(0, 1);
		const replaceRange = new Range(0, 3, 0, 6);
		const replaceText = 'defgh';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.deepStrictEqual(result, {
			range: new Range(0, 1, 0, 6),
			newText: 'bcdefgh',
		});
	});

	test('same-line: text before cursor differs rejects', () => {
		const document = createMockDocument(['abcdef']);
		const cursorPosition = new Position(0, 4);
		const replaceRange = new Range(0, 0, 0, 6);
		const replaceText = 'XXXX_modified';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('same-line: replaced text is not subword of new text rejects', () => {
		const document = createMockDocument(['abcxyz']);
		const cursorPosition = new Position(0, 0);
		const replaceRange = new Range(0, 0, 0, 6);
		const replaceText = 'abc';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('same-line: deletion (empty newText) rejects', () => {
		const document = createMockDocument(['abcdef']);
		const cursorPosition = new Position(0, 0);
		const replaceRange = new Range(0, 0, 0, 3);
		const replaceText = '';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('same-line: empty range and empty text at cursor (no-op) succeeds', () => {
		const document = createMockDocument(['abcdef']);
		const cursorPosition = new Position(0, 3);
		const replaceRange = new Range(0, 3, 0, 3);
		const replaceText = '';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(0, 3, 0, 3));
		assert.strictEqual(result!.newText, '');
	});

	test('same-line: pure insertion (empty range) at cursor', () => {
		const document = createMockDocument(['ab']);
		const cursorPosition = new Position(0, 1);
		const replaceRange = new Range(0, 1, 0, 1);
		const replaceText = 'XY';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(0, 1, 0, 1));
		assert.strictEqual(result!.newText, 'XY');
	});

	test('same-line: cursor at col 0 with range at col 0', () => {
		const document = createMockDocument(['hello']);
		const cursorPosition = new Position(0, 0);
		const replaceRange = new Range(0, 0, 0, 5);
		const replaceText = 'hello world';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, replaceRange);
		assert.strictEqual(result!.newText, 'hello world');
	});

	test('same-line: subword insertion mid-word', () => {
		const document = createMockDocument(['clog']);
		const cursorPosition = new Position(0, 1);
		const replaceRange = new Range(0, 0, 0, 4);
		const replaceText = 'console.log';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.strictEqual(result!.newText, 'console.log');
	});


	test('prefix-strip: multi-line range reduced to single-line edit on cursor line', () => {
		const document = createMockDocument(['abc', 'def', 'other']);
		const cursorPosition = new Position(1, 0);
		const replaceRange = new Range(0, 0, 1, 3);
		const replaceText = 'abc\ndefghi';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(1, 0, 1, 3));
		assert.strictEqual(result!.newText, 'defghi');
	});

	test('prefix-strip: no newline in common prefix, multi-line range still rejected', () => {
		const document = createMockDocument(['ab', 'cd', 'other']);
		const cursorPosition = new Position(0, 0);
		const replaceRange = new Range(0, 0, 1, 2);
		const replaceText = 'abXY';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('prefix-strip: strips multiple newlines to last boundary', () => {
		const document = createMockDocument(['line0', 'line1', 'xy', 'other']);
		const cursorPosition = new Position(2, 0);
		const replaceRange = new Range(0, 0, 2, 2);
		const replaceText = 'line0\nline1\nxyz';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(2, 0, 2, 2));
		assert.strictEqual(result!.newText, 'xyz');
	});

	test('prefix-strip: after stripping still multi-line, rejected', () => {
		const document = createMockDocument(['a', 'b', 'c', 'other']);
		const cursorPosition = new Position(1, 0);
		const replaceRange = new Range(0, 0, 2, 1);
		const replaceText = 'a\nB\nC';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('prefix-strip: reduced to single line but cursor on different line, rejected', () => {
		const document = createMockDocument(['abc', 'def', 'other']);
		const cursorPosition = new Position(0, 2);
		const replaceRange = new Range(0, 0, 1, 3);
		const replaceText = 'abc\ndefghi';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('prefix-strip: reduced to single line, subword check fails', () => {
		const document = createMockDocument(['abc', 'def', 'other']);
		const cursorPosition = new Position(1, 0);
		const replaceRange = new Range(0, 0, 1, 3);
		const replaceText = 'abc\nxy';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('prefix-strip: diverges before first newline, no stripping', () => {
		const document = createMockDocument(['ax', 'yz']);
		const cursorPosition = new Position(0, 0);
		const replaceRange = new Range(0, 0, 1, 2);
		const replaceText = 'ab\nyz';

		assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
	});

	test('prefix-strip: range starts mid-line, strips prefix through newline', () => {
		const document = createMockDocument(['hello world', '  ns', 'other']);
		const cursorPosition = new Position(1, 0);
		const replaceRange = new Range(0, 6, 1, 4);
		const replaceText = 'world\n  new_stuff';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(1, 0, 1, 4));
		assert.strictEqual(result!.newText, '  new_stuff');
	});

	test('prefix-strip: empty newText after stripping prefix', () => {
		const document = createMockDocument(['abc', '', 'other']);
		const cursorPosition = new Position(1, 0);
		const replaceRange = new Range(0, 0, 1, 0);
		const replaceText = 'abc\n';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(1, 0, 1, 0));
		assert.strictEqual(result!.newText, '');
	});

	test('insertion on next line in fieldLabels object', () => {
		const doc = `import React, { useState } from "react";

interface FormData {
    firstName: string;
    lastName: string;
    password: string;
    email: string;
    age: string;
    city: string;
}

const initialFormData: FormData = {
    firstName: "",
    lastName: "",
    password: "",
    email: "",
    age: "",
    city: "",
};

const fieldLabels: Record<keyof FormData, string> = {
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email Address",
    age: "Age",
    city: "City",
};
`;
		const document = createTextDocumentData(Uri.from({ scheme: 'test', path: '/test/file.tsx' }), doc, 'typescriptreact').document;
		const cursorPosition = new Position(22, 26);
		const replaceRange = new Range(23, 0, 23, 0);
		const replaceText = '    password: "Password",\n';

		const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText, true);
		assert.isDefined(result);
		assert.deepStrictEqual(result!.range, new Range(22, 26, 22, 26));
		assert.strictEqual(result!.newText, '\n    password: "Password",');
	});

	suite('CRLF', () => {

		function createCRLFDocument(lines: string[], languageId: string = 'typescript') {
			return createTextDocumentData(
				Uri.from({ scheme: 'test', path: '/test/file.ts' }),
				lines.join('\r\n'),
				languageId,
				'\r\n',
			).document;
		}

		test('next-line insertion: trailing CRLF is dropped (no dangling \\r)', () => {
			const document = createCRLFDocument(['function foo(', '', 'other']);
			const cursorPosition = new Position(0, 13);
			const replaceRange = new Range(1, 0, 1, 0);
			const replaceText = '  a: string,\r\n  b: number\r\n';

			const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
			assert.isDefined(result);
			assert.deepStrictEqual(result!.range, new Range(0, 13, 0, 13));
			assert.strictEqual(result!.newText, '\r\n  a: string,\r\n  b: number');
		});

		test('next-line insertion: trailing CRLF on non-empty target line', () => {
			const document = createCRLFDocument(['function foo(', ')', 'other']);
			const cursorPosition = new Position(0, 13);
			const replaceRange = new Range(1, 0, 1, 0);
			const replaceText = '  a: string,\r\n  b: number\r\n';

			const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
			assert.isDefined(result);
			assert.deepStrictEqual(result!.range, new Range(0, 13, 0, 13));
			assert.strictEqual(result!.newText, '\r\n  a: string,\r\n  b: number');
		});

		test('next-line insertion: CRLF-only newText is fully stripped', () => {
			const document = createCRLFDocument(['line 0', '', 'line 2']);
			const cursorPosition = new Position(0, 6);
			const replaceRange = new Range(1, 0, 1, 0);
			const replaceText = '\r\n';

			const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText);
			assert.isDefined(result);
			assert.deepStrictEqual(result!.range, new Range(0, 6, 0, 6));
			assert.strictEqual(result!.newText, '\r\n');
		});

		test('next-line insertion: bare LF newText in a CRLF document is not an inline suggestion', () => {
			const document = createCRLFDocument(['a', 'b']);
			const cursorPosition = new Position(0, 1);
			const replaceRange = new Range(1, 0, 1, 0);
			const replaceText = '\n';

			assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
			assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText, false));
		});

		test('next-line insertion: ungated fallback pulls up a CRLF-terminated insertion (advanced disabled)', () => {
			const document = createCRLFDocument(['function foo(', '', 'other']);
			const cursorPosition = new Position(0, 13);
			const replaceRange = new Range(1, 0, 1, 0);
			const replaceText = '  a: string,\r\n  b: number\r\n';

			const result = toInlineSuggestion(cursorPosition, document, replaceRange, replaceText, false);
			assert.isDefined(result);
			assert.deepStrictEqual(result!.range, new Range(0, 13, 0, 13));
			assert.strictEqual(result!.newText, '\r\n  a: string,\r\n  b: number');
			assert.strictEqual(applyEdit(document, result!.range, result!.newText), applyEdit(document, replaceRange, replaceText));
		});
	});

	suite('multi-line range, no common prefix', () => {

		test('does not strip leading newline when nothing is in common', () => {
			const document = createMockDocument(['abc', 'x', 'rest']);
			const replaceRange = new Range(0, 3, 1, 1);
			const cursorPosition = new Position(1, 1);
			const replaceText = 'Yx';

			assert.isUndefined(toInlineSuggestion(cursorPosition, document, replaceRange, replaceText));
		});
	});
});
