/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { closeAllEditors, withRandomFileEditor } from './testUtils';
import * as vscode from 'vscode';
import { parsePartialStylesheet, getFlatNode } from '../util';
import { isValidLocationForEmmetAbbreviation } from '../abbreviationActions';

suite('Tests for partial parse of Stylesheets', () => {
	teardown(closeAllEditors);

	function isValid(doc: vscode.TextDocument, range: vscode.Range, syntax: string): boolean {
		const rootNode = parsePartialStylesheet(doc, range.end);
		const endOffset = doc.offsetAt(range.end);
		const currentNode = getFlatNode(rootNode, endOffset, true);
		return isValidLocationForEmmetAbbreviation(doc, rootNode, currentNode, syntax, endOffset, range);
	}

	test('Ignore block comment inside rule', function (): any {
		const cssContents = `
p {
	margin: p ;
	/*dn: none; p */ p
	p
	p.
} p
`;
		return withRandomFileEditor(cssContents, '.css', (_, doc) => {
			const rangesForEmmet = [
				new vscode.Range(3, 18, 3, 19),
				new vscode.Range(4, 1, 4, 2),
				new vscode.Range(5, 1, 5, 3)
			];
			const rangesNotEmmet = [
				new vscode.Range(1, 0, 1, 1),
				new vscode.Range(2, 9, 2, 10),
				new vscode.Range(3, 3, 3, 5),
				new vscode.Range(3, 13, 3, 14),
				new vscode.Range(6, 2, 6, 3)

			];
			rangesForEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'css'), true);
			});
			rangesNotEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'css'), false);
			});

			return Promise.resolve();
		});
	});

	test('Ignore commented braces', function (): any {
		const sassContents = `
.foo
// .foo { brs
/* .foo { op.3
dn	{
*/
	bgc
} bg
`;
		return withRandomFileEditor(sassContents, '.scss', (_, doc) => {
			const rangesNotEmmet = [
				new vscode.Range(1, 0, 1, 4),
				new vscode.Range(2, 3, 2, 7),
				new vscode.Range(3, 3, 3, 7),
				new vscode.Range(4, 0, 4, 2),
				new vscode.Range(6, 1, 6, 2),
				new vscode.Range(7, 2, 7, 4)
			];
			rangesNotEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'scss'), false);
			});
			return Promise.resolve();
		});
	});

	test('Block comment between selector and open brace', function (): any {
		const cssContents = `
p
/* First line
of a multiline
comment */
{
	margin: p ;
	/*dn: none; p */ p
	p
	p.
} p
`;
		return withRandomFileEditor(cssContents, '.css', (_, doc) => {
			const rangesForEmmet = [
				new vscode.Range(7, 18, 7, 19),
				new vscode.Range(8, 1, 8, 2),
				new vscode.Range(9, 1, 9, 3)
			];
			const rangesNotEmmet = [
				new vscode.Range(1, 2, 1, 3),
				new vscode.Range(3, 3, 3, 4),
				new vscode.Range(5, 0, 5, 1),
				new vscode.Range(6, 9, 6, 10),
				new vscode.Range(7, 3, 7, 5),
				new vscode.Range(7, 13, 7, 14),
				new vscode.Range(10, 2, 10, 3)
			];
			rangesForEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'css'), true);
			});
			rangesNotEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'css'), false);
			});
			return Promise.resolve();
		});
	});

	test('Nested and consecutive rulesets with errors', function (): any {
		const sassContents = `
.foo{
	a
	a
}}{ p
}
.bar{
	@
	.rudi {
		@
	}
}}}
`;
		return withRandomFileEditor(sassContents, '.scss', (_, doc) => {
			const rangesForEmmet = [
				new vscode.Range(2, 1, 2, 2),
				new vscode.Range(3, 1, 3, 2),
				new vscode.Range(7, 1, 7, 2),
				new vscode.Range(9, 2, 9, 3),
			];
			const rangesNotEmmet = [
				new vscode.Range(4, 4, 4, 5),
				new vscode.Range(6, 3, 6, 4)
			];
			rangesForEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'scss'), true);
			});
			rangesNotEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'scss'), false);
			});
			return Promise.resolve();
		});
	});

	test('One liner sass', function (): any {
		const sassContents = `
.foo{dn}.bar{.boo{dn}dn}.comd{/*{dn*/p{div{dn}} }.foo{.other{dn}} dn
`;
		return withRandomFileEditor(sassContents, '.scss', (_, doc) => {
			const rangesForEmmet = [
				new vscode.Range(1, 5, 1, 7),
				new vscode.Range(1, 18, 1, 20),
				new vscode.Range(1, 21, 1, 23),
				new vscode.Range(1, 43, 1, 45),
				new vscode.Range(1, 61, 1, 63)
			];
			const rangesNotEmmet = [
				new vscode.Range(1, 3, 1, 4),
				new vscode.Range(1, 10, 1, 11),
				new vscode.Range(1, 15, 1, 16),
				new vscode.Range(1, 28, 1, 29),
				new vscode.Range(1, 33, 1, 34),
				new vscode.Range(1, 37, 1, 38),
				new vscode.Range(1, 39, 1, 42),
				new vscode.Range(1, 66, 1, 68)
			];
			rangesForEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'scss'), true);
			});
			rangesNotEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'scss'), false);
			});
			return Promise.resolve();
		});
	});

	test('Variables and interpolation', function (): any {
		const sassContents = `
p.#{dn} {
	p.3
	#{$attr}-color: blue;
	dn
} op
.foo{nes{ted}} {
	dn
}
`;
		return withRandomFileEditor(sassContents, '.scss', (_, doc) => {
			const rangesForEmmet = [
				new vscode.Range(2, 1, 2, 4),
				new vscode.Range(4, 1, 4, 3)
			];
			const rangesNotEmmet = [
				new vscode.Range(1, 0, 1, 1),
				new vscode.Range(1, 2, 1, 3),
				new vscode.Range(1, 4, 1, 6),
				new vscode.Range(3, 7, 3, 8),
				new vscode.Range(5, 2, 5, 4),
				new vscode.Range(7, 1, 7, 3),
				new vscode.Range(3, 1, 3, 2),
			];
			rangesForEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'scss'), true);
			});
			rangesNotEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'scss'), false);
			});
			return Promise.resolve();
		});
	});

	test('Comments in sass', function (): any {
		const sassContents = `
.foo{
	/* p // p */ brs6-2p
	dn
}
p
/* c
om
ment */{
	m10
}
.boo{
	op.3
}
`;
		return withRandomFileEditor(sassContents, '.scss', (_, doc) => {
			const rangesForEmmet = [
				new vscode.Range(2, 14, 2, 21),
				new vscode.Range(3, 1, 3, 3),
				new vscode.Range(9, 1, 9, 4),
				new vscode.Range(12, 1, 12, 5)
			];
			const rangesNotEmmet = [
				new vscode.Range(2, 4, 2, 5),
				new vscode.Range(2, 9, 2, 10),
				new vscode.Range(6, 3, 6, 4)
			];
			rangesForEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'scss'), true);
			});
			rangesNotEmmet.forEach(range => {
				assert.strictEqual(isValid(doc, range, 'scss'), false);
			});
			return Promise.resolve();
		});
	});


});
