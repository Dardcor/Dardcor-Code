/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, suite, test } from 'vitest';
import { ResponseProcessor } from '../../../../platform/inlineEdits/common/responseProcessor';
import { AsyncIterUtils } from '../../../../util/common/asyncIterableUtils';
import { LineEdit, LineReplacement } from '../../../../util/dardcor/editor/common/core/edits/lineEdit';
import { LineRange } from '../../../../util/dardcor/editor/common/core/ranges/lineRange';

suite('stream diffing', () => {

	async function run(editWindow: string[], updatedEditWindowLines: string[]) {
		const updatedEditWindowLinesStream = AsyncIterUtils.fromArray(updatedEditWindowLines);

		const editsGen = ResponseProcessor.diff(editWindow, updatedEditWindowLinesStream, 0, ResponseProcessor.DEFAULT_DIFF_PARAMS);

		const edits: LineReplacement[] = [];
		for await (const edit of editsGen) {
			edits.push(edit);
		}

		const lineEdit = new LineEdit(edits);

		return {
			lineEdit,
			patch: lineEdit.humanReadablePatch(editWindow).split('\n'),
		};
	}

	suite('edit window with all lines being unique', () => {

		const editWindow = [
			`export function printParseTree(node: Parser.SyntaxNode, options: PrintingOptions, print: NodePrinter = ParseTreeEditor.renderNode): string[] {`,
			`	const printedNodes: string[] = [];`,
			`	traverseDFPreOrder(node, (cursor, depth) => {`,
			`		const currentNode = cursor.currentNode();`,
			`		if (options.printOnlyNamed && !currentNode.isNamed()) {`,
			`			return;`,
			`		}`,
			`		const printedNode = print(currentNode, depth, cursor.currentFieldName());`,
			`		printedNodes.push(printedNode);`,
			`	});`,
			`	return printedNodes;`,
			`}`
		];

		test('in stream middle - 1 line diff', async () => {

			const updatedEditWindow = [...editWindow];
			updatedEditWindow.splice(2, 1, '	traverse(node, (cursor, depth) => {');

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "    1   1 export function printParseTree(node: Parser.SyntaxNode, options: PrintingOptions, print: NodePrinter = ParseTreeEditor.renderNode): string[] {",
				  "    2   2 	const printedNodes: string[] = [];",
				  "-   3     	traverseDFPreOrder(node, (cursor, depth) => {",
				  "+       3 	traverse(node, (cursor, depth) => {",
				  "    4   4 		const currentNode = cursor.currentNode();",
				  "    5   5 		if (options.printOnlyNamed && !currentNode.isNamed()) {",
				  "    6   6 			return;",
				]
			`);
		});

		test('in stream middle - 2 consecutive lines diff', async () => {

			const updatedEditWindow = [...editWindow];
			updatedEditWindow.splice(2, 1, '	traverse(node, (cursor, depth) => {', '		console.log("new line");');

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "    1   1 export function printParseTree(node: Parser.SyntaxNode, options: PrintingOptions, print: NodePrinter = ParseTreeEditor.renderNode): string[] {",
				  "    2   2 	const printedNodes: string[] = [];",
				  "-   3     	traverseDFPreOrder(node, (cursor, depth) => {",
				  "+       3 	traverse(node, (cursor, depth) => {",
				  "+       4 		console.log("new line");",
				  "    4   5 		const currentNode = cursor.currentNode();",
				  "    5   6 		if (options.printOnlyNamed && !currentNode.isNamed()) {",
				  "    6   7 			return;",
				]
			`);
		});

		test('in stream middle - 1 line diff, 2 consecutive lines diff', async () => {

			const updatedEditWindow = [...editWindow];
			updatedEditWindow.splice(2, 1,
				'	traverse(node, (cursor, depth) => {');
			updatedEditWindow.splice(7, 2,
				`		const myPrintedNode = print(currentNode, depth, cursor.currentFieldName());`,
				`		printedNodes.push(myPrintedNode);`);

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "    1   1 export function printParseTree(node: Parser.SyntaxNode, options: PrintingOptions, print: NodePrinter = ParseTreeEditor.renderNode): string[] {",
				  "    2   2 	const printedNodes: string[] = [];",
				  "-   3     	traverseDFPreOrder(node, (cursor, depth) => {",
				  "+       3 	traverse(node, (cursor, depth) => {",
				  "    4   4 		const currentNode = cursor.currentNode();",
				  "    5   5 		if (options.printOnlyNamed && !currentNode.isNamed()) {",
				  "    6   6 			return;",
				  "    7   7 		}",
				  "-   8     		const printedNode = print(currentNode, depth, cursor.currentFieldName());",
				  "-   9     		printedNodes.push(printedNode);",
				  "+       8 		const myPrintedNode = print(currentNode, depth, cursor.currentFieldName());",
				  "+       9 		printedNodes.push(myPrintedNode);",
				  "   10  10 	});",
				  "   11  11 	return printedNodes;",
				  "   12  12 }",
				]
			`);
		});

		test('removes lines at beginning', async () => {

			const updatedEditWindow = [...editWindow];
			updatedEditWindow.splice(0, 3);

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "-   1     export function printParseTree(node: Parser.SyntaxNode, options: PrintingOptions, print: NodePrinter = ParseTreeEditor.renderNode): string[] {",
				  "-   2     	const printedNodes: string[] = [];",
				  "-   3     	traverseDFPreOrder(node, (cursor, depth) => {",
				  "    4   1 		const currentNode = cursor.currentNode();",
				  "    5   2 		if (options.printOnlyNamed && !currentNode.isNamed()) {",
				  "    6   3 			return;",
				]
			`);
		});

		test('removes lines at end', async () => {

			const updatedEditWindow = [...editWindow];
			updatedEditWindow.splice(9, 3);

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "    8   8 		const printedNode = print(currentNode, depth, cursor.currentFieldName());",
				  "    9   9 		printedNodes.push(printedNode);",
				  "-  10     	});",
				  "-  11     	return printedNodes;",
				  "-  12     }",
				]
			`);
		});

	});

	suite('edit window with non-unique lines', () => {

		test('removes lines at end', async () => {
			const editWindow = [
				`}`,
				``,
				`int multiply(int a, int b = 1, int c = 2) {`,
				`	return a * b;`,
				`}`,
				``,
				`template<typename... Args> auto sum(Args... args) {`,
				`	return (args + ...);`,
				`}`,
				``,
				`template<typename T> T identify(T value) {`,
				`	return value;`,
				`}`,
			];

			const updatedEditWindow = [...editWindow];
			updatedEditWindow.splice(3, 1, '	return a * b * c;');

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "    2   2 ",
				  "    3   3 int multiply(int a, int b = 1, int c = 2) {",
				  "-   4     	return a * b;",
				  "+       4 	return a * b * c;",
				  "    5   5 }",
				  "    6   6 ",
				  "    7   7 template<typename... Args> auto sum(Args... args) {",
				]
			`);
		});

		test('matching line quite below', async () => {
			const editWindow = [
				'			if (!document) {',
				'				return;',
				'			}				document.selection.set(e.selections.map(s => new OffsetRange(e.textEditor.document.offsetAt(s.start), e.textEditor.document.offsetAt(s.end)), undefined);		}));',
				'',
				'		this._register(workspace.onDidCloseTextDocument(e => {',
				'			if (!this.filter.isTrackingEnabled(e)) {',
				'				return;',
				'			}',
				'',
				'			this._tracker.handleDocumentClosed(documentUriFromTextDocument(e));',
				'		}));',
				'',
				'		for (const doc of workspace.textDocuments) {',
			];

			const updatedEditWindow = [...editWindow];
			updatedEditWindow.splice(2, 1,
				'			}',
				'			document.selection.set(e.selections.map(s => new OffsetRange(e.textEditor.document.offsetAt(s.start), e.textEditor.document.offsetAt(s.end)), undefined));',
				'		}));'
			);

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "    1   1 			if (!document) {",
				  "    2   2 				return;",
				  "-   3     			}				document.selection.set(e.selections.map(s => new OffsetRange(e.textEditor.document.offsetAt(s.start), e.textEditor.document.offsetAt(s.end)), undefined);		}));",
				  "+       3 			}",
				  "+       4 			document.selection.set(e.selections.map(s => new OffsetRange(e.textEditor.document.offsetAt(s.start), e.textEditor.document.offsetAt(s.end)), undefined));",
				  "+       5 		}));",
				  "    4   6 ",
				  "    5   7 		this._register(workspace.onDidCloseTextDocument(e => {",
				  "    6   8 			if (!this.filter.isTrackingEnabled(e)) {",
				]
			`);
		});

		test('converge at two lines', async () => {
			const editWindow = [
				`class Point3D {`,
				`    x: number;`,
				`    y: number;`,
				``,
				`    constructor(x: number, y: number) {`,
				`        this.x = x;`,
				`        this.y = y;`,
				`    }`,
				``,
				`    spaghetti(): number {`,
				`        return this.x + this.y;`,
			];

			const lineEdit = new LineEdit([
				new LineReplacement(
					new LineRange(4, 4),
					['    z: number;'],
				),
				new LineReplacement(
					new LineRange(5, 6),
					['    constructor(x: number, y: number, z: number) {'],
				),
				new LineReplacement(
					new LineRange(8, 8),
					['        this.z = z;'],
				),
				new LineReplacement(
					new LineRange(11, 12),
					['        return this.x + this.y + this.z;']
				)
			]);

			const updatedEditWindow = lineEdit.apply(editWindow);

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "    2   2     x: number;",
				  "    3   3     y: number;",
				  "-   4     ",
				  "-   5         constructor(x: number, y: number) {",
				  "+       4     z: number;",
				  "+       5 ",
				  "+       6     constructor(x: number, y: number, z: number) {",
				  "    6   7         this.x = x;",
				  "    7   8         this.y = y;",
				  "+       9         this.z = z;",
				  "    8  10     }",
				  "    9  11 ",
				  "   10  12     spaghetti(): number {",
				  "-  11             return this.x + this.y;",
				  "+      13         return this.x + this.y + this.z;",
				]
			`);
		});

		test('prefers adding lines than removing them', async () => {
			const editWindow = [
				`a`,
				`b`,
				`c`,
				`d`,
				`e`,
				`f`,
			];

			const lineEdit = new LineEdit([
				new LineReplacement(
					new LineRange(3, 5),
					['c1'],
				),
			]);

			const updatedEditWindow = lineEdit.apply(editWindow);

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "    1   1 a",
				  "    2   2 b",
				  "-   3     c",
				  "-   4     d",
				  "+       3 c1",
				  "    5   4 e",
				  "    6   5 f",
				]
			`);
		});

		test('repetitive code should not result in deletion', async () => {
			const editWindow = [
				`function updateKthEntry<T>() {}`,
				``,
				`function updateAllEntries<T>(cache: Cache, documentId: DocumentId, entries: T[]) {`,
				`    const cachedEntries = cache.get(documentId);`,
				`    if (cachedEntries === undefined) {`,
				`        return;`,
				`    }`,
				`    cachedEntries.push(...entries);`,
				`}`,
			];

			const updatedEditWindow = [
				`function updateKthEntry<T>(cache: Cache, documentId: DocumentId, k: number, entry: T) {`,
				`    const cachedEntries = cache.get(documentId);`,
				`    if (cachedEntries === undefined) {`,
				`        return;`,
				`    }`,
				`    cachedEntries[k] = entry;`,
				`}`,
				``,
				`function updateAllEntries<T>(cache: Cache, documentId: DocumentId, entries: T[]) {`,
				`    const cachedEntries = cache.get(documentId);`,
				`    if (cachedEntries === undefined) {`,
				`        return;`,
				`    }`,
				`    cachedEntries.push(...entries);`,
				`}`,
			];

			const { patch } = await run(editWindow, updatedEditWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "-   1     function updateKthEntry<T>() {}",
				  "+       1 function updateKthEntry<T>(cache: Cache, documentId: DocumentId, k: number, entry: T) {",
				  "+       2     const cachedEntries = cache.get(documentId);",
				  "+       3     if (cachedEntries === undefined) {",
				  "+       4         return;",
				  "+       5     }",
				  "+       6     cachedEntries[k] = entry;",
				  "+       7 }",
				  "    2   8 ",
				  "    3   9 function updateAllEntries<T>(cache: Cache, documentId: DocumentId, entries: T[]) {",
				  "    4  10     const cachedEntries = cache.get(documentId);",
				]
			`);
		});

		test('no edits', async () => {
			const editWindow = [
				`		const logger = this._logger.createSubLogger('_trigger');`,
				``,
				`		const result = suggestion.result;`,
				`		if (!result?.edit) {`,
				``,
				`			return;`,
				`		}`,
				``,
			];
			const { patch } = await run(editWindow, editWindow);
			expect(patch).toMatchInlineSnapshot(`
				[
				  "",
				]
			`);
		});

	});
});

