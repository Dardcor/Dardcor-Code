/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'node:test';
import assert from 'node:assert/strict';
import { getFoldingRanges } from '../modes/htmlFolding.js';
import { TextDocument, getLanguageModes } from '../modes/languageModes.js';
import { ClientCapabilities } from 'vscode-css-languageservice';
import { getNodeFileFS } from '../node/nodeFs.js';

interface ExpectedIndentRange {
	startLine: number;
	endLine: number;
	kind?: string;
}

async function assertRanges(lines: string[], expected: ExpectedIndentRange[], message?: string, nRanges?: number): Promise<void> {
	const document = TextDocument.create('test://foo/bar.html', 'html', 1, lines.join('\n'));
	const workspace = {
		settings: {},
		folders: [{ name: 'foo', uri: 'test://foo' }]
	};
	const languageModes = getLanguageModes({ css: true, javascript: true }, workspace, ClientCapabilities.LATEST, getNodeFileFS());
	try {
		const actual = await getFoldingRanges(languageModes, document, nRanges, null);

		let actualRanges = [];
		for (let i = 0; i < actual.length; i++) {
			actualRanges[i] = r(actual[i].startLine, actual[i].endLine, actual[i].kind);
		}
		actualRanges = actualRanges.sort((r1, r2) => r1.startLine - r2.startLine);
		assert.deepStrictEqual(actualRanges, expected, message);
	} finally {
		languageModes.dispose();
	}
}

function r(startLine: number, endLine: number, kind?: string): ExpectedIndentRange {
	return { startLine, endLine, kind };
}

suite('HTML Folding', () => {

	test('Embedded JavaScript', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			'function f() {',
			'}',
			'</script>',
			'</head>',
			'</html>',
		];
		await await assertRanges(input, [r(0, 6), r(1, 5), r(2, 4), r(3, 4)]);
	});

	test('Embedded JavaScript - multiple areas', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			'  var x = {',
			'    foo: true,',
			'    bar: {}',
			'  };',
			'</script>',
			'<script>',
			'  test(() => { // hello',
			'    f();',
			'  });',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertRanges(input, [r(0, 13), r(1, 12), r(2, 6), r(3, 6), r(8, 11), r(9, 11), r(9, 11)]);
	});

	test('Embedded JavaScript - incomplete', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			'  var x = {',
			'</script>',
			'<script>',
			'  });',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertRanges(input, [r(0, 8), r(1, 7), r(2, 3), r(5, 6)]);
	});

	test('Embedded JavaScript - regions', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			'  // #region Lalala',
			'   //  #region',
			'   x = 9;',
			'  //  #endregion',
			'  // #endregion Lalala',
			'</script>',
			'</head>',
			'</html>',
		];
		await assertRanges(input, [r(0, 9), r(1, 8), r(2, 7), r(3, 7, 'region'), r(4, 6, 'region')]);
	});

	test('Embedded CSS', async () => {
		const input = [
			'<html>',
			'<head>',
			'<style>',
			'  foo {',
			'   display: block;',
			'   color: black;',
			'  }',
			'</style>',
			'</head>',
			'</html>',
		];
		await assertRanges(input, [r(0, 8), r(1, 7), r(2, 6), r(3, 5)]);
	});

	test('Embedded CSS - multiple areas', async () => {
		const input = [
			'<html>',
			'<head style="color:red">',
			'<style>',
			'  /*',
			'    foo: true,',
			'    bar: {}',
			'  */',
			'</style>',
			'<style>',
			'  @keyframes mymove {',
			'    from {top: 0px;}',
			'  }',
			'</style>',
			'</head>',
			'</html>',
		];
		await assertRanges(input, [r(0, 13), r(1, 12), r(2, 6), r(3, 6, 'comment'), r(8, 11), r(9, 10)]);
	});

	test('Embedded CSS - regions', async () => {
		const input = [
			'<html>',
			'<head>',
			'<style>',
			'  /* #region Lalala */',
			'   /*  #region*/',
			'   x = 9;',
			'  /*  #endregion*/',
			'  /* #endregion Lalala*/',
			'</style>',
			'</head>',
			'</html>',
		];
		await assertRanges(input, [r(0, 9), r(1, 8), r(2, 7), r(3, 7, 'region'), r(4, 6, 'region')]);
	});



	test('Test limit', async () => {
		const input = [
			'<div>',
			' <span>',
			'  <b>',
			'  ',
			'  </b>,',
			'  <b>',
			'   <pre>',
			'  ',
			'   </pre>,',
			'   <pre>',
			'  ',
			'   </pre>,',
			'  </b>,',
			'  <b>',
			'  ',
			'  </b>,',
			'  <b>',
			'  ',
			'  </b>',
			' </span>',
			'</div>',
		];
		await assertRanges(input, [r(0, 19), r(1, 18), r(2, 3), r(5, 11), r(6, 7), r(9, 10), r(13, 14), r(16, 17)], 'no limit', undefined);
		await assertRanges(input, [r(0, 19), r(1, 18), r(2, 3), r(5, 11), r(6, 7), r(9, 10), r(13, 14), r(16, 17)], 'limit 8', 8);
		await assertRanges(input, [r(0, 19), r(1, 18), r(2, 3), r(5, 11), r(6, 7), r(13, 14), r(16, 17)], 'limit 7', 7);
		await assertRanges(input, [r(0, 19), r(1, 18), r(2, 3), r(5, 11), r(13, 14), r(16, 17)], 'limit 6', 6);
		await assertRanges(input, [r(0, 19), r(1, 18), r(2, 3), r(5, 11), r(13, 14)], 'limit 5', 5);
		await assertRanges(input, [r(0, 19), r(1, 18), r(2, 3), r(5, 11)], 'limit 4', 4);
		await assertRanges(input, [r(0, 19), r(1, 18), r(2, 3)], 'limit 3', 3);
		await assertRanges(input, [r(0, 19), r(1, 18)], 'limit 2', 2);
		await assertRanges(input, [r(0, 19)], 'limit 1', 1);
	});

});
