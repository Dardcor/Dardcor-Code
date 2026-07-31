import { Disposable } from '../../common/lifecycle.js';
import * as dom from '../dom.js';

export abstract class Widget extends Disposable {
	protected onkeyup(element: HTMLElement, listener: (e: any) => void): void {
		this._register(dom.addDisposableListener(element, dom.EventType.KEY_UP, listener));
	}

	protected onkeydown(element: HTMLElement, listener: (e: any) => void): void {
		this._register(dom.addDisposableListener(element, dom.EventType.KEY_DOWN, listener));
	}

	protected oninput(element: HTMLElement, listener: (e: any) => void): void {
		this._register(dom.addDisposableListener(element, dom.EventType.INPUT, listener));
	}

	protected onmousedown(element: HTMLElement, listener: (e: any) => void): void {
		this._register(dom.addDisposableListener(element, dom.EventType.MOUSE_DOWN, listener));
	}

	protected onclick(element: HTMLElement, listener: (e: any) => void): void {
		this._register(dom.addDisposableListener(element, dom.EventType.CLICK, listener));
	}

	protected onfocus(element: HTMLElement, listener: (e: any) => void): void {
		this._register(dom.addDisposableListener(element, dom.EventType.FOCUS, listener));
	}

	protected onblur(element: HTMLElement, listener: (e: any) => void): void {
		this._register(dom.addDisposableListener(element, dom.EventType.BLUR, listener));
	}
}
