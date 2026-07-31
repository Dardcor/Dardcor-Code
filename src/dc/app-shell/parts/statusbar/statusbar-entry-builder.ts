/**
 * Dardcor Code - Status Item Dynamic Construction Helper
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable';
import { StatusbarAlignment, IStatusbarEntry, StatusbarRegistry } from './statusbar-registry';
import { StatusbarItem } from './statusbar-item';

export interface IStatusbarEntryBuilderOptions {
	readonly id: string;
	readonly alignment?: StatusbarAlignment;
	readonly priority?: number;
}

type MutableStatusbarEntry = { -readonly [K in keyof IStatusbarEntry]: IStatusbarEntry[K] };

export class StatusbarEntryBuilder {
	private _entry: MutableStatusbarEntry;


	constructor(id: string, alignment: StatusbarAlignment = StatusbarAlignment.LEFT, priority = 0) {
		this._entry = { id, alignment, text: '', priority };
	}

	static fromOptions(options: IStatusbarEntryBuilderOptions): StatusbarEntryBuilder {
		return new StatusbarEntryBuilder(options.id, options.alignment ?? StatusbarAlignment.LEFT, options.priority ?? 0);
	}

	static fromEntry(entry: IStatusbarEntry): StatusbarEntryBuilder {
		const builder = new StatusbarEntryBuilder(entry.id, entry.alignment, entry.priority);
		builder._entry = { ...entry };
		return builder;
	}

	text(text: string): StatusbarEntryBuilder {
		this._entry.text = text;
		return this;
	}

	textWithIcon(icon: string, text: string): StatusbarEntryBuilder {
		this._entry.text = icon ? `${icon} ${text}`.trim() : text;
		return this;
	}

	tooltip(tooltip: string): StatusbarEntryBuilder {
		this._entry.tooltip = tooltip;
		return this;
	}

	command(commandId: string | undefined): StatusbarEntryBuilder {
		this._entry.commandId = commandId;
		return this;
	}

	color(color: string | undefined): StatusbarEntryBuilder {
		this._entry.color = color;
		return this;
	}

	alignment(alignment: StatusbarAlignment): StatusbarEntryBuilder {
		this._entry.alignment = alignment;
		return this;
	}

	priority(priority: number): StatusbarEntryBuilder {
		this._entry.priority = priority;
		return this;
	}

	build(): IStatusbarEntry {
		return { ...this._entry };
	}

	register(registry: StatusbarRegistry = StatusbarRegistry.instance): IDisposable {
		return registry.register(this.build());
	}
}

export class StatusbarEntryHost extends Disposable {
	private readonly _items = new Map<string, StatusbarItem>();

	constructor(
		private readonly _registry: StatusbarRegistry = StatusbarRegistry.instance
	) {
		super();
	}

	createItem(entry: IStatusbarEntry): StatusbarItem {
		const existing = this._items.get(entry.id);
		if (existing) {
			return existing;
		}
		const item = new StatusbarItem({
			id: entry.id,
			alignment: entry.alignment,
			text: entry.text,
			tooltip: entry.tooltip,
			commandId: entry.commandId,
			color: entry.color,
			priority: entry.priority,
		});
		this._register(item);
		this._items.set(entry.id, item);
		return item;
	}

	updateItem(item: StatusbarItem, entry: IStatusbarEntry): void {
		item.setText(entry.text);
		if (entry.tooltip !== undefined) {
			item.setTooltip(entry.tooltip);
		}
		if (entry.color !== undefined) {
			item.setColor(entry.color);
		}
	}

	removeItem(id: string): void {
		const item = this._items.get(id);
		if (item) {
			item.dispose();
			this._items.delete(id);
		}
	}

	getItem(id: string): StatusbarItem | undefined {
		return this._items.get(id);
	}

	dispose(): void {
		for (const item of this._items.values()) {
			item.dispose();
		}
		this._items.clear();
		super.dispose();
	}
}

export function buildStatusbarEntry(spec: {
	readonly id: string;
	readonly alignment?: StatusbarAlignment;
	readonly priority?: number;
	readonly text: string;
	readonly tooltip?: string;
	readonly commandId?: string;
	readonly color?: string;
}): IStatusbarEntry {
	return StatusbarEntryBuilder.fromOptions({
		id: spec.id,
		alignment: spec.alignment,
		priority: spec.priority,
	})
		.text(spec.text)
		.tooltip(spec.tooltip ?? '')
		.command(spec.commandId)
		.color(spec.color)
		.build();
}

export function registerStatusbarEntry(entry: IStatusbarEntry, registry: StatusbarRegistry = StatusbarRegistry.instance): IDisposable {
	return registry.register(entry);
}
