import { Disposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';

export interface IHoverPosition {
	readonly x: number;
	readonly y: number;
}

export interface IHoverContent {
	readonly content: HTMLElement | string;
	readonly position: IHoverPosition;
}

export class HoverController extends Disposable {
	private _hoverDom: HTMLElement | null = null;
	private _visible = false;
	private _timer: ReturnType<typeof setTimeout> | null = null;
	private _delay: number;
	private readonly _contentBuffer: IHoverContent[] = [];

	private readonly _onDidChangeHover = this._register(new Emitter<boolean>());
	readonly onDidChangeHover: Event<boolean> = this._onDidChangeHover.event;

	constructor(
		private readonly _target: HTMLElement,
		delay: number = 300
	) {
		super();
		this._delay = Math.max(0, delay);
		this._register(toDisposable(() => this._clearTimer()));
		this._register(addDisposableListener(this._target, 'mouseleave', () => this.hideHover()));
		this._register(addDisposableListener(window, 'scroll', () => this.hideHover(), true));
		this._register(addDisposableListener(window, 'resize', () => this.hideHover(), true));
	}

	public showHover(content: HTMLElement | string, position: IHoverPosition): void {
		this._clearTimer();
		this._contentBuffer.push({ content, position });
		this._timer = setTimeout(() => {
			const pending = this._contentBuffer.shift();
			this._timer = null;
			if (pending) {
				this._doShow(pending.content, pending.position);
			}
		}, this._delay);
	}

	public hideHover(): void {
		this._clearTimer();
		this._contentBuffer.length = 0;
		if (!this._visible && !this._hoverDom) {
			return;
		}
		if (this._hoverDom) {
			this._hoverDom.remove();
			this._hoverDom = null;
		}
		this._visible = false;
		this._onDidChangeHover.fire(false);
	}

	public isHoverVisible(): boolean {
		return this._visible;
	}

	public setDelay(delay: number): void {
		this._delay = Math.max(0, delay);
	}

	public getDelay(): number {
		return this._delay;
	}

	public getHoverDomNode(): HTMLElement | null {
		return this._hoverDom;
	}

	public showImmediately(content: HTMLElement | string, position: IHoverPosition): void {
		this._clearTimer();
		this._contentBuffer.length = 0;
		this._doShow(content, position);
	}

	public setContent(content: HTMLElement | string): void {
		if (this._hoverDom) {
			if (typeof content === 'string') {
				this._hoverDom.textContent = content;
			} else {
				this._hoverDom.textContent = '';
				this._hoverDom.appendChild(content);
			}
		}
	}

	public moveTo(position: IHoverPosition): void {
		if (this._hoverDom) {
			this._positionDom(this._hoverDom, position);
		}
	}

	override dispose(): void {
		this.hideHover();
		super.dispose();
	}

	private _doShow(content: HTMLElement | string, position: IHoverPosition): void {
		if (this._hoverDom) {
			this._hoverDom.remove();
		}
		const el = typeof content === 'string' ? $<HTMLElement>('div', 'dc-hover-content') : content;
		el.classList.add('dc-hover');
		el.style.cssText = 'position:fixed;z-index:10000;max-width:600px;max-height:400px;overflow:auto;background:#252526;color:#cccccc;border:1px solid #454545;border-radius:4px;padding:6px 8px;font-family:Consolas,monospace;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
		this._positionDom(el, position);
		document.body.appendChild(el);
		this._hoverDom = el;
		this._visible = true;
		this._onDidChangeHover.fire(true);
	}

	private _positionDom(el: HTMLElement, position: IHoverPosition): void {
		const offset = 12;
		let left = position.x + offset;
		let top = position.y + offset;
		const maxLeft = window.innerWidth - 640;
		const maxTop = window.innerHeight - 420;
		if (left > maxLeft) {
			left = Math.max(4, position.x - offset - 200);
		}
		if (top > maxTop) {
			top = Math.max(4, position.y - offset - 100);
		}
		el.style.left = `${Math.round(left)}px`;
		el.style.top = `${Math.round(top)}px`;
	}

	private _clearTimer(): void {
		if (this._timer !== null) {
			clearTimeout(this._timer);
			this._timer = null;
		}
	}
}
