/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { StringEdit, StringReplacement } from '../../../../util/dardcor/editor/common/core/edits/stringEdit';
import { OffsetRange } from '../../../../util/dardcor/editor/common/core/ranges/offsetRange';
import { PositionOffsetTransformer } from '../../../../util/dardcor/editor/common/core/text/positionToOffset';
import { getCurrentLine, isModelLineCompatible } from '../../node/cursorLineDivergence';


describe('isModelCursorLineCompatible', () => {


	describe('user typed text that the model also predicted', () => {

		it('user typed one char that starts the model completion', () => {
			expect(isModelLineCompatible(
				'function fi',
				'function fib',
				'function fibonacci(n: number): number',
			)).toBe(true);
		});

		it('user typed several chars that the model also predicted', () => {
			expect(isModelLineCompatible(
				'const x',
				'const x = 4',
				'const x = 42;',
			)).toBe(true);
		});

		it('user typed the exact text the model produced', () => {
			expect(isModelLineCompatible(
				'return',
				'return 0;',
				'return 0;',
			)).toBe(true);
		});
	});

	describe('user typed text that diverges from the model', () => {

		it('user typed a different character', () => {
			expect(isModelLineCompatible(
				'function fi',
				'function fix',
				'function fibonacci(n: number): number',
			)).toBe(false);
		});

		it('user typed a completely different word', () => {
			expect(isModelLineCompatible(
				'const ',
				'const bar',
				'const foo = 1;',
			)).toBe(false);
		});

		it('user typed text that appears later but not at the right position', () => {
			expect(isModelLineCompatible(
				'ab',
				'abz',
				'abcz',
			)).toBe(false);
		});
	});

	describe('user typed in the middle of the line', () => {

		it('user inserted text at cursor mid-line, model also inserts at same spot', () => {
			expect(isModelLineCompatible(
				'foo()',
				'foo(x)',
				'foo(x, y)',
			)).toBe(true);
		});

		it('user inserted text mid-line, model changed something else', () => {
			expect(isModelLineCompatible(
				'foo()',
				'foo(x)',
				'bar(a, b)',
			)).toBe(false);
		});
	});

	describe('model did not change the cursor line', () => {

		it('user typed but model kept cursor line identical — incompatible', () => {
			expect(isModelLineCompatible(
				'const x = 1;',
				'const x = 12;',
				'const x = 1;',
			)).toBe(false);
		});
	});

	describe('edge cases', () => {

		it('empty original line, user typed, model also added text', () => {
			expect(isModelLineCompatible(
				'',
				'f',
				'function foo() {',
			)).toBe(true);
		});

		it('empty original line, user typed char not in model text', () => {
			expect(isModelLineCompatible(
				'',
				'z',
				'let x = 1;',
			)).toBe(false);
		});

		it('user deleted text from the cursor line', () => {
			expect(isModelLineCompatible(
				'foobar',
				'foo',
				'foobaz',
			)).toBe(false);
		});

		it('user replaced text at cursor, model has same replacement', () => {
			expect(isModelLineCompatible(
				'hello world',
				'hello earth',
				'hello earth!',
			)).toBe(true);
		});

		it('all three lines identical — trivially compatible', () => {
			expect(isModelLineCompatible(
				'no change',
				'no change',
				'no change',
			)).toBe(true);
		});

		it('user typed t continuing class name, model adds braces', () => {
			expect(isModelLineCompatible(
				'class Poin',
				'class Point',
				'class Point {',
			)).toBe(true);
		});
	});


	describe('auto-close pairs', () => {

		it('user typed ( which auto-closed to () — model fills parens', () => {
			expect(isModelLineCompatible(
				'foo',
				'foo()',
				'foo(x, y)',
			)).toBe(true);
		});

		it('user typed { which auto-closed to {} — model fills braces', () => {
			expect(isModelLineCompatible(
				'if (x) ',
				'if (x) {}',
				'if (x) { return 1; }',
			)).toBe(true);
		});

		it('user typed [ which auto-closed to []', () => {
			expect(isModelLineCompatible(
				'arr',
				'arr[]',
				'arr[0]',
			)).toBe(true);
		});

		it('user typed " which auto-closed to "" — model fills string', () => {
			expect(isModelLineCompatible(
				'const s = ',
				'const s = ""',
				'const s = "hello"',
			)).toBe(true);
		});

		it('auto-close pair but model has no closing char — incompatible', () => {
			expect(isModelLineCompatible(
				'foo',
				'foo()',
				'foo(x, y',
			)).toBe(false);
		});
	});

	describe('known limitations — non-overlapping edits on the same line', () => {

		it('user appended ; at end, model changed identifier at start (FALSE POSITIVE: cancels)', () => {
			expect(isModelLineCompatible(
				'const x = foo()',
				'const x = foo();',
				'const y = foo()',
			)).toBe(false);
		});
	});

	describe('prefix match and coincidental matches', () => {

		it('user typed char that starts model text — compatible', () => {
			expect(isModelLineCompatible(
				'let ',
				'let a',
				'let apple = 1;',
			)).toBe(true);
		});

		it('user typed char that does NOT start model text — cancel', () => {
			expect(isModelLineCompatible(
				'let ',
				'let a',
				'let banana = 1;',
			)).toBe(false);
		});

		it('user typed text that does not start model text — cancel', () => {
			expect(isModelLineCompatible(
				'x',
				'xy',
				'x01234567890y',
			)).toBe(false);
		});

		it('user typed text at non-zero offset — cancel', () => {
			expect(isModelLineCompatible(
				'prefix',
				'prefixABCDEF',
				'prefix_ABCDEF_suffix',
			)).toBe(false);
		});

		it('user typed text at position 0 — compatible', () => {
			expect(isModelLineCompatible(
				'prefix',
				'prefixABCDEF',
				'prefixABCDEF_and_more',
			)).toBe(true);
		});
	});

	describe('user deleted text', () => {

		it('user deleted suffix, model replaced same suffix differently', () => {
			expect(isModelLineCompatible(
				'foobar',
				'foo',
				'foobaz',
			)).toBe(false);
		});

		it('user deleted text, model predicted the same deletion', () => {
			expect(isModelLineCompatible(
				'console.log(x);',
				'x);',
				'x);',
			)).toBe(true);
		});
	});

	describe('whitespace edits', () => {

		it('user added indentation, model suggests code at different indent — compatible (short text)', () => {
			expect(isModelLineCompatible(
				'return 1;',
				'  return 1;',
				'    return value;',
			)).toBe(true);
		});

		it('user added indentation, model has same indentation and more changes', () => {
			expect(isModelLineCompatible(
				'return 1;',
				'  return 1;',
				'  return 42;',
			)).toBe(true);
		});
	});

	describe('repeated characters and prefix/suffix ambiguity', () => {

		it('repeated chars at divergence point', () => {
			expect(isModelLineCompatible(
				'aaa',
				'aaab',
				'aaac',
			)).toBe(false);
		});

		it('repeated chars — user typed same char as existing', () => {
			expect(isModelLineCompatible(
				'aaa',
				'aaaa',
				'aaaab',
			)).toBe(true);
		});
	});

	describe('model output edge cases', () => {

		it('model produces empty line, user typed text', () => {
			expect(isModelLineCompatible(
				'foo',
				'foob',
				'',
			)).toBe(false);
		});

		it('model produces shorter line than original, user typed at end', () => {
			expect(isModelLineCompatible(
				'const x = 1;',
				'const x = 1;!',
				'const x;',
			)).toBe(false);
		});
	});


	describe('case sensitivity', () => {

		it('user typed uppercase, model starts with lowercase — cancel', () => {
			expect(isModelLineCompatible(
				'let ',
				'let F',
				'let function() {}',
			)).toBe(false);
		});

		it('user typed lowercase matching model lowercase — compatible', () => {
			expect(isModelLineCompatible(
				'let ',
				'let f',
				'let function() {}',
			)).toBe(true);
		});
	});


	describe('unicode and multi-byte characters', () => {

		it('user typed emoji, model produced ASCII — cancel', () => {
			expect(isModelLineCompatible(
				'const x = ',
				'const x = 🎉',
				'const x = 42;',
			)).toBe(false);
		});

		it('user typed emoji matching model — compatible', () => {
			expect(isModelLineCompatible(
				'const x = ',
				'const x = 🎉',
				'const x = 🎉🎊',
			)).toBe(true);
		});

		it('user typed CJK character, model produced different CJK — cancel', () => {
			expect(isModelLineCompatible(
				'const s = "',
				'const s = "你',
				'const s = "世界"',
			)).toBe(false);
		});
	});


	describe('replacement edge cases', () => {

		it('user replaced text with shorter string, model replaced same region with compatible text', () => {
			expect(isModelLineCompatible(
				'abcdef',
				'abxef',
				'abxyzef',
			)).toBe(true);
		});

		it('user replaced text with shorter string, model replaced same region differently — cancel', () => {
			expect(isModelLineCompatible(
				'abcdef',
				'abxef',
				'abYZef',
			)).toBe(false);
		});

		it('user replaced text with empty string (pure deletion), model replaced same region — cancel', () => {
			expect(isModelLineCompatible(
				'abcdef',
				'abef',
				'abXYef',
			)).toBe(false);
		});

		it('user replaced text, model replaced different region — cancel', () => {
			expect(isModelLineCompatible(
				'hello world',
				'hi world',
				'hello earth',
			)).toBe(false);
		});
	});


	describe('auto-close pair: angle brackets', () => {

		it('user typed < auto-closed to <>, model has <Component> — compatible', () => {
			expect(isModelLineCompatible(
				'div',
				'div<>',
				'div<Component>',
			)).toBe(true);
		});

		it('user typed < auto-closed to <>, model has no > — cancel', () => {
			expect(isModelLineCompatible(
				'div',
				'div<>',
				'div<Component',
			)).toBe(false);
		});
	});


	describe('non-auto-close pair text', () => {

		it('user typed (x) which is not an auto-close pair — cancel if model differs', () => {
			expect(isModelLineCompatible(
				'foo',
				'foo(x)',
				'foo(a, b)',
			)).toBe(false);
		});

		it('user typed (x) and model starts with (x — cancel because ) vs , diverges', () => {
			expect(isModelLineCompatible(
				'foo',
				'foo(x)',
				'foo(x, y)',
			)).toBe(false);
		});
	});


	describe('model produced less than user typed', () => {

		it('user typed more chars than model predicted — cancel', () => {
			expect(isModelLineCompatible(
				'let ',
				'let abc',
				'let ab',
			)).toBe(false);
		});
	});


	describe('identical changes', () => {

		it('user and model both inserted the same text — compatible', () => {
			expect(isModelLineCompatible(
				'foo',
				'foobar',
				'foobar',
			)).toBe(true);
		});

		it('user and model both replaced the same region identically — compatible', () => {
			expect(isModelLineCompatible(
				'aXa',
				'aYa',
				'aYa',
			)).toBe(true);
		});
	});


	describe('net-zero edits', () => {

		it('user backspaced and retyped same char — no change, trivially compatible', () => {
			expect(isModelLineCompatible(
				'hello',
				'hello',
				'completely different',
			)).toBe(true);
		});
	});


	describe('user typed substring (not prefix) of model text', () => {

		it('user typed middle portion of model insertion — cancel', () => {
			expect(isModelLineCompatible(
				'x',
				'xbc',
				'xabcd',
			)).toBe(false);
		});

		it('user typed suffix portion of model insertion — cancel', () => {
			expect(isModelLineCompatible(
				'x',
				'xcd',
				'xabcd',
			)).toBe(false);
		});
	});


	describe('whitespace edit outside model edit range', () => {

		it('user added trailing space, model changed identifier — cancel', () => {
			expect(isModelLineCompatible(
				'const x = 1;',
				'const x = 1; ',
				'const y = 1;',
			)).toBe(false);
		});
	});


	describe('user deletion matching model deletion', () => {

		it('user deleted text, model deleted exact same text — compatible', () => {
			expect(isModelLineCompatible(
				'foobar',
				'foo',
				'foo',
			)).toBe(true);
		});
	});
});


