/**
 * Dardcor Code - Terminal Service (Task 153)
 * Mirrors: vs/workbench/contrib/terminal/common/terminal.ts (process terminal allocator)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { PtyProcess } from './pty-exec.js';

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

export interface ITerminalOptions {
	name?: string;
	shellPath?: string;
	cwd?: string;
	env?: Record<string, string>;
	cols?: number;
	rows?: number;
}

export const ITerminalService = createDecorator<ITerminalService>('terminalService');

export interface ITerminalService {
	readonly _serviceBrand: undefined;
	readonly onDidCreateInstance: Event<ITerminalInstance>;
	readonly onDidDisposeInstance: Event<ITerminalInstance>;
	readonly instances: readonly ITerminalInstance[];
	createTerminal(options?: ITerminalOptions): ITerminalInstance;
}

function getDefaultShell(): string {
	try {
		if (process?.env?.SHELL) {
			return process.env.SHELL;
		}
		if (process?.env?.ComSpec) {
			return process.env.ComSpec;
		}
	} catch {
		// Not in a Node environment.
	}
	return '/bin/sh';
}

export class TerminalService extends Disposable implements ITerminalService {
	declare readonly _serviceBrand: undefined;

	private readonly _instances: ITerminalInstance[] = [];
	private _nextId = 1;

	private readonly _onDidCreateInstance = this._register(new Emitter<ITerminalInstance>());
	private readonly _onDidDisposeInstance = this._register(new Emitter<ITerminalInstance>());

	readonly onDidCreateInstance = this._onDidCreateInstance.event;
	readonly onDidDisposeInstance = this._onDidDisposeInstance.event;

	constructor() {
		super();
	}

	get instances(): readonly ITerminalInstance[] {
		return this._instances;
	}

	createTerminal(options: ITerminalOptions = {}): ITerminalInstance {
		const id = this._nextId++;
		const title = options.name || `Terminal ${id}`;
		const onDidWrite = this._register(new Emitter<string>());
		const onDidExit = this._register(new Emitter<number>());
		const pty = new PtyProcess(options.shellPath || getDefaultShell(), [], {
			cwd: options.cwd,
			env: options.env,
		});

		const instance: ITerminalInstance = {
			id,
			title,
			onDidWrite: onDidWrite.event,
			onDidExit: onDidExit.event,
			write: (data: string) => pty.write(data),
			sendText: (text: string, addNewLine = true) => pty.write(text + (addNewLine ? '\r' : '')),
			resize: (cols: number, rows: number) => pty.resize(cols, rows),
			focus: () => {
				// Focus is handled by the owning terminal view.
			},
			dispose: () => {
				const idx = this._instances.indexOf(instance);
				if (idx >= 0) {
					this._instances.splice(idx, 1);
				}
				pty.dispose();
				onDidWrite.dispose();
				onDidExit.dispose();
				this._onDidDisposeInstance.fire(instance);
			},
		};

		pty.onData((data) => onDidWrite.fire(data));
		pty.onExit((code) => onDidExit.fire(code));

		this._instances.push(instance);
		this._onDidCreateInstance.fire(instance);
		return instance;
	}
}
