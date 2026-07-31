/**
 * Dardcor Code - Bottom Status Indicator Bar With Item Alignment
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';
import { StatusbarRegistry, StatusbarAlignment } from './statusbar-registry';
import { StatusbarItem, createStatusbarItem } from './statusbar-item';
import { CommandRegistry } from '../../../services/commands/command-service';
import { ServicesAccessor } from '../../../services/instantiation/annotations';

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

		this._registerCoreStatusbarItems();

		this._register(this._registry.onDidChange(() => this._render()));
		this._render();
	}

	private _registerCoreStatusbarItems(): void {
		// Only register if not already registered
		if (this._registry.getEntry('status.remote')) return;

		// Left alignment
		this._registry.register({ id: 'status.remote', alignment: StatusbarAlignment.LEFT, text: '<i class="codicon codicon-remote"></i>', tooltip: 'Open a Remote Window', priority: 100 });
		this._registry.register({ id: 'status.branch', alignment: StatusbarAlignment.LEFT, text: '<i class="codicon codicon-source-control"></i> main*', tooltip: 'Source Control', priority: 90 });
		this._registry.register({ id: 'status.sync', alignment: StatusbarAlignment.LEFT, text: '<i class="codicon codicon-sync"></i>', tooltip: 'Sync Changes', priority: 80 });
		this._registry.register({ id: 'status.problems', alignment: StatusbarAlignment.LEFT, text: '<i class="codicon codicon-error"></i> 0 <i class="codicon codicon-warning"></i> 0', tooltip: 'No Problems', priority: 70 });
		this._registry.register({ id: 'status.workspaceTrust', alignment: StatusbarAlignment.LEFT, text: '<i class="codicon codicon-check"></i>', tooltip: 'Workspace is Trusted', priority: 60 });

		// Right alignment
		this._registry.register({ id: 'status.cursorPosition', alignment: StatusbarAlignment.RIGHT, text: 'Ln 1, Col 1', tooltip: 'Go to Line/Column', priority: 100 });
		this._registry.register({ id: 'status.indentation', alignment: StatusbarAlignment.RIGHT, text: 'Spaces: 4', tooltip: 'Select Indentation', priority: 90 });
		this._registry.register({ id: 'status.encoding', alignment: StatusbarAlignment.RIGHT, text: 'UTF-8', tooltip: 'Select Encoding', priority: 80 });
		this._registry.register({ id: 'status.lineEnding', alignment: StatusbarAlignment.RIGHT, text: 'LF', tooltip: 'Select End of Line Sequence', priority: 70 });
		this._registry.register({ id: 'status.language', alignment: StatusbarAlignment.RIGHT, text: 'TypeScript', tooltip: 'Select Language Mode', priority: 60 });
		this._registry.register({ id: 'status.editorGroupCount', alignment: StatusbarAlignment.RIGHT, text: 'Editor Groups: 1', tooltip: 'Editor Layout', priority: 50 });
		this._registry.register({ id: 'status.test', alignment: StatusbarAlignment.RIGHT, text: '<i class="codicon codicon-beaker"></i>', tooltip: 'Run Tests', priority: 40 });
		this._registry.register({ id: 'status.debug', alignment: StatusbarAlignment.RIGHT, text: '<i class="codicon codicon-debug"></i>', tooltip: 'Start Debugging', priority: 30 });
		this._registry.register({ id: 'status.terminal', alignment: StatusbarAlignment.RIGHT, text: '<i class="codicon codicon-terminal"></i>', tooltip: 'Toggle Terminal', priority: 20 });
		this._registry.register({ id: 'status.profile', alignment: StatusbarAlignment.RIGHT, text: '<i class="codicon codicon-account"></i>', tooltip: 'Profile', priority: 10 });
		this._registry.register({ id: 'status.settings', alignment: StatusbarAlignment.RIGHT, text: '<i class="codicon codicon-gear"></i>', tooltip: 'Manage', priority: 5 });
		this._registry.register({ id: 'status.notifications', alignment: StatusbarAlignment.RIGHT, text: '<i class="codicon codicon-bell"></i>', tooltip: 'No Notifications', priority: 0 });
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
