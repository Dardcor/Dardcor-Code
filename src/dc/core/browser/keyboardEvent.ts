import { KeyCode } from '../common/keyCodes';

export interface IKeyboardEvent {
	readonly browserEvent: KeyboardEvent;
	readonly target: HTMLElement;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly keyCode: KeyCode;
	readonly code: string;
	equals(keybinding: number): boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

export class StandardKeyboardEvent implements IKeyboardEvent {
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
		this.target = (e.target || e.srcElement) as HTMLElement;
		this.ctrlKey = e.ctrlKey;
		this.shiftKey = e.shiftKey;
		this.altKey = e.altKey;
		this.metaKey = e.metaKey;
		this.keyCode = e.keyCode as KeyCode;
		this.code = e.code;
	}

	public equals(keybinding: number): boolean {
		return this.keyCode === keybinding;
	}

	public preventDefault(): void {
		if (this.browserEvent.preventDefault) {
			this.browserEvent.preventDefault();
		}
	}

	public stopPropagation(): void {
		if (this.browserEvent.stopPropagation) {
			this.browserEvent.stopPropagation();
		}
	}
}
