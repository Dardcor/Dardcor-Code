/**
 * Dardcor Code - Click Command Execution Binding For Status Items
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { StatusbarItem } from './statusbar-item';
import { StatusbarPart } from './statusbar-part';
import { CommandRegistry } from '../../../services/commands/command-service';
import { ServicesAccessor } from '../../../services/instantiation/annotations';

const NOOP_ACCESSOR: ServicesAccessor = {
	get: () => undefined as never,
};

export interface IStatusbarClickEvent {
	readonly item: StatusbarItem;
	readonly commandId: string;
	readonly succeeded: boolean;
}

export interface IStatusbarClickOptions {
	readonly propagateErrors?: boolean;
	readonly autoFocus?: boolean;
}

export class StatusbarClick extends Disposable {
	private readonly _part: StatusbarPart;
	private readonly _options: IStatusbarClickOptions;

	private readonly _onDidExecuteCommand = this._register(new Emitter<IStatusbarClickEvent>());
	readonly onDidExecuteCommand: Event<IStatusbarClickEvent> = this._onDidExecuteCommand.event;

	constructor(part: StatusbarPart, options: IStatusbarClickOptions = {}) {
		super();
		this._part = part;
		this._options = options;

		for (const item of part.getItems()) {
			this._bindItem(item);
		}
		this._register(part.onDidChangeEntries(() => {
			for (const item of part.getItems()) {
				this._bindItem(item);
			}
		}));
	}

	execute(item: StatusbarItem): boolean {
		const commandId = item.commandId;
		if (!commandId) {
			return false;
		}
		return this.executeCommand(commandId, item);
	}

	executeCommand(commandId: string, item?: StatusbarItem): boolean {
		const command = CommandRegistry.getCommand(commandId);
		if (!command) {
			if (this._options.propagateErrors) {
				throw new Error(`Statusbar command '${commandId}' not found`);
			}
			return false;
		}
		try {
			command.handler(NOOP_ACCESSOR, item);
			this._onDidExecuteCommand.fire({ item: item ?? this._findItem(commandId), commandId, succeeded: true });
			return true;
		} catch (err) {
			console.error(`Failed to execute statusbar command '${commandId}'`, err);
			if (this._options.propagateErrors) {
				throw err;
			}
			this._onDidExecuteCommand.fire({ item: item ?? this._findItem(commandId), commandId, succeeded: false });
			return false;
		}
	}

	private _bindItem(item: StatusbarItem): void {
		const key = `statusbar-click-${item.id}`;
		if ((item as unknown as Record<string, unknown>)[key]) {
			return;
		}
		const listener = item.onDidClick(it => this.execute(it));
		(item as unknown as Record<string, unknown>)[key] = listener;
		this._register(listener);
	}

	private _findItem(commandId: string): StatusbarItem {
		const item = this._part.getItems().find(i => i.commandId === commandId);
		return item ?? new StatusbarItem({ id: 'unknown', alignment: 0, commandId });
	}

	dispose(): void {
		super.dispose();
	}
}
