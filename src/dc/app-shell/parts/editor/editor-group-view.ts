/**
 * Dardcor Code - DOM Element View For Single Editor Pane Group
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { $ } from '../../../core/dom/element.js';
import { EditorPane } from './editor-pane.js';

export class EditorGroupView extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _paneContainer: HTMLElement;
	private readonly _watermark: HTMLElement;
	private _pane: EditorPane | null = null;

	constructor(parent: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-editor-group-view');
		this._container.style.cssText = 'flex:1;position:relative;overflow:hidden;background:#1e1e1e;display:flex;flex-direction:column;';
		parent.appendChild(this._container);

		this._paneContainer = $<HTMLElement>('div', 'dc-editor-group-pane-container');
		this._paneContainer.style.cssText = 'flex:1;position:relative;overflow:hidden;';
		this._container.appendChild(this._paneContainer);

		this._watermark = $<HTMLElement>('div', 'dc-editor-watermark');
		this._watermark.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#6a6a6a;font-size:14px;user-select:none;font-family:Segoe UI, sans-serif;';
		const title = $<HTMLElement>('div');
		title.textContent = 'Dardcor Code';
		title.style.cssText = 'font-size:22px;font-weight:300;margin-bottom:12px;color:#444444;';
		const hint = $<HTMLElement>('div');
		hint.textContent = 'No editor open - press Ctrl+O to open a file';
		hint.style.cssText = 'font-size:12px;';
		this._watermark.appendChild(title);
		this._watermark.appendChild(hint);
		this._paneContainer.appendChild(this._watermark);
	}

	get element(): HTMLElement {
		return this._container;
	}

	get paneContainer(): HTMLElement {
		return this._paneContainer;
	}

	get pane(): EditorPane | null {
		return this._pane;
	}

	attachPane(pane: EditorPane): void {
		if (this._pane === pane) {
			this.showWatermark(false);
			return;
		}
		this._paneContainer.textContent = '';
		this._paneContainer.appendChild(pane.getContainer());
		this._pane = pane;
		this.showWatermark(false);
	}

	clearPane(): void {
		if (!this._pane) {
			return;
		}
		this._paneContainer.textContent = '';
		this._pane = null;
		this.showWatermark(true);
	}

	showWatermark(show: boolean): void {
		this._watermark.style.display = show ? 'block' : 'none';
	}

	focus(): void {
		this._pane?.focus();
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
