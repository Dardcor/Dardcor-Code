/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { OperatingSystem } from '../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createUSLayoutResolvedKeybinding } from './keybindingsTestUtils.js';

suite('KeybindingLabels', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function assertUSLabel(OS: OperatingSystem, keybinding: number, expected: string): void {
		const usResolvedKeybinding = createUSLayoutResolvedKeybinding(keybinding, OS)!;
		assert.strictEqual(usResolvedKeybinding.getLabel(), expected);
	}

	test('Windows US label', () => {
		assertUSLabel(OperatingSystem.Windows, KeyCode.KeyA, 'A');

		assertUSLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyCode.KeyA, 'Ctrl+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.Shift | KeyCode.KeyA, 'Shift+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.Alt | KeyCode.KeyA, 'Alt+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.WinCtrl | KeyCode.KeyA, 'Windows+A');

		assertUSLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA, 'Ctrl+Shift+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyA, 'Ctrl+Alt+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Windows+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.Shift | KeyMod.Alt | KeyCode.KeyA, 'Shift+Alt+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.Shift | KeyMod.WinCtrl | KeyCode.KeyA, 'Shift+Windows+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Alt+Windows+A');

		assertUSLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.KeyA, 'Ctrl+Shift+Alt+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Shift+Windows+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Alt+Windows+A');
		assertUSLabel(OperatingSystem.Windows, KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Shift+Alt+Windows+A');

		assertUSLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Shift+Alt+Windows+A');

		assertUSLabel(OperatingSystem.Windows, KeyChord(KeyMod.CtrlCmd | KeyCode.KeyA, KeyMod.CtrlCmd | KeyCode.KeyB), 'Ctrl+A Ctrl+B');
	});

	test('Linux US label', () => {
		assertUSLabel(OperatingSystem.Linux, KeyCode.KeyA, 'A');

		assertUSLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyCode.KeyA, 'Ctrl+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.Shift | KeyCode.KeyA, 'Shift+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.Alt | KeyCode.KeyA, 'Alt+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.WinCtrl | KeyCode.KeyA, 'Super+A');

		assertUSLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA, 'Ctrl+Shift+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyA, 'Ctrl+Alt+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Super+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.Shift | KeyMod.Alt | KeyCode.KeyA, 'Shift+Alt+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.Shift | KeyMod.WinCtrl | KeyCode.KeyA, 'Shift+Super+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Alt+Super+A');

		assertUSLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.KeyA, 'Ctrl+Shift+Alt+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Shift+Super+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Alt+Super+A');
		assertUSLabel(OperatingSystem.Linux, KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Shift+Alt+Super+A');

		assertUSLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Shift+Alt+Super+A');

		assertUSLabel(OperatingSystem.Linux, KeyChord(KeyMod.CtrlCmd | KeyCode.KeyA, KeyMod.CtrlCmd | KeyCode.KeyB), 'Ctrl+A Ctrl+B');
	});

	test('Mac US label', () => {
		assertUSLabel(OperatingSystem.Macintosh, KeyCode.KeyA, 'A');

		assertUSLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyCode.KeyA, '⌘A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.Shift | KeyCode.KeyA, '⇧A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.Alt | KeyCode.KeyA, '⌥A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.WinCtrl | KeyCode.KeyA, '⌃A');

		assertUSLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA, '⇧⌘A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyA, '⌥⌘A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KeyA, '⌃⌘A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.Shift | KeyMod.Alt | KeyCode.KeyA, '⇧⌥A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.Shift | KeyMod.WinCtrl | KeyCode.KeyA, '⌃⇧A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, '⌃⌥A');

		assertUSLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.KeyA, '⇧⌥⌘A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.WinCtrl | KeyCode.KeyA, '⌃⇧⌘A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, '⌃⌥⌘A');
		assertUSLabel(OperatingSystem.Macintosh, KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, '⌃⇧⌥A');

		assertUSLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, '⌃⇧⌥⌘A');

		assertUSLabel(OperatingSystem.Macintosh, KeyChord(KeyMod.CtrlCmd | KeyCode.KeyA, KeyMod.CtrlCmd | KeyCode.KeyB), '⌘A ⌘B');

		assertUSLabel(OperatingSystem.Macintosh, KeyCode.LeftArrow, '←');
		assertUSLabel(OperatingSystem.Macintosh, KeyCode.UpArrow, '↑');
		assertUSLabel(OperatingSystem.Macintosh, KeyCode.RightArrow, '→');
		assertUSLabel(OperatingSystem.Macintosh, KeyCode.DownArrow, '↓');
	});

	test('Aria label', () => {
		function assertAriaLabel(OS: OperatingSystem, keybinding: number, expected: string): void {
			const usResolvedKeybinding = createUSLayoutResolvedKeybinding(keybinding, OS)!;
			assert.strictEqual(usResolvedKeybinding.getAriaLabel(), expected);
		}

		assertAriaLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Control+Shift+Alt+Windows+A');
		assertAriaLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Control+Shift+Alt+Super+A');
		assertAriaLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Control+Shift+Option+Command+A');
	});

	test('Electron Accelerator label', () => {
		function assertElectronAcceleratorLabel(OS: OperatingSystem, keybinding: number, expected: string | null): void {
			const usResolvedKeybinding = createUSLayoutResolvedKeybinding(keybinding, OS)!;
			assert.strictEqual(usResolvedKeybinding.getElectronAccelerator(), expected);
		}

		assertElectronAcceleratorLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Shift+Alt+Super+A');
		assertElectronAcceleratorLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Shift+Alt+Super+A');
		assertElectronAcceleratorLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'Ctrl+Shift+Alt+Cmd+A');

		assertElectronAcceleratorLabel(OperatingSystem.Windows, KeyChord(KeyMod.CtrlCmd | KeyCode.KeyA, KeyMod.CtrlCmd | KeyCode.KeyB), null);
		assertElectronAcceleratorLabel(OperatingSystem.Linux, KeyChord(KeyMod.CtrlCmd | KeyCode.KeyA, KeyMod.CtrlCmd | KeyCode.KeyB), null);
		assertElectronAcceleratorLabel(OperatingSystem.Macintosh, KeyChord(KeyMod.CtrlCmd | KeyCode.KeyA, KeyMod.CtrlCmd | KeyCode.KeyB), null);

		assertElectronAcceleratorLabel(OperatingSystem.Windows, KeyCode.Numpad1, null);
		assertElectronAcceleratorLabel(OperatingSystem.Linux, KeyCode.Numpad1, null);
		assertElectronAcceleratorLabel(OperatingSystem.Macintosh, KeyCode.Numpad1, null);

		assertElectronAcceleratorLabel(OperatingSystem.Macintosh, KeyCode.LeftArrow, 'Left');
		assertElectronAcceleratorLabel(OperatingSystem.Macintosh, KeyCode.UpArrow, 'Up');
		assertElectronAcceleratorLabel(OperatingSystem.Macintosh, KeyCode.RightArrow, 'Right');
		assertElectronAcceleratorLabel(OperatingSystem.Macintosh, KeyCode.DownArrow, 'Down');
	});

	test('User Settings label', () => {
		function assertElectronAcceleratorLabel(OS: OperatingSystem, keybinding: number, expected: string): void {
			const usResolvedKeybinding = createUSLayoutResolvedKeybinding(keybinding, OS)!;
			assert.strictEqual(usResolvedKeybinding.getUserSettingsLabel(), expected);
		}

		assertElectronAcceleratorLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'ctrl+shift+alt+win+a');
		assertElectronAcceleratorLabel(OperatingSystem.Linux, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'ctrl+shift+alt+meta+a');
		assertElectronAcceleratorLabel(OperatingSystem.Macintosh, KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KeyA, 'ctrl+shift+alt+cmd+a');

		assertElectronAcceleratorLabel(OperatingSystem.Windows, KeyChord(KeyMod.CtrlCmd | KeyCode.KeyA, KeyMod.CtrlCmd | KeyCode.KeyB), 'ctrl+a ctrl+b');
		assertElectronAcceleratorLabel(OperatingSystem.Linux, KeyChord(KeyMod.CtrlCmd | KeyCode.KeyA, KeyMod.CtrlCmd | KeyCode.KeyB), 'ctrl+a ctrl+b');
		assertElectronAcceleratorLabel(OperatingSystem.Macintosh, KeyChord(KeyMod.CtrlCmd | KeyCode.KeyA, KeyMod.CtrlCmd | KeyCode.KeyB), 'cmd+a cmd+b');
	});

	test('issue #91235: Do not end with a +', () => {
		assertUSLabel(OperatingSystem.Windows, KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Alt, 'Ctrl+Alt');
	});
});
