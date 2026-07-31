/**
 * Dardcor Code - Command Service & Command Registry
 */

import { createDecorator, ServicesAccessor } from '../instantiation/annotations';
import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { IInstantiationService } from '../instantiation/container';

export interface ICommand {
	id: string;
	handler(accessor: ServicesAccessor, ...args: any[]): any;
}

export namespace CommandRegistry {
	const _commands = new Map<string, ICommand>();

	export function registerCommand(command: ICommand): { dispose(): void } {
		_commands.set(command.id, command);
		return {
			dispose() {
				_commands.delete(command.id);
			}
		};
	}

	export function getCommand(id: string): ICommand | undefined {
		return _commands.get(id);
	}

	export function getCommands(): Map<string, ICommand> {
		return _commands;
	}
}

export const ICommandService = createDecorator<ICommandService>('commandService');

export interface ICommandService {
	readonly _serviceBrand: undefined;
	readonly onWillExecuteCommand: Event<{ commandId: string; args: any[] }>;
	executeCommand<T = any>(commandId: string, ...args: any[]): Promise<T>;
}

export class CommandService extends Disposable implements ICommandService {
	declare readonly _serviceBrand: undefined;

	private readonly _onWillExecuteCommand = this._register(new Emitter<{ commandId: string; args: any[] }>());
	readonly onWillExecuteCommand = this._onWillExecuteCommand.event;

	constructor(private readonly _instantiationService: IInstantiationService) {
		super();
	}

	public async executeCommand<T = any>(commandId: string, ...args: any[]): Promise<T> {
		const command = CommandRegistry.getCommand(commandId);
		if (!command) {
			throw new Error(`Command '${commandId}' not found`);
		}
		this._onWillExecuteCommand.fire({ commandId, args });
		return this._instantiationService.invokeFunction(command.handler, ...args);
	}
}
