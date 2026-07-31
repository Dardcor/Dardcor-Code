/**
 * Dardcor Code - Dynamic CSS Injector
 */

import { IDisposable } from '../lifecycle/disposable.js';

class CssInjectorImpl {
	private _styleElement: HTMLStyleElement | null = null;
	private _rules = new Map<string, string>();

	private _getStyleElement(): HTMLStyleElement {
		if (!this._styleElement) {
			this._styleElement = document.createElement('style');
			this._styleElement.id = 'dc-dynamic-styles';
			document.head.appendChild(this._styleElement);
		}
		return this._styleElement;
	}

	public inject(id: string, cssText: string): IDisposable {
		this._rules.set(id, cssText);
		this._update();
		return {
			dispose: () => {
				this._rules.delete(id);
				this._update();
			}
		};
	}

	private _update(): void {
		const el = this._getStyleElement();
		el.textContent = Array.from(this._rules.values()).join('\n');
	}
}

export const CssInjector = new CssInjectorImpl();