describe('getCurrentCursorLine', () => {

	function t(doc: string): PositionOffsetTransformer {
		return new PositionOffsetTransformer(doc);
	}

	function insertAt(offset: number, text: string): StringEdit {
		return StringEdit.single(new StringReplacement(OffsetRange.emptyAt(offset), text));
	}

	function deleteAt(offset: number, length: number): StringEdit {
		return StringEdit.single(new StringReplacement(new OffsetRange(offset, offset + length), ''));
	}

	describe('no line-shifting edits', () => {

		it('returns the cursor line when the edit only modifies the cursor line', () => {
			const doc = 'aaa\nbbb\nccc';
			const edit = insertAt(4, 'X');

			expect(getCurrentLine(t(doc), 1, edit)).toBe('Xbbb');
		});

		it('returns the unmodified cursor line when the edit is empty', () => {
			const doc = 'aaa\nbbb\nccc';

			expect(getCurrentLine(t(doc), 1, StringEdit.empty)).toBe('bbb');
		});
	});

	describe('line inserted above cursor', () => {

		it('returns the correct cursor line after a newline is inserted above', () => {
			const doc = 'aaa\nbbb\nccc';
			const edit = insertAt(3, '\nNEW');

			expect(getCurrentLine(t(doc), 2, edit)).toBe('ccc');
		});

		it('handles multiple lines inserted above the cursor', () => {
			const doc = 'L0\nL1\nL2';
			const edit = insertAt(2, '\nA\nB');

			expect(getCurrentLine(t(doc), 2, edit)).toBe('L2');
		});
	});

	describe('line deleted above cursor', () => {

		it('returns the correct cursor line after a line above is deleted', () => {
			const doc = 'aaa\nbbb\nccc\nddd';
			const edit = deleteAt(4, 4);

			expect(getCurrentLine(t(doc), 3, edit)).toBe('ddd');
		});
	});

	describe('edit on a line below cursor', () => {

		it('does not affect the cursor line', () => {
			const doc = 'aaa\nbbb\nccc';
			const edit = StringEdit.single(new StringReplacement(new OffsetRange(8, 11), 'CCC'));

			expect(getCurrentLine(t(doc), 0, edit)).toBe('aaa');
		});
	});

	describe('edge cases', () => {

		it('cursor on the first line', () => {
			const doc = 'hello\nworld';
			const edit = insertAt(0, 'XY');

			expect(getCurrentLine(t(doc), 0, edit)).toBe('XYhello');
		});

		it('cursor on the last line', () => {
			const doc = 'aaa\nbbb';
			const edit = insertAt(3, '\nNEW');

			expect(getCurrentLine(t(doc), 1, edit)).toBe('bbb');
		});

		it('returns undefined for out-of-bounds line index', () => {
			const doc = 'aaa\nbbb';

			expect(getCurrentLine(t(doc), 5, StringEdit.empty)).toBeUndefined();
		});

		it('returns undefined when cursor line start is inside a replacement', () => {
			const doc = 'aaa\nbbb\nccc';
			const edit = StringEdit.single(new StringReplacement(new OffsetRange(2, 6), 'Z'));

			expect(getCurrentLine(t(doc), 1, edit)).toBeUndefined();
		});

		it('single-line document, cursor on line 0', () => {
			const doc = 'hello';
			const edit = insertAt(5, ' world');

			expect(getCurrentLine(t(doc), 0, edit)).toBe('hello world');
		});
	});


	describe('compound edits: line shift + cursor line modification', () => {

		it('handles new line inserted above AND cursor line modified', () => {
			const doc = 'aaa\nbbb\nccc';
			const edit = StringEdit.create([
				new StringReplacement(OffsetRange.emptyAt(3), '\nNEW'),
				new StringReplacement(OffsetRange.emptyAt(4), 'X'),
			]);

			expect(getCurrentLine(t(doc), 1, edit)).toBe('Xbbb');
		});

		it('handles line deleted above AND cursor line modified', () => {
			const doc = 'aaa\nbbb\nccc\nddd';
			const edit = StringEdit.create([
				new StringReplacement(new OffsetRange(4, 8), ''),
				new StringReplacement(OffsetRange.emptyAt(12), 'Z'),
			]);

			expect(getCurrentLine(t(doc), 3, edit)).toBe('Zddd');
		});
	});


	describe('cursor line replaced with multiple lines', () => {

		it('returns first replacement line when cursor line start coincides with replacement start', () => {
			const doc = 'aaa\nbbb\nccc';
			const edit = StringEdit.single(
				new StringReplacement(new OffsetRange(4, 7), 'X\nY\nZ')
			);

			expect(getCurrentLine(t(doc), 1, edit)).toBe('X');
		});
	});


	describe('empty document', () => {

		it('empty single-line document, cursor on line 0, user types', () => {
			const doc = '';
			const edit = insertAt(0, 'hello');

			expect(getCurrentLine(t(doc), 0, edit)).toBe('hello');
		});
	});


	describe('edit at document end', () => {

		it('cursor on last line, text appended after it', () => {
			const doc = 'aaa\nbbb';
			const edit = insertAt(7, 'XYZ');

			expect(getCurrentLine(t(doc), 1, edit)).toBe('bbbXYZ');
		});

		it('cursor on last line, new line appended after it', () => {
			const doc = 'aaa\nbbb';
			const edit = insertAt(7, '\nccc');

			expect(getCurrentLine(t(doc), 1, edit)).toBe('bbb');
		});
	});
});
