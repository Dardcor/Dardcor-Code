/**
 * Dardcor Code - Bottom Status Indicator Bar With Item Alignment
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $, clearNode } from '../../../core/dom/element.js';
import { StatusbarRegistry, StatusbarAlignment } from './statusbar-registry.js';
import { StatusbarItem, createStatusbarItem } from './statusbar-item.js';
import { CommandRegistry } from '../../../services/commands/command-service.js';
import { ServicesAccessor } from '../../../services/instantiation/annotations.js';

const NOOP_ACCESSOR: ServicesAccessor = {
	get: () => undefined as never,
};

export class StatusbarPart extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _leftContainer: HTMLElement;
	private readonly _rightContainer: HTMLElement;
	private readonly _items = new Map<string, StatusbarItem>();

	private readonly _onDidChangeEntries = this._register(new Emitter<void>());
	readonly onDidChangeEntries: Event<void> = this._onDidChangeEntries.event;

	constructor(
		container: HTMLElement,
		private readonly _registry: StatusbarRegistry = StatusbarRegistry.instance
	) {
		super();
		this._container = container;
		container.style.cssText = 'display:flex;align-items:stretch;justify-content:space-between;';

		this._leftContainer = $<HTMLElement>('div', 'dc-statusbar-left');
		this._leftContainer.style.cssText = 'display:flex;align-items:stretch;overflow:hidden;';
		this._rightContainer = $<HTMLElement>('div', 'dc-statusbar-right');
		this._rightContainer.style.cssText = 'display:flex;align-items:stretch;overflow:hidden;';
		container.appendChild(this._leftContainer);
		container.appendChild(this._rightContainer);

		this._register(this._registry.onDidChange(() => this._render()));
		this._render();
	}

	getItem(id: string): StatusbarItem | undefined {
		return this._items.get(id);
	}

	getItems(): StatusbarItem[] {
		return Array.from(this._items.values());
	}

	private _render(): void {
		const current = new Set(this._items.keys());
		const next = new Set(this._registry.getEntries().map(e => e.id));

		for (const id of current) {
			if (!next.has(id)) {
				this._items.get(id)?.dispose();
				this._items.delete(id);
			}
		}

		const leftEntries = this._registry.getEntries(StatusbarAlignment.LEFT);
		const rightEntries = this._registry.getEntries(StatusbarAlignment.RIGHT);

		for (const alignment of [StatusbarAlignment.LEFT, StatusbarAlignment.RIGHT]) {
			const entries = alignment === StatusbarAlignment.LEFT ? leftEntries : rightEntries;
			const container = alignment === StatusbarAlignment.LEFT ? this._leftContainer : this._rightContainer;
			clearNode(container);
			for (const entry of entries) {
				let item = this._items.get(entry.id);
				if (!item) {
					item = createStatusbarItem(entry);
					this._register(item);
					this._items.set(entry.id, item);
					item.onDidClick(it => this._onItemClick(it));
				}
				container.appendChild(item.element);
			}
		}
		this._onDidChangeEntries.fire();
	}

	private _onItemClick(item: StatusbarItem): void {
		const commandId = item.commandId;
		if (!commandId) {
			return;
		}
		const command = CommandRegistry.getCommand(commandId);
		if (command) {
			try {
				command.handler(NOOP_ACCESSOR);
			} catch (err) {
				console.error(`Failed to execute statusbar command '${commandId}'`, err);
			}
		}
	}

	dispose(): void {
		for (const item of this._items.values()) {
			item.dispose();
		}
		this._items.clear();
		clearNode(this._container);
		super.dispose();
	}
}
