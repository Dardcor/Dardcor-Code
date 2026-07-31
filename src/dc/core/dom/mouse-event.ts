/**
 * Dardcor Code - Mouse Event Standardizer (Task 62)
 * Mirrors: vs/base/browser/mouseEvent.ts
 */

export interface IStandardMouseEvent {
	readonly browserEvent: MouseEvent;
	readonly leftButton: boolean;
	readonly middleButton: boolean;
	readonly rightButton: boolean;
	readonly buttons: number;
	readonly posx: number;
	readonly posy: number;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly target: HTMLElement;
	preventDefault(): void;
	stopPropagation(): void;
}

export class StandardMouseEvent implements IStandardMouseEvent {
	public readonly browserEvent: MouseEvent;
	public readonly leftButton: boolean;
	public readonly middleButton: boolean;
	public readonly rightButton: boolean;
	public readonly buttons: number;
	public readonly posx: number;
	public readonly posy: number;
	public readonly ctrlKey: boolean;
	public readonly shiftKey: boolean;
	public readonly altKey: boolean;
	public readonly metaKey: boolean;
	public readonly target: HTMLElement;

	constructor(e: MouseEvent) {
		this.browserEvent = e;
		this.leftButton = e.button === 0;
		this.middleButton = e.button === 1;
		this.rightButton = e.button === 2;
		this.buttons = e.buttons;
		this.posx = e.pageX;
		this.posy = e.pageY;
		this.ctrlKey = e.ctrlKey;
		this.shiftKey = e.shiftKey;
		this.altKey = e.altKey;
		this.metaKey = e.metaKey;
		this.target = e.target as HTMLElement || document.body;
	}

	public preventDefault(): void {
		this.browserEvent.preventDefault();
	}

	public stopPropagation(): void {
		this.browserEvent.stopPropagation();
	}
}

export class StandardWheelEvent {
	public readonly browserEvent: WheelEvent;
	public readonly deltaY: number;
	public readonly deltaX: number;
	public readonly target: HTMLElement;

	constructor(e: WheelEvent) {
		this.browserEvent = e;
		this.target = e.target as HTMLElement || document.body;
		this.deltaY = e.deltaY;
		this.deltaX = e.deltaX;
	}

	public preventDefault(): void {
		this.browserEvent.preventDefault();
	}

	public stopPropagation(): void {
		this.browserEvent.stopPropagation();
	}
}
