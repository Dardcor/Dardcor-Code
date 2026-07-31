import { IDisposable, toDisposable } from '../common/lifecycle.js';

export const EventType = {
	CLICK: 'click',
	DBLCLICK: 'dblclick',
	MOUSE_DOWN: 'mousedown',
	MOUSE_UP: 'mouseup',
	MOUSE_OVER: 'mouseover',
	MOUSE_OUT: 'mouseout',
	MOUSE_MOVE: 'mousemove',
	KEY_DOWN: 'keydown',
	KEY_UP: 'keyup',
	KEY_PRESS: 'keypress',
	CONTEXT_MENU: 'contextmenu',
	FOCUS: 'focus',
	BLUR: 'blur',
	INPUT: 'input',
	CHANGE: 'change',
	SUBMIT: 'submit',
	RESIZE: 'resize',
	SCROLL: 'scroll',
	LOAD: 'load',
	UNLOAD: 'unload',
	DRAG_START: 'dragstart',
	DRAG: 'drag',
	DRAG_ENTER: 'dragenter',
	DRAG_OVER: 'dragover',
	DRAG_LEAVE: 'dragleave',
	DROP: 'drop',
	DRAG_END: 'dragend',
} as const;

export class EventHelper {
	public static stop(e: Event, stopImmediatePropagation?: boolean): void {
		if (e.stopPropagation) {
			e.stopPropagation();
		}
		if (stopImmediatePropagation && e.stopImmediatePropagation) {
			e.stopImmediatePropagation();
		}
		if (e.preventDefault) {
			e.preventDefault();
		}
	}
}

export function addDisposableListener(target: EventTarget, type: string, listener: (e: any) => void, useCapture?: boolean): IDisposable {
	target.addEventListener(type, listener, useCapture);
	return toDisposable(() => target.removeEventListener(type, listener, useCapture));
}

export function addStandardDisposableListener(target: EventTarget, type: string, listener: (e: any) => void, useCapture?: boolean): IDisposable {
	return addDisposableListener(target, type, listener, useCapture);
}

export function clearNode(node: HTMLElement): void {
	while (node.firstChild) {
		node.removeChild(node.firstChild);
	}
}

export function hide(...elements: HTMLElement[]): void {
	for (const element of elements) {
		if (element) {
			element.style.display = 'none';
		}
	}
}

export function show(...elements: HTMLElement[]): void {
	for (const element of elements) {
		if (element) {
			element.style.display = '';
		}
	}
}

export function isActiveElement(element: HTMLElement): boolean {
	return element?.ownerDocument?.activeElement === element;
}

export function isAncestor(possibleAncestor: Node | null, possibleDescendant: Node | null): boolean {
	while (possibleDescendant) {
		if (possibleDescendant === possibleAncestor) {
			return true;
		}
		possibleDescendant = possibleDescendant.parentNode;
	}
	return false;
}

export function isMouseEvent(e: Event): e is MouseEvent {
	return e instanceof MouseEvent;
}

export function h(tag: string, attrs?: Record<string, any>, ...children: (Node | string)[]): HTMLElement {
	const el = document.createElement(tag);
	if (attrs) {
		for (const key of Object.keys(attrs)) {
			if (key === 'className') {
				el.className = attrs[key];
			} else {
				el.setAttribute(key, attrs[key]);
			}
		}
	}
	for (const child of children) {
		if (typeof child === 'string') {
			el.appendChild(document.createTextNode(child));
		} else if (child) {
			el.appendChild(child);
		}
	}
	return el;
}

export function append<T extends Node>(parent: HTMLElement, ...children: (T | string)[]): T {
	for (const child of children) {
		if (typeof child === 'string') {
			parent.appendChild(document.createTextNode(child));
		} else {
			parent.appendChild(child);
		}
	}
	return children[0] as T;
}

export function $(tag: string, attrs?: Record<string, any>, ...children: (Node | string)[]): HTMLElement {
	return h(tag, attrs, ...children);
}

export function getWindow(node?: Node | null): Window {
	return node?.ownerDocument?.defaultView ?? window;
}

export function getDocument(node?: Node | null): Document {
	return node?.ownerDocument ?? document;
}
