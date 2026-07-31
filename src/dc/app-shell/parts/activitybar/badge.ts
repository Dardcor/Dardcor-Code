/**
 * Dardcor Code - Notification Badge Counter Pill On Activity Bar Icons
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';

export interface IBadgeOptions {
	readonly align?: 'right' | 'top';
	readonly maxCount?: number;
	readonly backgroundColor?: string;
	readonly foregroundColor?: string;
}

export class Badge extends Disposable {
	private readonly _el: HTMLElement;
	private readonly _options: Required<Pick<IBadgeOptions, 'align' | 'maxCount' | 'backgroundColor' | 'foregroundColor'>>;
	private _count = 0;
	private _tooltip = '';

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		parent: HTMLElement,
		options: IBadgeOptions = {}
	) {
		super();
		this._options = {
			align: options.align ?? 'right',
			maxCount: options.maxCount ?? 99,
			backgroundColor: options.backgroundColor ?? '#e51400',
			foregroundColor: options.foregroundColor ?? '#ffffff',
		};
		this._el = $<HTMLElement>('div', 'dc-badge');
		this._el.style.cssText = 'position:absolute;display:none;z-index:10;min-width:15px;height:15px;line-height:15px;box-sizing:border-box;padding:0 4px;border-radius:9px;font-size:9px;font-weight:600;text-align:center;font-family:Segoe UI, sans-serif;pointer-events:none;' +
			`background:${this._options.backgroundColor};color:${this._options.foregroundColor};` +
			(this._options.align === 'top'
				? 'top:2px;left:50%;transform:translateX(-50%);'
				: 'top:4px;right:6px;border:1px solid rgba(0,0,0,0.3);');
		parent.appendChild(this._el);
	}

	get element(): HTMLElement {
		return this._el;
	}

	get count(): number {
		return this._count;
	}

	get visible(): boolean {
		return this._el.style.display !== 'none';
	}

	setNumber(count: number): void {
		this._count = count;
		this._update();
	}

	setTooltip(tooltip: string): void {
		this._tooltip = tooltip;
		this._el.title = tooltip;
	}

	showDot(): void {
		this._count = -1;
		this._update();
	}

	clear(): void {
		this._count = 0;
		this._update();
	}

	private _update(): void {
		if (this._count <= 0) {
			this._el.style.display = 'none';
			this._el.textContent = '';
			this._el.style.minWidth = '15px';
		} else if (this._count === -1) {
			this._el.style.display = 'block';
			this._el.style.minWidth = '8px';
			this._el.style.width = '8px';
			this._el.style.height = '8px';
			this._el.style.borderRadius = '50%';
			this._el.textContent = '';
		} else {
			this._el.style.display = 'block';
			this._el.style.width = 'auto';
			this._el.style.height = '15px';
			this._el.style.borderRadius = '9px';
			this._el.textContent = this._count > this._options.maxCount ? `${this._options.maxCount}+` : `${this._count}`;
		}
		this._onDidChange.fire();
	}

	dispose(): void {
		this._el.remove();
		super.dispose();
	}
}
