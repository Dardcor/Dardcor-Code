/**
 * Dardcor Code - Top Centered Quick-Search Button Inside Window Titlebar
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $ } from '../../../core/dom/element.js';

export interface ICommandCenterOptions {
	readonly placeholder?: string;
	readonly icon?: string;
	readonly keybindingLabel?: string;
	readonly visible?: boolean;
}

export class CommandCenter extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _button: HTMLElement;
	private readonly _iconEl: HTMLElement;
	private readonly _labelEl: HTMLElement;
	private readonly _keyEl: HTMLElement;
	private _placeholder: string;
	private _visible: boolean;

	private readonly _onDidOpen = this._register(new Emitter<void>());
	readonly onDidOpen: Event<void> = this._onDidOpen.event;

	constructor(
		parent: HTMLElement,
		options: ICommandCenterOptions = {}
	) {
		super();
		this._placeholder = options.placeholder ?? 'Search...';
		this._visible = options.visible ?? true;

		this._container = $<HTMLElement>('div', 'dc-command-center');
		this._container.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;height:100%;min-width:0;';

		this._button = $<HTMLElement>('div', 'dc-command-center-button');
		this._button.style.cssText = 'display:flex;align-items:center;gap:8px;height:24px;padding:0 14px;border-radius:12px;background:#2d2d2d;border:1px solid #3c3c3c;color:#bbbbbb;font-size:11px;font-family:Segoe UI, sans-serif;cursor:pointer;user-select:none;max-width:520px;overflow:hidden;';
		this._button.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			this._onDidOpen.fire();
		});
		this._button.addEventListener('mouseenter', () => {
			this._button.style.borderColor = '#4a4a4a';
		});
		this._button.addEventListener('mouseleave', () => {
			this._button.style.borderColor = '#3c3c3c';
		});

		this._iconEl = $<HTMLElement>('span', 'dc-command-center-icon');
		this._iconEl.textContent = options.icon ?? '\u2318';
		this._iconEl.style.cssText = 'font-size:13px;flex-shrink:0;color:#858585;';

		this._labelEl = $<HTMLElement>('span', 'dc-command-center-label');
		this._labelEl.textContent = this._placeholder;
		this._labelEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;';

		this._keyEl = $<HTMLElement>('span', 'dc-command-center-key');
		this._keyEl.textContent = options.keybindingLabel ?? '';
		this._keyEl.style.cssText = 'flex-shrink:0;color:#6a6a6a;font-size:10px;border:1px solid #3c3c3c;border-radius:3px;padding:1px 5px;background:#252526;';

		this._button.appendChild(this._iconEl);
		this._button.appendChild(this._labelEl);
		this._button.appendChild(this._keyEl);
		this._container.appendChild(this._button);
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	get button(): HTMLElement {
		return this._button;
	}

	get isVisible(): boolean {
		return this._visible;
	}

	setPlaceholder(placeholder: string): void {
		this._placeholder = placeholder;
		this._labelEl.textContent = placeholder;
	}

	setKeybindingLabel(label: string): void {
		this._keyEl.textContent = label;
	}

	setVisible(visible: boolean): void {
		if (this._visible === visible) {
			return;
		}
		this._visible = visible;
		this._container.style.display = visible ? 'flex' : 'none';
	}

	focus(): void {
		this._button.focus();
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
