/**
 * Dardcor Code - dc.commands API Bridge (Task 608)
 * Mirrors: vs/workbench/api/common/extHostCommands.ts
 */

import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol';

export interface ICommandHandler<T extends unknown[] = any[]> {
	(...args: T): unknown | Promise<unknown>;
}

export interface ICommandRegistration {
	readonly id: string;
	readonly handler: ICommandHandler;
	readonly thisArg?: any;
}

export interface ICommandExecuteEvent {
	readonly commandId: string;
	readonly args: any[];
}

export interface ICommandsApi {
	registerCommand(command: string, callback: ICommandHandler, thisArg?: any): IDisposable;
	executeCommand<T = any>(command: string, ...rest: any[]): Promise<T | undefined>;
	getCommands(filterInternal?: boolean): Promise<string[]>;
	onDidExecuteCommand: Event<ICommandExecuteEvent>;
}

/**
 * Extension command registry. Commands registered here become callable
 * from the main side; `executeCommand` prefers locally registered
 * handlers (extension-to-extension calls) and falls back to the main
 * process command service via RPC.
 */
export class ExtHostCommands extends Disposable {
	private readonly _commands = new Map<string, ICommandHandler>();

	private readonly _onDidExecuteCommand = this._register(new Emitter<ICommandExecuteEvent>());
	readonly onDidExecuteCommand: Event<ICommandExecuteEvent> = this._onDidExecuteCommand.event;

	constructor(private readonly _rpc: RPCProtocol) {
		super();
	}

	public registerCommand(id: string, callback: ICommandHandler, thisArg?: any): IDisposable {
		if (this._commands.has(id)) {
			throw new Error(`Perintah '${id}' sudah terdaftar`);
		}
		const handler = thisArg ? callback.bind(thisArg) : callback;
		this._commands.set(id, handler);
		this._rpc.notify('main', 'commands.register', { id });
		return toDisposable(() => {
			if (this._commands.delete(id)) {
				this._rpc.notify('main', 'commands.unregister', { id });
			}
		});
	}

	public async executeCommand<T = any>(id: string, ...args: any[]): Promise<T | undefined> {
		const handler = this._commands.get(id);
		if (handler) {
			this._onDidExecuteCommand.fire({ commandId: id, args });
			return await handler(...args) as T;
		}
		const result = await this._rpc.call<T>('main', 'commands.execute', { id, args });
		this._onDidExecuteCommand.fire({ commandId: id, args });
		return result;
	}

	public getCommands(): Promise<string[]> {
		const local = [...this._commands.keys()];
		return this._rpc.call<string[]>('main', 'commands.getAll', {}).then(remote => {
			const all = new Set([...local, ...(remote ?? [])]);
			return [...all];
		});
	}

	public getApi(): ICommandsApi {
		return {
			registerCommand: (command: string, callback: ICommandHandler, thisArg?: any) => this.registerCommand(command, callback, thisArg),
			executeCommand: (command: string, ...rest: any[]) => this.executeCommand(command, ...rest),
			getCommands: (filterInternal?: boolean) => this.getCommands().then(list => filterInternal ? list.filter(c => !c.startsWith('_')) : list),
			onDidExecuteCommand: this.onDidExecuteCommand
		};
	}

	public get api(): ICommandsApi {
		return this.getApi();
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case '$execute': {
						const handler = this._commands.get(payload.id);
						if (!handler) {
							throw new Error(`Perintah '${payload.id}' tidak dikenal di Extension Host`);
						}
						this._onDidExecuteCommand.fire({ commandId: payload.id, args: payload.args ?? [] });
						return handler(...(payload.args ?? []));
					}
					case '$getAll':
						return [...this._commands.keys()];
					default:
						throw new Error(`Perintah commands tidak dikenal: ${command}`);
				}
			},
			notify: (command: string, payload: any) => {
				if (command === '$execute') {
					const handler = this._commands.get(payload.id);
					if (handler) {
						this._onDidExecuteCommand.fire({ commandId: payload.id, args: payload.args ?? [] });
						Promise.resolve(handler(...(payload.args ?? []))).catch(err => console.error(`[ext-host] Perintah '${payload.id}' gagal:`, err));
					}
				}
			}
		};
	}
}
