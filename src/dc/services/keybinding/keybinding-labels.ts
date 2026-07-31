/**
 * Dardcor Code - Platform Keybinding Labels (Cmd vs Ctrl) (Task 118)
 */

import { isMacintosh } from '../../core/environment/platform.js';
import { ChordKeybinding, IKeybinding, SimpleKeybinding } from '../../core/types/keycodes.js';

const SPECIAL_KEY_NAMES: Record<number, string> = {
	1: 'Backspace',
	2: 'Tab',
	3: 'Enter',
	9: 'Escape',
	10: 'Space',
	11: 'PageUp',
	12: 'PageDown',
	13: 'End',
	14: 'Home',
	15: 'Left Arrow',
	16: 'Up Arrow',
	17: 'Right Arrow',
	18: 'Down Arrow',
	19: 'Insert',
	20: 'Delete',
	21: '0',
	22: '1',
	23: '2',
	24: '3',
	25: '4',
	26: '5',
	27: '6',
	28: '7',
	29: '8',
	30: '9'
};

export function keyCodeToLabel(keyCode: number): string {
	if (keyCode >= 31 && keyCode <= 56) {
		return String.fromCharCode(65 + keyCode - 31); // A-Z
	}
	if (keyCode >= 59 && keyCode <= 82) {
		return `F${keyCode - 58}`;
	}
	return SPECIAL_KEY_NAMES[keyCode] || `Key(${keyCode})`;
}

export function getModifierLabels(isMac: boolean = isMacintosh): {
	readonly ctrl: string;
	readonly shift: string;
	readonly alt: string;
	readonly meta: string;
	readonly separator: string;
} {
	if (isMac) {
		return { ctrl: '⌃', shift: '⇧', alt: '⌥', meta: '⌘', separator: '' };
	}
	return { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Win', separator: '+' };
}

export function prettyPrintKeybindingPart(part: IKeybinding | SimpleKeybinding, isMac: boolean = isMacintosh): string {
	const labels = getModifierLabels(isMac);
	const parts: string[] = [];
	if (part.metaKey) parts.push(labels.meta);
	if (part.ctrlKey) parts.push(labels.ctrl);
	if (part.altKey) parts.push(labels.alt);
	if (part.shiftKey) parts.push(labels.shift);
	parts.push(keyCodeToLabel(part.keyCode));
	return parts.join(labels.separator);
}

export function prettyPrintKeybinding(keybinding: ChordKeybinding | undefined | null, isMac: boolean = isMacintosh): string {
	if (!keybinding || keybinding.parts.length === 0) {
		return '';
	}
	return keybinding.parts.map((part) => prettyPrintKeybindingPart(part, isMac)).join(isMac ? ', ' : ' ');
}

export function prettyPrintKeybindingSimple(ctrlKey: boolean, shiftKey: boolean, altKey: boolean, metaKey: boolean, keyCode: number, isMac: boolean = isMacintosh): string {
	return prettyPrintKeybindingPart({ ctrlKey, shiftKey, altKey, metaKey, keyCode }, isMac);
}

export function formatKeybindingForDisplay(keybinding: ChordKeybinding | undefined): string {
	return prettyPrintKeybinding(keybinding, isMacintosh);
}
