/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'node:test';
import assert from 'node:assert/strict';
import { TextDocument, getLanguageModes, ClientCapabilities, Range, Position } from '../modes/languageModes.js';
import { newSemanticTokenProvider } from '../modes/semanticTokens.js';
import { getNodeFileFS } from '../node/nodeFs.js';

interface ExpectedToken {
	startLine: number;
	character: number;
	length: number;
	tokenClassifiction: string;
}

async function assertTokens(lines: string[], expected: ExpectedToken[], ranges?: Range[], message?: string): Promise<void> {
	const document = TextDocument.create('test://foo/bar.html', 'html', 1, lines.join('\n'));
	const workspace = {
		settings: {},
		folders: [{ name: 'foo', uri: 'test://foo' }]
	};
	const languageModes = getLanguageModes({ css: true, javascript: true }, workspace, ClientCapabilities.LATEST, getNodeFileFS());
	const semanticTokensProvider = newSemanticTokenProvider(languageModes);

	try {
		const legend = semanticTokensProvider.legend;
		const actual = await semanticTokensProvider.getSemanticTokens(document, ranges);

		const actualRanges = [];
		let lastLine = 0;
		let lastCharacter = 0;
		for (let i = 0; i < actual.length; i += 5) {
			const lineDelta = actual[i], charDelta = actual[i + 1], len = actual[i + 2], typeIdx = actual[i + 3], modSet = actual[i + 4];
			const line = lastLine + lineDelta;
			const character = lineDelta === 0 ? lastCharacter + charDelta : charDelta;
			const tokenClassifiction = [legend.types[typeIdx], ...legend.modifiers.filter((_, i) => modSet & 1 << i)].join('.');
			actualRanges.push(t(line, character, len, tokenClassifiction));
			lastLine = line;
			lastCharacter = character;
		}
		assert.deepStrictEqual(actualRanges, expected, message);
	} finally {
		languageModes.dispose();
	}
}

function t(startLine: number, character: number, length: number, tokenClassifiction: string): ExpectedToken {
	return { startLine, character, length, tokenClassifiction };
}

