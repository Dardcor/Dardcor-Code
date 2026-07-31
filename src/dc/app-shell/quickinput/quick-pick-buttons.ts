/**
 * Dardcor Code - Action Buttons Inside Quick Pick Item Entries
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $ } from '../../core/dom/element.js';
import { QuickPickItem } from './quick-pick-item.js';

export interface IQuickPickButton {
	readonly id: string;
	readonly icon: string;
	readonly title: string;
	readonly tooltip?: string;
	readonly alwaysVisible?: boolean;
}

export interface IQuickPickButtonEvent {
	readonly button: IQuickPickButton;
	readonly item: QuickPickItem;
}

export interface IQuickPickButtonsOptions {
	readonly buttons?: IQuickPickButton[];
	readonly showOnHover?: boolean;
}

export class QuickPickButtons extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _buttons: IQuickPickButton[];
	private readonly _showOnHover: boolean;
	private readonly _buttonElements = new Map<string, HTMLElement>();
	private _item: QuickPickItem | null = null;

	private readonly _onDidTriggerButton = this._register(new Emitter<IQuickPickButtonEvent>());
	readonly onDidTriggerButton: Event<IQuickPickButtonEvent> = this._onDidTriggerButton.event;

	constructor(
		parent: HTMLElement,
		options: IQuickPickButtonsOptions = {}
	) {
		super();
		this._buttons = options.buttons ?? [];
		this._showOnHover = options.showOnHover ?? true;

		this._container = $<HTMLElement>('div', 'dc-quick-pick-buttons');
		this._container.style.cssText = 'display:flex;align-items:center;gap:2px;flex-shrink:0;margin-left:auto;';
		if (this._showOnHover) {
			this._container.style.opacity = '0';
		}
		parent.appendChild(this._container);

		for (const button of this._buttons) {
			const btn = $<HTMLElement>('span', `dc-quick-pick-button dc-quick-pick-button-${button.id}`);
			btn.textContent = button.icon;
			btn.title = button.tooltip ?? button.title;
			btn.style.cssText = 'cursor:pointer;color:#cccccc;font-size:11px;padding:2px 5px;border-radius:3px;user-select:none;';
			btn.addEventListener('mouseenter', () => {
				btn.style.background = '#3c3c3c';
			});
			btn.addEventListener('mouseleave', () => {
				btn.style.background = 'transparent';
			});
			btn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
				if (this._item) {
					this._onDidTriggerButton.fire({ button, item: this._item });
				}
			});
			this._buttonElements.set(button.id, btn);
			this._container.appendChild(btn);
		}

		parent.addEventListener('mouseenter', () => {
			this._container.style.opacity = '1';
		});
		parent.addEventListener('mouseleave', () => {
			if (this._showOnHover) {
				this._container.style.opacity = '0';
			}
		});
	}

	get element(): HTMLElement {
		return this._container;
	}

	setItem(item: QuickPickItem): void {
		this._item = item;
	}

	setButtons(buttons: IQuickPickButton[]): void {
		for (const btn of this._buttonElements.values()) {
			btn.remove();
		}
		this._buttonElements.clear();
		this._buttons.length = 0;
		for (const button of buttons) {
			this._buttons.push(button);
			const btn = $<HTMLElement>('span', `dc-quick-pick-button dc-quick-pick-button-${button.id}`);
			btn.textContent = button.icon;
			btn.title = button.tooltip ?? button.title;
			btn.style.cssText = 'cursor:pointer;color:#cccccc;font-size:11px;padding:2px 5px;border-radius:3px;user-select:none;';
			btn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
				if (this._item) {
					this._onDidTriggerButton.fire({ button, item: this._item });
				}
			});
			this._buttonElements.set(button.id, btn);
			this._container.appendChild(btn);
		}
	}

	static attachItemButtons(row: HTMLElement, item: QuickPickItem, buttons: IQuickPickButton[]): QuickPickButtons {
		const instance = new QuickPickButtons(row, { buttons, showOnHover: true });
		instance.setItem(item);
		return instance;
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
