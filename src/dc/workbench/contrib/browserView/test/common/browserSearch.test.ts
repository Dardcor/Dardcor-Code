/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BrowserSearchEngineId,
	buildSearchUrl,
	getBrowserSearchEngineLabel,
	resolveAddressBarInputType,
} from '../../common/browserSearch.js';

suite('BrowserSearch - resolveAddressBarInput', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('recognized schemes are URLs', () => {
		const inputs = [
			'https://example.com',
			'http://example.com/path?q=1',
			'file:///etc/passwd',
			'about:blank',
			'data:text/html,<h1>hi</h1>',
			'view-source:https://example.com',
			'ftp://files.example.com',
			'vscode://settings',
			'HTTP://EXAMPLE.COM',
			'https://münchen.de/pfad?q=wert',
		];
		const actual = inputs.map((i) => resolveAddressBarInputType(i));
		assert.deepStrictEqual(actual, inputs.map(() => 'url'));
	});

	test('scheme-less hosts and IPs are URLs', () => {
		const inputs = [
			'example.com',
			'sub.example.com:8080/path',
			'example.com?q=1',
			'foo.bank',
			'acme.google',
			'foo.zzzznotatld',
			'127.0.0.1',
			'127.0.0.1:8080',
			'192.168.1.1/admin',
			'0.0.0.0',
			'0.0.0.0:8080',
			'[::]',
			'[::]:8080',
			'[::1]',
			'[::1]:8080',
			'[0:0:0:0:0:0:0:0]',
			'[0:0:0:0:0:0:0:1]',
			'[2001:db8::1]/path',
			'localhost',
			'localhost:3000',
			'localhost/foo',
			'localhost?q=1',
			'go/',
			'intranet/',
			'go/there/',
			'wiki/page/sub/',
			'/',
			'/usr/local/bin',
			'//example.com',
			'münchen.de',
			'xn--mnchen-3ya.de',
			'münchen.de:8080/pfad',
			'[::1]',
			'[2001:0db8::0001]',
			'foo.test',
			'foo.local',
			'foo.example',
			'foo.internal',
		];
		const actual = inputs.map((i) => resolveAddressBarInputType(i));
		assert.deepStrictEqual(actual, inputs.map(() => 'url'));
	});

	test('queries (whitespace or invalid host chars) return query', () => {
		const inputs = [
			'hello world',
			'what is 2+2',
			'  spaced  query  ',
			'a&b?c=d',
			'0.1.2.3',
			'[:::::::]',
			'foo bar/baz',
		];
		const actual = inputs.map((i) => resolveAddressBarInputType(i));
		assert.deepStrictEqual(actual, inputs.map(() => 'query'));
	});

	test('whitespace in the path/query/fragment is a URL (percent-encoded later)', () => {
		const inputs = [
			'http://localhost:8888/my file.php',
			'https://example.com/my file.php',
			'localhost:8888/my file.php',
			'example.com/foo bar',
			'example.com?q=hello world',
			'example.com/a#frag ment',
		];
		const actual = inputs.map((i) => resolveAddressBarInputType(i));
		assert.deepStrictEqual(actual, inputs.map(() => 'url'));
	});

	test('whitespace in the userinfo is unknown (defaults to search)', () => {
		const inputs = [
			'user name@example.com',
			'user name@example.com/',
			'user name@localhost',
		];
		const actual = inputs.map((i) => resolveAddressBarInputType(i));
		assert.deepStrictEqual(actual, inputs.map(() => 'unknown'));
	});

	test('an explicit http(s) scheme keeps whitespace-userinfo input a URL', () => {
		const inputs = [
			'http://user name@example.com',
			'https://user name@example.com',
		];
		const actual = inputs.map((i) => resolveAddressBarInputType(i));
		assert.deepStrictEqual(actual, inputs.map(() => 'url'));
	});

	test('whitespace in the userinfo with an IP-literal host is still a URL', () => {
		const inputs = [
			'user name@127.0.0.1',
			'user name@[::1]',
		];
		const actual = inputs.map((i) => resolveAddressBarInputType(i));
		assert.deepStrictEqual(actual, inputs.map(() => 'url'));
	});

	test('ambiguous inputs return unknown', () => {
		const inputs = [
			'cats',
			'intranet',
			'wiki/page',
			'c#',
			'日本語',
			'unknownscheme:foo',
			'foo.invalid',
		];
		const actual = inputs.map((i) => resolveAddressBarInputType(i));
		assert.deepStrictEqual(actual, inputs.map(() => 'unknown'));
	});

	test('input is trimmed before classification', () => {
		assert.deepStrictEqual(
			[
				resolveAddressBarInputType('   example.com'),
				resolveAddressBarInputType('https://example.com   '),
				resolveAddressBarInputType('\tlocalhost:3000\n'),
			],
			['url', 'url', 'url'],
		);
	});

	test('empty / whitespace input returns empty', () => {
		assert.deepStrictEqual(
			[
				resolveAddressBarInputType(''),
				resolveAddressBarInputType('   '),
				resolveAddressBarInputType('\t\n'),
			],
			['empty', 'empty', 'empty'],
		);
	});

	test('unknown scheme that looks like user:password@host is a URL', () => {
		assert.strictEqual(
			resolveAddressBarInputType('user:pass@example.com'),
			'url',
		);
	});

	test('javascript: with non-code body is unknown', () => {
		assert.strictEqual(
			resolveAddressBarInputType('javascript:hello'),
			'unknown',
		);
		assert.strictEqual(
			resolveAddressBarInputType('javascript:alert(1)'),
			'url',
		);
	});
});

