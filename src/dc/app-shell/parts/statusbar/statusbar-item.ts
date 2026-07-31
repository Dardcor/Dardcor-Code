/**
 * Dardcor Code - Status Bar Entry Item Model
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';
import { StatusbarAlignment, IStatusbarEntry } from './statusbar-registry';

export interface IStatusbarItemOptions {
	readonly id: string;
	readonly alignment: StatusbarAlignment;
	text?: string;
	tooltip?: string;
	commandId?: string;
	color?: string;
	priority?: number;
}

export class StatusbarItem extends Disposable {
	private readonly _el: HTMLElement;
	private _options: IStatusbarItemOptions;
	private readonly _onDidClick = this._register(new Emitter<StatusbarItem>());
	readonly onDidClick: Event<StatusbarItem> = this._onDidClick.event;

	constructor(options: IStatusbarItemOptions) {
		super();
		this._options = { ...options, text: options.text ?? '' };
		this._el = $<HTMLElement>('div', 'dc-statusbar-item');
		this._el.style.cssText = 'display:inline-flex;align-items:center;height:100%;padding:0 8px;font-size:12px;color:#ffffff;cursor:default;user-select:none;';
		this._el.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			this._onDidClick.fire(this);
		});
		this._render();
	}

	get id(): string {
		return this._options.id;
	}

	get alignment(): StatusbarAlignment {
		return this._options.alignment;
	}

	get priority(): number {
		return this._options.priority ?? 0;
	}

	get commandId(): string | undefined {
		return this._options.commandId;
	}

	get element(): HTMLElement {
		return this._el;
	}

	setText(text: string): void {
		if (text === this._options.text) {
			return;
		}
		this._options.text = text;
		this._render();
	}

	get text(): string {
		return this._options.text ?? '';
	}

	setTooltip(tooltip: string): void {
		this._options.tooltip = tooltip;
		this._el.title = tooltip;
	}

	setColor(color: string | undefined): void {
		this._options.color = color;
		this._render();
	}

	setVisible(visible: boolean): void {
		this._el.style.display = visible ? 'inline-flex' : 'none';
	}

	private _render(): void {
		this._el.textContent = this._options.text ?? '';
		this._el.style.color = this._options.color ?? '#ffffff';
		this._el.title = this._options.tooltip ?? '';
	}
}

export function createStatusbarItem(entry: IStatusbarEntry): StatusbarItem {
	return new StatusbarItem({
		id: entry.id,
		alignment: entry.alignment,
		text: entry.text,
		tooltip: entry.tooltip,
		commandId: entry.commandId,
		color: entry.color,
		priority: entry.priority,
	});
}
