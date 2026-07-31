/**
 * Dardcor Code - KeyCode Enum & Virtual Keys (Task 79)
 * Mirrors: vs/base/common/keyCodes.ts (keybinding representation)
 */

export const enum KeyMod {
	CtrlCmd = (1 << 11) >>> 0,
	Shift = (1 << 10) >>> 0,
	Alt = (1 << 9) >>> 0,
	WinCtrl = (1 << 8) >>> 0,
}

export enum KeyCode {
	Unknown = 0,
	Backspace = 1,
	Tab = 2,
	Enter = 3,
	Escape = 9,
	Space = 10,
	PageUp = 11,
	PageDown = 12,
	End = 13,
	Home = 14,
	LeftArrow = 15,
	UpArrow = 16,
	RightArrow = 17,
	DownArrow = 18,
	Insert = 19,
	Delete = 20,
	KeyA = 31,
	KeyZ = 56,
}


export interface IKeybinding {
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly keyCode: number;
}

export class SimpleKeybinding implements IKeybinding {
	public readonly ctrlKey: boolean;
	public readonly shiftKey: boolean;
	public readonly altKey: boolean;
	public readonly metaKey: boolean;
	public readonly keyCode: number;

	constructor(ctrlKey: boolean, shiftKey: boolean, altKey: boolean, metaKey: boolean, keyCode: number) {
		this.ctrlKey = ctrlKey;
		this.shiftKey = shiftKey;
		this.altKey = altKey;
		this.metaKey = metaKey;
		this.keyCode = keyCode;
	}

	equals(other: SimpleKeybinding): boolean {
		return (
			this.ctrlKey === other.ctrlKey &&
			this.shiftKey === other.shiftKey &&
			this.altKey === other.altKey &&
			this.metaKey === other.metaKey &&
			this.keyCode === other.keyCode
		);
	}

	toString(): string {
		const parts: string[] = [];
		if (this.ctrlKey) parts.push('Ctrl');
		if (this.shiftKey) parts.push('Shift');
		if (this.altKey) parts.push('Alt');
		if (this.metaKey) parts.push('Meta');
		parts.push(String(this.keyCode));
		return parts.join('+');
	}

	toKeybindingLabel(isMac: boolean): string {
		const parts: string[] = [];
		if (isMac) {
			if (this.metaKey) parts.push('⌘');
			if (this.ctrlKey) parts.push('⌃');
			if (this.altKey) parts.push('⌥');
			if (this.shiftKey) parts.push('⇧');
		} else {
			if (this.ctrlKey) parts.push('Ctrl');
			if (this.shiftKey) parts.push('Shift');
			if (this.altKey) parts.push('Alt');
			if (this.metaKey) parts.push('Win');
		}
		parts.push(keyCodeToString(this.keyCode));
		return parts.join(isMac ? '' : '+');
	}
}

export class ChordKeybinding {
	public readonly parts: SimpleKeybinding[];

	constructor(...parts: SimpleKeybinding[]) {
		this.parts = parts;
	}

	equals(other: ChordKeybinding): boolean {
		if (this.parts.length !== other.parts.length) return false;
		for (let i = 0; i < this.parts.length; i++) {
			if (!this.parts[i].equals(other.parts[i])) return false;
		}
		return true;
	}
}

function keyCodeToString(keyCode: number): string {
	if (keyCode >= 31 && keyCode <= 56) {
		return String.fromCharCode(65 + keyCode - 31); // A-Z
	}
	if (keyCode >= 21 && keyCode <= 30) {
		return String(keyCode - 21); // 0-9
	}
	const special: Record<number, string> = {
		1: 'Backspace', 2: 'Tab', 3: 'Enter', 9: 'Escape', 10: 'Space',
		11: 'PageUp', 12: 'PageDown', 13: 'End', 14: 'Home',
		15: '←', 16: '↑', 17: '→', 18: '↓',
		19: 'Insert', 20: 'Delete',
	};
	if (keyCode >= 59 && keyCode <= 70) {
		return `F${keyCode - 58}`;
	}
	return special[keyCode] || `Key${keyCode}`;
}
