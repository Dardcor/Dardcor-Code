/**
 * Dardcor Code - Keyboard Event Mapper (Task 63)
 * Mirrors: vs/base/browser/keyboardEvent.ts + vs/base/common/keyCodes.ts
 */

export const enum KeyCode {
	Unknown = 0,
	Backspace = 1,
	Tab = 2,
	Enter = 3,
	Shift = 4,
	Ctrl = 5,
	Alt = 6,
	PauseBreak = 7,
	CapsLock = 8,
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
	Digit0 = 21,
	Digit1 = 22,
	Digit2 = 23,
	Digit3 = 24,
	Digit4 = 25,
	Digit5 = 26,
	Digit6 = 27,
	Digit7 = 28,
	Digit8 = 29,
	Digit9 = 30,
	KeyA = 31,
	KeyB = 32,
	KeyC = 33,
	KeyD = 34,
	KeyE = 35,
	KeyF = 36,
	KeyG = 37,
	KeyH = 38,
	KeyI = 39,
	KeyJ = 40,
	KeyK = 41,
	KeyL = 42,
	KeyM = 43,
	KeyN = 44,
	KeyO = 45,
	KeyP = 46,
	KeyQ = 47,
	KeyR = 48,
	KeyS = 49,
	KeyT = 50,
	KeyU = 51,
	KeyV = 52,
	KeyW = 53,
	KeyX = 54,
	KeyY = 55,
	KeyZ = 56,
	Meta = 57,
	ContextMenu = 58,
	F1 = 59,
	F2 = 60,
	F3 = 61,
	F4 = 62,
	F5 = 63,
	F6 = 64,
	F7 = 65,
	F8 = 66,
	F9 = 67,
	F10 = 68,
	F11 = 69,
	F12 = 70,
	NumLock = 71,
	ScrollLock = 72,
	Semicolon = 73,
	Equal = 74,
	Comma = 75,
	Minus = 76,
	Period = 77,
	Slash = 78,
	Backquote = 79,
	BracketLeft = 80,
	Backslash = 81,
	BracketRight = 82,
	Quote = 83,
	MAX_VALUE = 84,
}

const EVENT_KEY_CODE_MAP: { [code: string]: KeyCode } = {
	'Backspace': KeyCode.Backspace,
	'Tab': KeyCode.Tab,
	'Enter': KeyCode.Enter,
	'ShiftLeft': KeyCode.Shift, 'ShiftRight': KeyCode.Shift,
	'ControlLeft': KeyCode.Ctrl, 'ControlRight': KeyCode.Ctrl,
	'AltLeft': KeyCode.Alt, 'AltRight': KeyCode.Alt,
	'Pause': KeyCode.PauseBreak,
	'CapsLock': KeyCode.CapsLock,
	'Escape': KeyCode.Escape,
	'Space': KeyCode.Space,
	'PageUp': KeyCode.PageUp,
	'PageDown': KeyCode.PageDown,
	'End': KeyCode.End,
	'Home': KeyCode.Home,
	'ArrowLeft': KeyCode.LeftArrow,
	'ArrowUp': KeyCode.UpArrow,
	'ArrowRight': KeyCode.RightArrow,
	'ArrowDown': KeyCode.DownArrow,
	'Insert': KeyCode.Insert,
	'Delete': KeyCode.Delete,
	'Digit0': KeyCode.Digit0, 'Digit1': KeyCode.Digit1, 'Digit2': KeyCode.Digit2,
	'Digit3': KeyCode.Digit3, 'Digit4': KeyCode.Digit4, 'Digit5': KeyCode.Digit5,
	'Digit6': KeyCode.Digit6, 'Digit7': KeyCode.Digit7, 'Digit8': KeyCode.Digit8,
	'Digit9': KeyCode.Digit9,
	'KeyA': KeyCode.KeyA, 'KeyB': KeyCode.KeyB, 'KeyC': KeyCode.KeyC,
	'KeyD': KeyCode.KeyD, 'KeyE': KeyCode.KeyE, 'KeyF': KeyCode.KeyF,
	'KeyG': KeyCode.KeyG, 'KeyH': KeyCode.KeyH, 'KeyI': KeyCode.KeyI,
	'KeyJ': KeyCode.KeyJ, 'KeyK': KeyCode.KeyK, 'KeyL': KeyCode.KeyL,
	'KeyM': KeyCode.KeyM, 'KeyN': KeyCode.KeyN, 'KeyO': KeyCode.KeyO,
	'KeyP': KeyCode.KeyP, 'KeyQ': KeyCode.KeyQ, 'KeyR': KeyCode.KeyR,
	'KeyS': KeyCode.KeyS, 'KeyT': KeyCode.KeyT, 'KeyU': KeyCode.KeyU,
	'KeyV': KeyCode.KeyV, 'KeyW': KeyCode.KeyW, 'KeyX': KeyCode.KeyX,
	'KeyY': KeyCode.KeyY, 'KeyZ': KeyCode.KeyZ,
	'MetaLeft': KeyCode.Meta, 'MetaRight': KeyCode.Meta,
	'ContextMenu': KeyCode.ContextMenu,
	'F1': KeyCode.F1, 'F2': KeyCode.F2, 'F3': KeyCode.F3, 'F4': KeyCode.F4,
	'F5': KeyCode.F5, 'F6': KeyCode.F6, 'F7': KeyCode.F7, 'F8': KeyCode.F8,
	'F9': KeyCode.F9, 'F10': KeyCode.F10, 'F11': KeyCode.F11, 'F12': KeyCode.F12,
	'NumLock': KeyCode.NumLock,
	'ScrollLock': KeyCode.ScrollLock,
	'Semicolon': KeyCode.Semicolon,
	'Equal': KeyCode.Equal,
	'Comma': KeyCode.Comma,
	'Minus': KeyCode.Minus,
	'Period': KeyCode.Period,
	'Slash': KeyCode.Slash,
	'Backquote': KeyCode.Backquote,
	'BracketLeft': KeyCode.BracketLeft,
	'Backslash': KeyCode.Backslash,
	'BracketRight': KeyCode.BracketRight,
	'Quote': KeyCode.Quote,
};

export interface IStandardKeyboardEvent {
	readonly browserEvent: KeyboardEvent;
	readonly target: HTMLElement;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly keyCode: KeyCode;
	readonly code: string;
	preventDefault(): void;
	stopPropagation(): void;
}

export class StandardKeyboardEvent implements IStandardKeyboardEvent {
	public readonly browserEvent: KeyboardEvent;
	public readonly target: HTMLElement;
	public readonly ctrlKey: boolean;
	public readonly shiftKey: boolean;
	public readonly altKey: boolean;
	public readonly metaKey: boolean;
	public readonly keyCode: KeyCode;
	public readonly code: string;

	constructor(e: KeyboardEvent) {
		this.browserEvent = e;
		this.target = e.target as HTMLElement;
		this.ctrlKey = e.ctrlKey;
		this.shiftKey = e.shiftKey;
		this.altKey = e.altKey;
		this.metaKey = e.metaKey;
		this.code = e.code;
		this.keyCode = EVENT_KEY_CODE_MAP[e.code] ?? KeyCode.Unknown;
	}

	public preventDefault(): void {
		this.browserEvent.preventDefault();
	}

	public stopPropagation(): void {
		this.browserEvent.stopPropagation();
	}
}
