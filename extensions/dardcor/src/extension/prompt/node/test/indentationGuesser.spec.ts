/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { transformIndentation } from '../indentationGuesser';

describe('identationGuesser', () => {
	it('transformIndentation', () => {
		expect(transformIndentation('  hello()', { insertSpaces: true, tabSize: 2 }, { insertSpaces: false, tabSize: 2 })).toBe('\thello()');

		expect(transformIndentation('    hello()', { insertSpaces: true, tabSize: 4 }, { insertSpaces: true, tabSize: 2 })).toBe('  hello()');
		expect(transformIndentation('\thello()', { insertSpaces: false, tabSize: 4 }, { insertSpaces: true, tabSize: 4 })).toBe('    hello()');
		expect(transformIndentation('        hello()', { insertSpaces: true, tabSize: 4 }, { insertSpaces: false, tabSize: 4 })).toBe('\t\thello()');
		expect(transformIndentation('\t\thello()', { insertSpaces: false, tabSize: 2 }, { insertSpaces: true, tabSize: 4 })).toBe('        hello()');
		expect(transformIndentation('hello()', { insertSpaces: true, tabSize: 2 }, { insertSpaces: true, tabSize: 2 })).toBe('hello()');
		expect(transformIndentation(' \thello()', { insertSpaces: false, tabSize: 4 }, { insertSpaces: true, tabSize: 2 })).toBe(' \thello()');
	});
});
