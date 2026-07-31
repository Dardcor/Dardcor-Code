/**
 * Dardcor Code - Empty State Editor Background Keyboard Shortcuts Guide
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';

export interface IWatermarkHint {
	readonly id: string;
	readonly keybinding: string;
	readonly label: string;
	readonly commandId?: string;
}

export interface IWatermarkOptions {
	readonly title?: string;
	readonly subtitle?: string;
	readonly hints?: IWatermarkHint[];
}

const DEFAULT_HINTS: IWatermarkHint[] = [
	{ id: 'openFile', keybinding: 'Ctrl+O', label: 'Open File' },
	{ id: 'commandPalette', keybinding: 'Ctrl+Shift+P', label: 'Show All Commands' },
	{ id: 'explorer', keybinding: 'Ctrl+Shift+E', label: 'Show Explorer' },
	{ id: 'search', keybinding: 'Ctrl+Shift+F', label: 'Search In Files' },
	{ id: 'togglePanel', keybinding: 'Ctrl+J', label: 'Toggle Panel' },
	{ id: 'toggleSidebar', keybinding: 'Ctrl+B', label: 'Toggle Side Bar' },
];

export class EditorWatermark extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _titleEl: HTMLElement;
	private readonly _subtitleEl: HTMLElement;
	private readonly _hintsEl: HTMLElement;
	private _hints: IWatermarkHint[] = DEFAULT_HINTS;
	private _visible = true;

	private readonly _onDidSelectHint = this._register(new Emitter<IWatermarkHint>());
	readonly onDidSelectHint: Event<IWatermarkHint> = this._onDidSelectHint.event;

	constructor(
		parent: HTMLElement,
		options: IWatermarkOptions = {}
	) {
		super();
		this._container = $<HTMLElement>('div', 'dc-editor-watermark');
		this._container.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#6a6a6a;font-family:Segoe UI, sans-serif;user-select:none;pointer-events:auto;background:#1e1e1e;z-index:10;';

		this._titleEl = $<HTMLElement>('div', 'dc-editor-watermark-title');
		this._titleEl.style.cssText = 'font-size:24px;font-weight:300;margin-bottom:8px;color:#444444;';
		this._container.appendChild(this._titleEl);

		this._subtitleEl = $<HTMLElement>('div', 'dc-editor-watermark-subtitle');
		this._subtitleEl.style.cssText = 'font-size:12px;color:#6a6a6a;margin-bottom:28px;max-width:420px;line-height:1.5;';
		this._container.appendChild(this._subtitleEl);

		this._hintsEl = $<HTMLElement>('div', 'dc-editor-watermark-hints');
		this._hintsEl.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
		this._container.appendChild(this._hintsEl);

		parent.appendChild(this._container);

		this.setTitle(options.title ?? 'Dardcor Code');
		this.setSubtitle(options.subtitle ?? 'No editor open - press Ctrl+O to open a file');
		if (options.hints) {
			this.setHints(options.hints);
		}
		this.render();
	}

	get element(): HTMLElement {
		return this._container;
	}

	get isVisible(): boolean {
		return this._visible;
	}

	setTitle(title: string): void {
		this._titleEl.textContent = title;
	}

	setSubtitle(subtitle: string): void {
		this._subtitleEl.textContent = subtitle;
	}

	setHints(hints: IWatermarkHint[]): void {
		this._hints = hints;
		this.render();
	}

	addHint(hint: IWatermarkHint): void {
		this._hints = [...this._hints, hint];
		this.render();
	}

	show(): void {
		this._visible = true;
		this._container.style.display = 'flex';
	}

	hide(): void {
		this._visible = false;
		this._container.style.display = 'none';
	}

	render(): void {
		clearNode(this._hintsEl);
		for (const hint of this._hints) {
			const row = $<HTMLElement>('div', 'dc-editor-watermark-hint');
			row.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:12px;color:#6a6a6a;cursor:pointer;padding:3px 8px;border-radius:4px;';
			row.addEventListener('mouseenter', () => {
				row.style.background = '#2d2d2d';
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = 'transparent';
			});
			row.addEventListener('click', () => this._onDidSelectHint.fire(hint));

			const key = $<HTMLElement>('span', 'dc-editor-watermark-hint-key');
			key.textContent = hint.keybinding;
			key.style.cssText = 'min-width:110px;text-align:right;color:#cccccc;background:#2d2d2d;border:1px solid #3c3c3c;border-radius:4px;padding:2px 8px;font-size:11px;';

			const label = $<HTMLElement>('span', 'dc-editor-watermark-hint-label');
			label.textContent = hint.label;
			label.style.cssText = 'text-align:left;';

			row.appendChild(key);
			row.appendChild(label);
			this._hintsEl.appendChild(row);
		}
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
