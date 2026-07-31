export interface IMouseEvent {
	readonly browserEvent: MouseEvent;
	readonly target: HTMLElement;
	readonly posx: number;
	readonly posy: number;
	readonly buttons: number;
	preventDefault(): void;
	stopPropagation(): void;
}

export class StandardMouseEvent implements IMouseEvent {
	public readonly browserEvent: MouseEvent;
	public readonly target: HTMLElement;
	public readonly posx: number;
	public readonly posy: number;
	public readonly buttons: number;

	constructor(e: MouseEvent) {
		this.browserEvent = e;
		this.target = (e.target || e.srcElement) as HTMLElement;
		this.posx = e.pageX;
		this.posy = e.pageY;
		this.buttons = e.buttons;
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

export class StandardWheelEvent {
	constructor(public readonly browserEvent: WheelEvent) {}
}
