/**
 * Dardcor Code - DOM Element Helper Utilities
 */

export function $<T extends HTMLElement>(tag: string, className?: string, text?: string): T {
	const el = document.createElement(tag) as T;
	if (className) {
		el.className = className;
	}
	if (text) {
		el.textContent = text;
	}
	return el;
}

export function clearNode(node: HTMLElement): void {
	while (node.firstChild) {
		node.removeChild(node.firstChild);
	}
}

export function addDisposableListener(target: EventTarget, type: string, listener: (e: any) => void, options?: boolean | AddEventListenerOptions): { dispose(): void } {
	target.addEventListener(type, listener as EventListener, options);

	return {
		dispose() {
			target.removeEventListener(type, listener as EventListener, options);
		}
	};
}