suite('HTML Semantic Tokens', () => {

	test('Variables', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			'  var x = 9, y1 = [x];',
			'  try {',
			'    for (const s of y1) { x = s }',
			'  } catch (e) {',
			'    throw y1;',
			'  }',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertTokens(input, [
			t(3, 6, 1, 'variable.declaration'), t(3, 13, 2, 'variable.declaration'), t(3, 19, 1, 'variable'),
			t(5, 15, 1, 'variable.declaration.readonly.local'), t(5, 20, 2, 'variable'), t(5, 26, 1, 'variable'), t(5, 30, 1, 'variable.readonly.local'),
			t(6, 11, 1, 'variable.declaration.local'),
			t(7, 10, 2, 'variable')
		]);
	});

	test('Functions', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			'  function foo(p1) {',
			'    return foo(Math.abs(p1))',
			'  }',
			'  `/${window.location}`.split("/").forEach(s => foo(s));',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertTokens(input, [
			t(3, 11, 3, 'function.declaration'), t(3, 15, 2, 'parameter.declaration'),
			t(4, 11, 3, 'function'), t(4, 15, 4, 'variable.defaultLibrary'), t(4, 20, 3, 'method.defaultLibrary'), t(4, 24, 2, 'parameter'),
			t(6, 6, 6, 'variable.defaultLibrary'), t(6, 13, 8, 'property.defaultLibrary'), t(6, 24, 5, 'method.defaultLibrary'), t(6, 35, 7, 'method.defaultLibrary'), t(6, 43, 1, 'parameter.declaration'), t(6, 48, 3, 'function'), t(6, 52, 1, 'parameter')
		]);
	});

	test('Members', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			'  class A {',
			'    static x = 9;',
			'    f = 9;',
			'    async m() { return A.x + await this.m(); };',
			'    get s() { return this.f; ',
			'    static t() { return new A().f; };',
			'    constructor() {}',
			'  }',
			'</script>',
			'</head>',
			'</html>',
		];


		await assertTokens(input, [
			t(3, 8, 1, 'class.declaration'),
			t(4, 11, 1, 'property.declaration.static'),
			t(5, 4, 1, 'property.declaration'),
			t(6, 10, 1, 'method.declaration.async'), t(6, 23, 1, 'class'), t(6, 25, 1, 'property.static'), t(6, 40, 1, 'method.async'),
			t(7, 8, 1, 'property.declaration'), t(7, 26, 1, 'property'),
			t(8, 11, 1, 'method.declaration.static'), t(8, 28, 1, 'class'), t(8, 32, 1, 'property'),
		]);
	});

	test('Interfaces', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script type="text/typescript">',
			'  interface Position { x: number, y: number };',
			'  const p = { x: 1, y: 2 } as Position;',
			'  const foo = (o: Position) => o.x + o.y;',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertTokens(input, [
			t(3, 12, 8, 'interface.declaration'), t(3, 23, 1, 'property.declaration'), t(3, 34, 1, 'property.declaration'),
			t(4, 8, 1, 'variable.declaration.readonly'), t(4, 14, 1, 'property.declaration'), t(4, 20, 1, 'property.declaration'), t(4, 30, 8, 'interface'),
			t(5, 8, 3, 'function.declaration.readonly'), t(5, 15, 1, 'parameter.declaration'), t(5, 18, 8, 'interface'), t(5, 31, 1, 'parameter'), t(5, 33, 1, 'property'), t(5, 37, 1, 'parameter'), t(5, 39, 1, 'property')
		]);
	});

	test('Readonly', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script type="text/typescript">',
			'  const f = 9;',
			'  class A { static readonly t = 9; static url: URL; }',
			'  const enum E { A = 9, B = A + 1 }',
			'  console.log(f + A.t + A.url.origin);',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertTokens(input, [
			t(3, 8, 1, 'variable.declaration.readonly'),
			t(4, 8, 1, 'class.declaration'), t(4, 28, 1, 'property.declaration.static.readonly'), t(4, 42, 3, 'property.declaration.static'), t(4, 47, 3, 'interface.defaultLibrary'),
			t(5, 13, 1, 'enum.declaration'), t(5, 17, 1, 'enumMember.declaration.readonly'), t(5, 24, 1, 'enumMember.declaration.readonly'), t(5, 28, 1, 'enumMember.readonly'),
			t(6, 2, 7, 'variable.defaultLibrary'), t(6, 10, 3, 'method.defaultLibrary'), t(6, 14, 1, 'variable.readonly'), t(6, 18, 1, 'class'), t(6, 20, 1, 'property.static.readonly'), t(6, 24, 1, 'class'), t(6, 26, 3, 'property.static'), t(6, 30, 6, 'property.readonly.defaultLibrary'),
		]);
	});


	test('Type aliases and type parameters', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script type="text/typescript">',
			'  type MyMap = Map<string, number>;',
			'  function f<T extends MyMap>(t: T | number) : T { ',
			'    return <T> <unknown> new Map<string, MyMap>();',
			'  }',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertTokens(input, [
			t(3, 7, 5, 'type.declaration'), t(3, 15, 3, 'interface.defaultLibrary') ,
			t(4, 11, 1, 'function.declaration'), t(4, 13, 1, 'typeParameter.declaration'), t(4, 23, 5, 'type'), t(4, 30, 1, 'parameter.declaration'), t(4, 33, 1, 'typeParameter'), t(4, 47, 1, 'typeParameter'),
			t(5, 12, 1, 'typeParameter'), t(5, 29, 3, 'class.defaultLibrary'), t(5, 41, 5, 'type'),
		]);
	});

	test('TS and JS', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script type="text/typescript">',
			'  function f<T>(p1: T): T[] { return [ p1 ]; }',
			'</script>',
			'<script>',
			'  window.alert("Hello");',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertTokens(input, [
			t(3, 11, 1, 'function.declaration'), t(3, 13, 1, 'typeParameter.declaration'), t(3, 16, 2, 'parameter.declaration'), t(3, 20, 1, 'typeParameter'), t(3, 24, 1, 'typeParameter'), t(3, 39, 2, 'parameter'),
			t(6, 2, 6, 'variable.defaultLibrary'), t(6, 9, 5, 'method.defaultLibrary')
		]);
	});

	test('Ranges', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			'  window.alert("Hello");',
			'</script>',
			'<script>',
			'  window.alert("World");',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertTokens(input, [
			t(3, 2, 6, 'variable.defaultLibrary'), t(3, 9, 5, 'method.defaultLibrary')
		], [Range.create(Position.create(2, 0), Position.create(4, 0))]);

		await assertTokens(input, [
			t(6, 2, 6, 'variable.defaultLibrary'),
		], [Range.create(Position.create(6, 2), Position.create(6, 8))]);
	});


});

