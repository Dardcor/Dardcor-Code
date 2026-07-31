import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTerminal {
	private readonly _terminals = new Map<string, any>();

	private readonly _onDidOpenTerminal = new Emitter<any>();
	readonly onDidOpenTerminal = this._onDidOpenTerminal.event;

	private readonly _onDidCloseTerminal = new Emitter<any>();
	readonly onDidCloseTerminal = this._onDidCloseTerminal.event;

	createTerminal(nameOrOptions?: any, shellPath?: string, shellArgs?: any): any {
		const id = `terminal-${Math.random().toString(36).substr(2, 9)}`;
		const terminal = {
			name: typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions?.name || 'Terminal',
			processId: Promise.resolve(Math.floor(Math.random() * 10000)),
			creationOptions: typeof nameOrOptions === 'object' ? nameOrOptions : { name: nameOrOptions, shellPath, shellArgs },
			exitStatus: undefined,
			sendText: (text: string, addNewLine?: boolean) => {
				console.log(`Sending text to terminal ${id}: ${text}`);
			},
			show: (preserveFocus?: boolean) => {
				console.log(`Showing terminal ${id}`);
			},
			hide: () => {
				console.log(`Hiding terminal ${id}`);
			},
			dispose: () => {
				this._terminals.delete(id);
				this._onDidCloseTerminal.fire(terminal);
			}
		};
		this._terminals.set(id, terminal);
		this._onDidOpenTerminal.fire(terminal);
		return terminal;
	}

	get terminals(): any[] {
		return Array.from(this._terminals.values());
	}
}
