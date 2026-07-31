/**
 * Dardcor Code - Panel Hide/Close Action Button Element
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';
import { PanelPart } from './panel-part';

export interface IPanelCloseOptions {
	readonly icon?: string;
	readonly title?: string;
	readonly visible?: boolean;
	readonly hoverColor?: string;
}

export class PanelCloseButton extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _icon: string;
	private readonly _title: string;
	private readonly _hoverColor: string;
	private readonly _panelPart: PanelPart | null;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	constructor(
		parent: HTMLElement,
		options: IPanelCloseOptions = {},
		panelPart: PanelPart | null = null
	) {
		super();
		this._panelPart = panelPart;
		this._icon = options.icon ?? '\u2715';
		this._title = options.title ?? 'Close Panel';
		this._hoverColor = options.hoverColor ?? '#e81123';

		this._container = $<HTMLElement>('span', 'dc-panel-close');
		this._container.textContent = this._icon;
		this._container.title = this._title;
		this._container.style.cssText = 'cursor:pointer;color:#858585;font-size:11px;padding:3px 6px;border-radius:3px;user-select:none;';
		this._container.addEventListener('mouseenter', () => {
			this._container.style.background = this._hoverColor;
			this._container.style.color = '#ffffff';
		});
		this._container.addEventListener('mouseleave', () => {
			this._container.style.background = 'transparent';
			this._container.style.color = '#858585';
		});
		this._container.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			this.close();
		});

		if (options.visible === false) {
			this.setVisible(false);
		}
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	get isVisible(): boolean {
		return this._container.style.display !== 'none';
	}

	setVisible(visible: boolean): void {
		this._container.style.display = visible ? 'inline-block' : 'none';
	}

	close(): void {
		this._panelPart?.hidePanel();
		this._onDidClose.fire();
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
