/**
 * Dardcor Code - Terminal Service (Task 153)
 * Mirrors: vs/workbench/contrib/terminal/common/terminal.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ITerminalInstance extends IDisposable {
	readonly id: number;
	readonly title: string;
	readonly onDidWrite: Event<string>;
	readonly onDidExit: Event<number>;
	write(data: string): void;
	sendText(text: string, addNewLine?: boolean): void;
	resize(cols: number, rows: number): void;
	focus(): void;
}

export const ITerminalService = Symbol('ITerminalService');

export interface ITerminalService {
	readonly onDidCreateInstance: Event<ITerminalInstance>;
	readonly onDidDisposeInstance: Event<ITerminalInstance>;
	readonly instances: readonly ITerminalInstance[];
	createTerminal(options?: { name?: string; shellPath?: string; cwd?: string }): ITerminalInstance;
}

export class TerminalService implements ITerminalService {
	private readonly _instances: ITerminalInstance[] = [];
	private _nextId = 1;
	private readonly _onDidCreateInstance = new Emitter<ITerminalInstance>();
	private readonly _onDidDisposeInstance = new Emitter<ITerminalInstance>();

	readonly onDidCreateInstance = this._onDidCreateInstance.event;
	readonly onDidDisposeInstance = this._onDidDisposeInstance.event;
	get instances(): readonly ITerminalInstance[] { return this._instances; }

	createTerminal(options?: { name?: string; shellPath?: string; cwd?: string }): ITerminalInstance {
		const id = this._nextId++;
		const title = options?.name || `Terminal ${id}`;
		const onDidWrite = new Emitter<string>();
		const onDidExit = new Emitter<number>();

		const instance: ITerminalInstance = {
			id,
			title,
			onDidWrite: onDidWrite.event,
			onDidExit: onDidExit.event,
			write: (data: string) => onDidWrite.fire(data),
			sendText: (text: string, addNewLine = true) => {
				onDidWrite.fire(text + (addNewLine ? '\r\n' : ''));
			},
			resize: (_cols: number, _rows: number) => {},
			focus: () => {},
			dispose: () => {
				const idx = this._instances.indexOf(instance);
				if (idx >= 0) this._instances.splice(idx, 1);
				this._onDidDisposeInstance.fire(instance);
				onDidWrite.dispose();
				onDidExit.dispose();
			}
		};

		this._instances.push(instance);
		this._onDidCreateInstance.fire(instance);
		return instance;
	}
}
