/**
 * Dardcor Code - Base Class For ActivityBar & Panel View Containers
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode } from '../../core/dom/element.js';

export interface ICompositePartStyles {
	readonly headerHeight?: number;
	readonly background?: string;
	readonly headerBackground?: string;
	readonly borderColor?: string;
}

export interface ICompositePartOptions<T extends IDisposable> {
	readonly title: string;
	readonly icon?: string;
	readonly styles?: ICompositePartStyles;
	readonly createView: (container: HTMLElement) => T;
	readonly showHeader?: boolean;
}

export abstract class CompositePart<T extends IDisposable = IDisposable> extends Disposable {
	protected readonly _element: HTMLElement;
	protected readonly _header: HTMLElement | null;
	protected readonly _titleLabel: HTMLElement | null;
	protected readonly _iconEl: HTMLElement | null;
	protected readonly _toolbar: HTMLElement | null;
	protected readonly _body: HTMLElement;
	protected _view: T | null = null;
	private readonly _styles: ICompositePartStyles;
	private _visible = true;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

	constructor(
		parent: HTMLElement,
		private readonly _options: ICompositePartOptions<T>
	) {
		super();
		this._styles = _options.styles ?? {};
		const headerHeight = this._styles.headerHeight ?? 35;

		this._element = $<HTMLElement>('div', 'dc-composite-part');
		this._element.style.cssText = `display:flex;flex-direction:column;overflow:hidden;background:${this._styles.background ?? '#1e1e1e'};`;

		if (_options.showHeader !== false) {
			this._header = $<HTMLElement>('div', 'dc-composite-part-header');
			this._header.style.cssText = `height:${headerHeight}px;background:${this._styles.headerBackground ?? '#252526'};display:flex;align-items:center;padding:0 10px;gap:6px;user-select:none;flex-shrink:0;border-bottom:1px solid ${this._styles.borderColor ?? '#1e1e1e'};`;

			this._iconEl = $<HTMLElement>('span', 'dc-composite-part-icon');
			this._iconEl.style.cssText = 'font-size:13px;display:none;';
			this._header.appendChild(this._iconEl);

			this._titleLabel = $<HTMLElement>('span', 'dc-composite-part-title');
			this._titleLabel.style.cssText = 'flex:1;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#bbbbbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			this._header.appendChild(this._titleLabel);

			this._toolbar = $<HTMLElement>('div', 'dc-composite-part-toolbar');
			this._toolbar.style.cssText = 'display:flex;align-items:center;gap:2px;';
			this._header.appendChild(this._toolbar);

			this._element.appendChild(this._header);
		} else {
			this._header = null;
			this._titleLabel = null;
			this._iconEl = null;
			this._toolbar = null;
		}

		this._body = $<HTMLElement>('div', 'dc-composite-part-body');
		this._body.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';
		this._element.appendChild(this._body);

		parent.appendChild(this._element);
		this.setTitle(_options.title);
		if (_options.icon) {
			this.setIcon(_options.icon);
		}
	}

	get element(): HTMLElement {
		return this._element;
	}

	get body(): HTMLElement {
		return this._body;
	}

	get header(): HTMLElement | null {
		return this._header;
	}

	get toolbar(): HTMLElement | null {
		return this._toolbar;
	}

	get title(): string {
		return this._titleLabel?.textContent ?? '';
	}

	get isVisible(): boolean {
		return this._visible;
	}

	get content(): T | null {
		return this._view;
	}

	setTitle(title: string): void {
		if (this._titleLabel) {
			this._titleLabel.textContent = title.toUpperCase();
		}
	}

	setIcon(icon: string): void {
		if (this._iconEl) {
			this._iconEl.textContent = icon;
			this._iconEl.style.display = 'inline-block';
		}
	}

	createContent(): T {
		if (!this._view) {
			this._view = this._options.createView(this._body);
			this._register(this._view);
		}
		return this._view;
	}

	clearContent(): void {
		if (this._view) {
			this._view.dispose();
			this._view = null;
			clearNode(this._body);
		}
	}

	setVisible(visible: boolean): void {
		if (this._visible === visible) {
			return;
		}
		this._visible = visible;
		this._element.style.display = visible ? 'flex' : 'none';
		this._onDidChangeVisibility.fire(visible);
	}

	layout(width: number, height: number): void {
		this._element.style.width = width > 0 ? `${width}px` : '';
		this._element.style.height = height > 0 ? `${height}px` : '';
	}

	dispose(): void {
		this.clearContent();
		this._element.remove();
		super.dispose();
	}
}
