/**
 * Dardcor Code - Panel Fullscreen Expansion View State
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { addDisposableListener } from '../../../core/dom/element';

export interface IPanelMaximizedOptions {
	readonly offsetTop?: number;
	readonly escapeToExit?: boolean;
	readonly zIndex?: number;
}

export class PanelMaximized extends Disposable {
	private _maximized = false;
	private _savedCssText = '';
	private readonly _offsetTop: number;
	private readonly _zIndex: number;

	private readonly _onDidChangeMaximized = this._register(new Emitter<boolean>());
	readonly onDidChangeMaximized: Event<boolean> = this._onDidChangeMaximized.event;

	constructor(
		private readonly _panelElement: HTMLElement,
		options: IPanelMaximizedOptions = {}
	) {
		super();
		this._offsetTop = options.offsetTop ?? 32;
		this._zIndex = options.zIndex ?? 500;
		if (options.escapeToExit !== false) {
			this._register(addDisposableListener(document, 'keydown', (e: globalThis.Event) => {
				const keyEvent = e as KeyboardEvent;
				if (keyEvent.key === 'Escape' && this._maximized) {
					keyEvent.preventDefault();
					this.setMaximized(false);
				}
			}));
		}
	}

	get isMaximized(): boolean {
		return this._maximized;
	}

	setMaximized(maximized: boolean): void {
		if (this._maximized === maximized) {
			return;
		}
		this._maximized = maximized;
		if (maximized) {
			this._savedCssText = this._panelElement.style.cssText;
			this._panelElement.style.cssText = `position:fixed;left:0;right:0;bottom:0;top:${this._offsetTop}px;width:auto;height:auto;z-index:${this._zIndex};background:#1e1e1e;display:flex;flex-direction:column;overflow:hidden;`;
		} else {
			this._panelElement.style.cssText = this._savedCssText;
			this._savedCssText = '';
		}
		this._onDidChangeMaximized.fire(maximized);
	}

	toggle(): void {
		this.setMaximized(!this._maximized);
	}

	dispose(): void {
		if (this._maximized) {
			this.setMaximized(false);
		}
		super.dispose();
	}
}
