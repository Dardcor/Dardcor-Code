/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { StandardKeyboardEvent } from '../../browser/keyboardEvent.js';
import { KeyCode, KeyMod } from '../../common/keyCodes.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

function keydown(init: KeyboardEventInit & { keyCode: number }): StandardKeyboardEvent {
	const event = new KeyboardEvent('keydown', init);
	Object.defineProperty(event, 'keyCode', { get: () => init.keyCode });
	return new StandardKeyboardEvent(event);
}

suite('StandardKeyboardEvent', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('reports the pressed key when no composition is in progress', () => {
		const event = keydown({ keyCode: 13, isComposing: false });
		assert.deepStrictEqual(
			[event.keyCode === KeyCode.Enter, event.equals(KeyCode.Enter)],
			[true, true]
		);
	});

	test('normalizes the key code to KEY_IN_COMPOSITION while composing', () => {
		const event = keydown({ keyCode: 13, isComposing: true });
		assert.deepStrictEqual(
			[event.keyCode === KeyCode.KEY_IN_COMPOSITION, event.equals(KeyCode.Enter)],
			[true, false]
		);
	});

	test('normalizes modified keybindings while composing too', () => {
		const event = keydown({ keyCode: 13, ctrlKey: true, isComposing: true });
		assert.strictEqual(event.equals(KeyMod.CtrlCmd | KeyCode.Enter), false);
	});

	test('keeps matching KEY_IN_COMPOSITION while composing', () => {
		for (const keyCode of [229, 13]) {
			const event = keydown({ keyCode, isComposing: true });
			assert.deepStrictEqual(
				[keyCode, event.equals(KeyCode.KEY_IN_COMPOSITION)],
				[keyCode, true]
			);
		}
	});

	test('resolves to a chord that matches no keybinding while composing', () => {
		const event = keydown({ keyCode: 13, isComposing: true });
		assert.strictEqual(event.toKeyCodeChord().keyCode, KeyCode.KEY_IN_COMPOSITION);
	});
});