describe('emitFastCursorLineChange with empty lines', () => {

	async function runWithFastCursor(
		editWindow: string[],
		updatedEditWindowLines: string[],
		cursorOffset: number,
		emitFastCursorLineChange: ResponseProcessor.EmitFastCursorLineChange = ResponseProcessor.EmitFastCursorLineChange.AdditiveOnly,
	) {
		const updatedEditWindowLinesStream = AsyncIterUtils.fromArray(updatedEditWindowLines);

		const params: ResponseProcessor.DiffParams = {
			...ResponseProcessor.DEFAULT_DIFF_PARAMS,
			emitFastCursorLineChange,
		};

		const editsGen = ResponseProcessor.diff(editWindow, updatedEditWindowLinesStream, cursorOffset, params);

		const edits: LineReplacement[] = [];
		for await (const edit of editsGen) {
			edits.push(edit);
		}

		const lineEdit = new LineEdit(edits);

		return {
			lineEdit,
			edits,
			patch: lineEdit.humanReadablePatch(editWindow).split('\n'),
		};
	}

	it('should skip fast-emit when empty cursor line is deleted and new content matches next line prefix', async () => {
		const editWindow = ['before', '', 'after_unique'];
		const updatedEditWindow = ['before', 'aft'];

		const { edits } = await runWithFastCursor(editWindow, updatedEditWindow, 1);

		expect(edits.length).toBe(1);
		expect(edits[0].lineRange.startLineNumber).toBe(2);
	});

	it('should skip fast-emit when empty cursor line is deleted and new content exactly matches next line', async () => {
		const editWindow = ['before', '', 'unique_after'];


		const { patch } = await runWithFastCursor(editWindow, ['before', 'unique_after'], 1);

		expect(patch).toMatchInlineSnapshot(`
			[
			  "    1   1 before",
			  "-   2     ",
			  "-   3     unique_after",
			  "+       2 unique_after",
			]
		`);
	});

	it('should emit fast cursor change when replacing empty line with truly new content', async () => {
		const editWindow = ['before', '', 'zzz_after'];
		const updatedEditWindow = ['before', 'brand_new_content', 'zzz_after'];

		const { edits } = await runWithFastCursor(editWindow, updatedEditWindow, 1);

		expect(edits.length).toBe(1);
		expect(edits[0].newLines).toEqual(['brand_new_content']);
	});

	it('should handle empty cursor line at end of document', async () => {
		const editWindow = ['before', 'middle', ''];
		const updatedEditWindow = ['before', 'middle', 'new_content'];

		const { edits } = await runWithFastCursor(editWindow, updatedEditWindow, 2);

		expect(edits.length).toBe(1);
		expect(edits[0].newLines).toEqual(['new_content']);
	});

	it('should not confuse replacement with deletion when content differs from next line', async () => {
		const editWindow = ['aaa', '', 'bbb_unique'];
		const updatedEditWindow = ['aaa', 'xxx_completely_different', 'bbb_unique'];

		const { edits } = await runWithFastCursor(editWindow, updatedEditWindow, 1);

		expect(edits.length).toBe(1);
		expect(edits[0].newLines).toEqual(['xxx_completely_different']);
	});

});

