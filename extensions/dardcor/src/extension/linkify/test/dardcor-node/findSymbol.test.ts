/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { findBestSymbolByPath } from '../../dardcor-node/findSymbol';

suite('Find symbol', () => {
	function docSymbol(name: string, ...children: vscode.DocumentSymbol[]): vscode.DocumentSymbol {
		return {
			name,
			children,
			detail: '',
			range: new vscode.Range(0, 0, 0, 0),
			selectionRange: new vscode.Range(0, 0, 0, 0),
			kind: vscode.SymbolKind.Variable,
		};
	}

	function symbolInfo(name: string): vscode.SymbolInformation {
		return {
			name,
			containerName: '',
			kind: vscode.SymbolKind.Variable,
			location: {
				uri: vscode.Uri.file('fake'),
				range: new vscode.Range(0, 0, 0, 0),
			}
		};
	}

	test('Should find exact match', () => {
		assert.strictEqual(findBestSymbolByPath([docSymbol('a')], 'a')?.name, 'a');
		assert.strictEqual(findBestSymbolByPath([symbolInfo('a')], 'a')?.name, 'a');
	});

	test('Should find nested', () => {
		assert.strictEqual(findBestSymbolByPath([docSymbol('x', docSymbol('a'))], 'a')?.name, 'a');
	});

	test('Should find child match', () => {
		assert.strictEqual(findBestSymbolByPath([docSymbol('a', docSymbol('b'))], 'a.b')?.name, 'b');
	});

	test('Should find child match skipping level', () => {
		assert.strictEqual(findBestSymbolByPath([docSymbol('a', docSymbol('x', docSymbol('b')))], 'a.b')?.name, 'b');
	});

	test(`Should find match even when children don't match`, () => {
		assert.strictEqual(findBestSymbolByPath([docSymbol('a')], 'a.b')?.name, 'a');
	});

	test(`Should find longest match`, () => {
		assert.strictEqual(findBestSymbolByPath([
			docSymbol('a',
				docSymbol('x')),
			docSymbol('x',
				docSymbol('a',
					docSymbol('b',
						docSymbol('z'))))
		], 'a.b')?.name, 'b');
	});

	test('Should ignore function call notation', () => {
		assert.strictEqual(findBestSymbolByPath([docSymbol('a')], 'a()')?.name, 'a');
		assert.strictEqual(findBestSymbolByPath([docSymbol('a')], 'a(1, 2, 3)')?.name, 'a');
		assert.strictEqual(findBestSymbolByPath([docSymbol('a')], 'a(b, c)')?.name, 'a');
		assert.strictEqual(findBestSymbolByPath([docSymbol('a')], 'a(b: string)')?.name, 'a');
	});

	test('Should ignore generic notation', () => {
		assert.strictEqual(findBestSymbolByPath([docSymbol('a')], 'a<T>')?.name, 'a');
		assert.strictEqual(findBestSymbolByPath([docSymbol('a')], 'a<T>.b')?.name, 'a');
	});

	test('Should match on symbols with $', () => {
		assert.strictEqual(findBestSymbolByPath([docSymbol('$a')], '$a')?.name, '$a');
	});

	test('Should match on symbols with _', () => {
		assert.strictEqual(findBestSymbolByPath([docSymbol('_a_')], '_a_')?.name, '_a_');
	});

	test('Should prefer rightmost symbol in flat symbols', () => {
		assert.strictEqual(
			findBestSymbolByPath([
				symbolInfo('TextModel'),
				symbolInfo('undo')
			], 'TextModel.undo()')?.name,
			'undo'
		);
	});

	test('Should fall back to leftmost symbol if rightmost not found in flat symbols', () => {
		assert.strictEqual(
			findBestSymbolByPath([
				symbolInfo('TextModel'),
				symbolInfo('someOtherMethod')
			], 'TextModel.undo()')?.name,
			'TextModel'
		);
	});

	test('Should prefer hierarchical match over flat last part match', () => {
		assert.strictEqual(
			findBestSymbolByPath([
				docSymbol('TextModel', docSymbol('undo')),
				symbolInfo('undo')
			], 'TextModel.undo()')?.name,
			'undo'
		);
	});

	test('Should handle deeply qualified names', () => {
		assert.strictEqual(
			findBestSymbolByPath([
				docSymbol('namespace', docSymbol('TextModel', docSymbol('undo')))
			], 'namespace.TextModel.undo()')?.name,
			'undo'
		);

		assert.strictEqual(
			findBestSymbolByPath([
				symbolInfo('namespace'),
				symbolInfo('TextModel'),
				symbolInfo('undo')
			], 'namespace.TextModel.undo()')?.name,
			'undo'
		);

		assert.strictEqual(
			findBestSymbolByPath([
				symbolInfo('namespace'),
				symbolInfo('TextModel')
			], 'namespace.TextModel.undo()')?.name,
			'TextModel'
		);
	});

	test('Should handle mixed flat and hierarchical symbols', () => {
		assert.strictEqual(
			findBestSymbolByPath([
				symbolInfo('Model'),
				docSymbol('TextModel', docSymbol('undo')),
				symbolInfo('OtherClass')
			], 'TextModel.undo()')?.name,
			'undo'
		);
	});

	test('Should handle Python-style naming conventions', () => {
		assert.strictEqual(
			findBestSymbolByPath([
				docSymbol('MyClass', docSymbol('my_method'))
			], 'MyClass.my_method()')?.name,
			'my_method'
		);

		assert.strictEqual(
			findBestSymbolByPath([
				docSymbol('MyClass', docSymbol('__init__'))
			], 'MyClass.__init__()')?.name,
			'__init__'
		);

		assert.strictEqual(
			findBestSymbolByPath([
				docSymbol('MyClass', docSymbol('_private_method'))
			], 'MyClass._private_method()')?.name,
			'_private_method'
		);
	});

	test('Should handle Python module qualified names', () => {
		assert.strictEqual(
			findBestSymbolByPath([
				docSymbol('my_module', docSymbol('MyClass', docSymbol('my_method')))
			], 'my_module.MyClass.my_method()')?.name,
			'my_method'
		);
	});

	test('Should prefer rightmost match in flat symbols using position-based priority', () => {
		assert.strictEqual(
			findBestSymbolByPath([
				symbolInfo('TextModel'),
				symbolInfo('undo')
			], 'TextModel.undo()')?.name,
			'undo'
		);

		assert.strictEqual(
			findBestSymbolByPath([
				symbolInfo('undo'),
				symbolInfo('TextModel')
			], 'TextModel.undo()')?.name,
			'undo'
		);

		assert.strictEqual(
			findBestSymbolByPath([
				symbolInfo('a'),
				symbolInfo('b'),
				symbolInfo('c'),
			], 'a.b.c.d')?.name,
			'c'
		);
	});
});
