/**
 * Dardcor Code - Shadow DOM Helper (Task 65)
 * Mirrors: vs/base/browser/dom.ts shadow utilities
 */

export function createShadowRoot(host: HTMLElement, mode: ShadowRootMode = 'open'): ShadowRoot {
	return host.attachShadow({ mode });
}

export function getShadowRoot(node: Node): ShadowRoot | null {
	let current: Node | null = node;
	while (current) {
		if (current instanceof ShadowRoot) {
			return current;
		}
		current = current.parentNode;
	}
	return null;
}

export function isInShadowDOM(node: Node): boolean {
	return getShadowRoot(node) !== null;
}

export function getActiveElement(): Element | null {
	let result = document.activeElement;
	while (result?.shadowRoot?.activeElement) {
		result = result.shadowRoot.activeElement;
	}
	return result;
}

export function isActiveElement(element: Element): boolean {
	return getActiveElement() === element;
}

export function createStyleSheet(container: ShadowRoot | HTMLElement = document.head, cssText?: string): HTMLStyleElement {
	const style = document.createElement('style');
	if (cssText) {
		style.textContent = cssText;
	}
	container.appendChild(style);
	return style;
}

export function injectGlobalStylesheet(cssText: string): HTMLStyleElement {
	return createStyleSheet(document.head, cssText);
}