describe('isAdditiveEdit', () => {

	it('should detect simple substring additions as additive', () => {
		expect(ResponseProcessor.isAdditiveEdit('hello', 'hello world')).toMatchInlineSnapshot(`true`);
		expect(ResponseProcessor.isAdditiveEdit('world', 'hello world')).toMatchInlineSnapshot(`true`);
		expect(ResponseProcessor.isAdditiveEdit('hello world', 'hello world')).toMatchInlineSnapshot(`true`);
	});

	it('should detect insertions in the middle as additive', () => {
		expect(ResponseProcessor.isAdditiveEdit('function fib() {', 'function fib(n: number) {')).toMatchInlineSnapshot(`true`);

		expect(ResponseProcessor.isAdditiveEdit('const x = 5', 'const x: number = 5')).toMatchInlineSnapshot(`true`);

		expect(ResponseProcessor.isAdditiveEdit('function foo() {}', 'async function foo() {}')).toMatchInlineSnapshot(`true`);
	});

	it('should detect character insertions as additive', () => {
		expect(ResponseProcessor.isAdditiveEdit('abc', 'aXbYcZ')).toMatchInlineSnapshot(`true`);
		expect(ResponseProcessor.isAdditiveEdit('abc', 'XXXaYYYbZZZc')).toMatchInlineSnapshot(`true`);
	});

	it('should detect deletions as non-additive', () => {
		expect(ResponseProcessor.isAdditiveEdit('hello world', 'hello')).toMatchInlineSnapshot(`false`);
		expect(ResponseProcessor.isAdditiveEdit('hello world', 'world')).toMatchInlineSnapshot(`false`);
		expect(ResponseProcessor.isAdditiveEdit('function fib(n: number) {', 'function fib() {')).toMatchInlineSnapshot(`false`);
	});

	it('should detect replacements as non-additive', () => {
		expect(ResponseProcessor.isAdditiveEdit('function fib() {', 'function gib() {')).toMatchInlineSnapshot(`false`);

		expect(ResponseProcessor.isAdditiveEdit('const x = 5', 'const x = 10')).toMatchInlineSnapshot(`false`);
	});

	it('should handle empty strings', () => {
		expect(ResponseProcessor.isAdditiveEdit('', '')).toMatchInlineSnapshot(`true`);
		expect(ResponseProcessor.isAdditiveEdit('', 'hello')).toMatchInlineSnapshot(`true`);
		expect(ResponseProcessor.isAdditiveEdit('hello', '')).toMatchInlineSnapshot(`false`);
	});

	it('should handle whitespace changes', () => {
		expect(ResponseProcessor.isAdditiveEdit('a b', 'a  b')).toMatchInlineSnapshot(`true`);
		expect(ResponseProcessor.isAdditiveEdit('ab', 'a b')).toMatchInlineSnapshot(`true`);

		expect(ResponseProcessor.isAdditiveEdit('a  b', 'a b')).toMatchInlineSnapshot(`false`);
	});

	it('should handle complex code transformations', () => {
		expect(ResponseProcessor.isAdditiveEdit('obj.prop', 'obj?.prop')).toMatchInlineSnapshot(`true`);

		expect(ResponseProcessor.isAdditiveEdit('`hello`', '`hello ${name}`')).toMatchInlineSnapshot(`true`);

		expect(ResponseProcessor.isAdditiveEdit('[1, 2]', '[1, 2, 3]')).toMatchInlineSnapshot(`true`);

		expect(ResponseProcessor.isAdditiveEdit('{ a: 1 }', '{ a: 1, b: 2 }')).toMatchInlineSnapshot(`true`);
	});

	it('should handle repeated characters correctly', () => {
		expect(ResponseProcessor.isAdditiveEdit('aaa', 'aaaa')).toMatchInlineSnapshot(`true`);
		expect(ResponseProcessor.isAdditiveEdit('aaa', 'aXaYaZ')).toMatchInlineSnapshot(`true`);
		expect(ResponseProcessor.isAdditiveEdit('aaaa', 'aaa')).toMatchInlineSnapshot(`false`);
	});
});
