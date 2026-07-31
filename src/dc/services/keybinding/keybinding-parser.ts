/**
 * Dardcor Code - Keybinding Parser (Task 160)
 * Mirrors: vs/platform/keybinding/common/keybindingParser.ts
 */

import { KeyCode } from '../../core/types/keycodes.js';

export interface IParsedKeyCombo {
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	keyCode: KeyCode;
}

export function parseKeybinding(keybinding: string): IParsedKeyCombo {
	const parts = keybinding.toLowerCase().replace(/\s+/g, '').split('+');
	let ctrlKey = false;
	let shiftKey = false;
	let altKey = false;
	let metaKey = false;
	let keyPart = '';

	for (const part of parts) {
		if (part === 'ctrl' || part === 'control') ctrlKey = true;
		else if (part === 'shift') shiftKey = true;
		else if (part === 'alt' || part === 'option') altKey = true;
		else if (part === 'cmd' || part === 'meta' || part === 'win' || part === 'command') metaKey = true;
		else keyPart = part;
	}

	return {
		ctrlKey,
		shiftKey,
		altKey,
		metaKey,
		keyCode: parseKeyPart(keyPart),
	};
}

function parseKeyPart(part: string): KeyCode {
	if (part === 'enter') return KeyCode.Enter;
	if (part === 'escape' || part === 'esc') return KeyCode.Escape;
	if (part === 'space') return KeyCode.Space;
	if (part === 'tab') return KeyCode.Tab;
	if (part === 'backspace') return KeyCode.Backspace;
	if (part === 'delete') return KeyCode.Delete;
	if (part === 'up') return KeyCode.UpArrow;
	if (part === 'down') return KeyCode.DownArrow;
	if (part === 'left') return KeyCode.LeftArrow;
	if (part === 'right') return KeyCode.RightArrow;
	if (part.length === 1 && part >= 'a' && part <= 'z') {
		return (KeyCode.KeyA + (part.charCodeAt(0) - 97)) as KeyCode;
	}
	return KeyCode.Unknown;
}