suite('BrowserSearch - buildSearchUrl', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('encodes queries for each engine', () => {
		const query = 'hello world';
		const actual = [
			BrowserSearchEngineId.Bing,
			BrowserSearchEngineId.Yahoo,
			BrowserSearchEngineId.Google,
			BrowserSearchEngineId.DuckDuckGo,
		].map((engine) => buildSearchUrl(query, engine));
		assert.deepStrictEqual(actual, [
			'https://www.bing.com/search?q=hello+world',
			'https://search.yahoo.com/search?p=hello+world',
			'https://www.google.com/search?q=hello+world',
			'https://duckduckgo.com/?q=hello+world',
		]);
	});

	test('trims and collapses internal whitespace', () => {
		assert.strictEqual(
			buildSearchUrl('  spaced  query  ', BrowserSearchEngineId.Bing),
			'https://www.bing.com/search?q=spaced+query',
		);
	});

	test('encodes special characters', () => {
		assert.deepStrictEqual(
			[
				buildSearchUrl('wiki/page', BrowserSearchEngineId.Bing),
				buildSearchUrl('what is 2+2', BrowserSearchEngineId.Bing),
				buildSearchUrl('c#', BrowserSearchEngineId.Bing),
				buildSearchUrl('日本語', BrowserSearchEngineId.Bing),
				buildSearchUrl('a&b?c=d', BrowserSearchEngineId.Bing),
				buildSearchUrl('unknownscheme:foo', BrowserSearchEngineId.Bing),
			],
			[
				'https://www.bing.com/search?q=wiki%2Fpage',
				'https://www.bing.com/search?q=what+is+2%2B2',
				'https://www.bing.com/search?q=c%23',
				'https://www.bing.com/search?q=%E6%97%A5%E6%9C%AC%E8%AA%9E',
				'https://www.bing.com/search?q=a%26b%3Fc%3Dd',
				'https://www.bing.com/search?q=unknownscheme%3Afoo',
			],
		);
	});

	test('unknown engine id falls back to default (Bing)', () => {
		assert.strictEqual(
			buildSearchUrl('cats', 'nonexistent' as BrowserSearchEngineId),
			'https://www.bing.com/search?q=cats',
		);
	});
});

suite('BrowserSearch - getBrowserSearchEngineLabel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns the engine label, falling back to default for unknown ids', () => {
		assert.deepStrictEqual(
			[
				getBrowserSearchEngineLabel(BrowserSearchEngineId.Bing),
				getBrowserSearchEngineLabel(BrowserSearchEngineId.Google),
				getBrowserSearchEngineLabel(BrowserSearchEngineId.DuckDuckGo),
				getBrowserSearchEngineLabel('nonexistent' as BrowserSearchEngineId),
			],
			['Bing', 'Google', 'DuckDuckGo', 'Bing'],
		);
	});
});

