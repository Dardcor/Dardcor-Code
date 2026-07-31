/**
 * Dardcor Code - dc.terminal API Bridge (Task 612)
 * Mirrors: vs/workbench/api/common/extHostTerminalService.ts
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol } from '../host/rpc-protocol.js';

export interface IExtHostTerminalOptions {
	name?: string;
	cwd?: string;
	env?: Record<string, string>;
	shellPath?: string;
	shellArgs?: string[];
	pty?: Pseudoterminal;
	isTransient?: boolean;
	iconPath?: unknown;
	location?: unknown;
}

export interface Pseudoterminal {
	readonly onDidWrite: Event<string>;
	readonly onDidClose?: Event<void | number>;
	readonly onDidChangeName?: Event<string>;
	open(initialDimensions?: TerminalDimensions): void;
	close(): void;
	handleInput?(data: string): void;
	setDimensions?(dimensions: TerminalDimensions): void;
}

export interface TerminalDimensions {
	readonly columns: number;
	readonly rows: number;
}

export interface TerminalExitStatus {
	readonly code: number | undefined;
}

export interface IExtHostTerminalData {
	terminalId: number;
	data: string;
}

export interface ITerminalApi {
	createTerminal(options?: IExtHostTerminalOptions | string): Terminal;
	readonly terminals: readonly Terminal[];
	readonly onDidOpenTerminal: Event<Terminal>;
	readonly onDidCloseTerminal: Event<Terminal>;
	readonly onDidChangeActiveTerminal: Event<Terminal | undefined>;
	readonly onDidWriteTerminalData: Event<IExtHostTerminalData>;
}

/**
 * Terminal bridge. Extension-created terminals are materialized on the
 * main side; the extension may attach a `Pseudoterminal` to produce or
 * consume the terminal's I/O stream.
 */
export class ExtHostTerminal extends Disposable {
	private readonly _terminals = new Map<number, Terminal>();
	private _nextTerminalId = 1;
	private _activeTerminal: Terminal | undefined;

	private readonly _onDidOpenTerminal = this._register(new Emitter<Terminal>());
	readonly onDidOpenTerminal: Event<Terminal> = this._onDidOpenTerminal.event;

	private readonly _onDidCloseTerminal = this._register(new Emitter<Terminal>());
	readonly onDidCloseTerminal: Event<Terminal> = this._onDidCloseTerminal.event;

	private readonly _onDidChangeActiveTerminal = this._register(new Emitter<Terminal | undefined>());
	readonly onDidChangeActiveTerminal: Event<Terminal | undefined> = this._onDidChangeActiveTerminal.event;

	private readonly _onDidWriteTerminalData = this._register(new Emitter<IExtHostTerminalData>());
	readonly onDidWriteTerminalData: Event<IExtHostTerminalData> = this._onDidWriteTerminalData.event;

	constructor(private readonly _rpc: RPCProtocol) {
		super();
		this._register(this._rpc.onEvent('terminal', 'data')((payload: { terminalId: number; data: string }) => {
			this._terminals.get(payload.terminalId)?.handleInput(payload.data);
		}));
		this._register(this._rpc.onEvent('terminal', 'close')((payload: { terminalId: number; code: number | undefined }) => {
			const terminal = this._terminals.get(payload.terminalId);
			if (terminal) {
				this._terminals.delete(payload.terminalId);
				terminal.exitStatus = { code: payload.code };
				this._onDidCloseTerminal.fire(terminal);
				if (this._activeTerminal === terminal) {
					this._setActiveTerminal(this._terminals.values().next().value);
				}
			}
		}));
		this._register(this._rpc.onEvent('terminal', 'active')((payload: { terminalId: number | undefined }) => {
			this._setActiveTerminal(payload.terminalId === undefined ? undefined : this._terminals.get(payload.terminalId));
		}));
	}

	public get all(): Terminal[] {
		return [...this._terminals.values()];
	}

	public get activeTerminal(): Terminal | undefined {
		return this._activeTerminal;
	}

	public createTerminal(options?: IExtHostTerminalOptions | string): Terminal {
		const opts: IExtHostTerminalOptions = typeof options === 'string' ? { name: options } : (options ?? {});
		const id = this._nextTerminalId++;
		const terminal = new Terminal(this._rpc, id, opts);
		this._terminals.set(id, terminal);
		if (opts.pty) {
			this._bindPseudoTerminal(terminal, opts.pty);
		}
		this._rpc.call<number>('main', 'terminal.create', {
			id,
			name: opts.name,
			cwd: opts.cwd,
			env: opts.env,
			shellPath: opts.shellPath,
			shellArgs: opts.shellArgs,
			isTransient: opts.isTransient,
			isExtensionTerminal: true
		}).catch(err => console.error('[ext-host] Gagal membuat terminal:', err));
		this._onDidOpenTerminal.fire(terminal);
		return terminal;
	}

	public get api(): ITerminalApi {
		const self = this;
		return {
			createTerminal: (options?: IExtHostTerminalOptions | string) => this.createTerminal(options),
			get terminals() {
				return self.all;
			},
			onDidOpenTerminal: this.onDidOpenTerminal,
			onDidCloseTerminal: this.onDidCloseTerminal,
			onDidChangeActiveTerminal: this.onDidChangeActiveTerminal,
			onDidWriteTerminalData: this.onDidWriteTerminalData
		};
	}

	private _bindPseudoTerminal(terminal: Terminal, pty: Pseudoterminal): void {
		terminal._setPseudoTerminal(pty);
		this._register(pty.onDidWrite(data => {
			this._onDidWriteTerminalData.fire({ terminalId: terminal.id, data });
			this._rpc.notify('main', 'terminal.write', { id: terminal.id, data });
		}));
		if (pty.onDidClose) {
			this._register(pty.onDidClose(code => {
				this._rpc.notify('main', 'terminal.close', { id: terminal.id, code: code === undefined ? undefined : code });
			}));
		}
		if (pty.onDidChangeName) {
			this._register(pty.onDidChangeName(name => {
				terminal.name = name;
				this._rpc.notify('main', 'terminal.rename', { id: terminal.id, name });
			}));
		}
	}

	private _setActiveTerminal(terminal: Terminal | undefined): void {
		if (terminal !== this._activeTerminal) {
			this._activeTerminal = terminal;
			this._onDidChangeActiveTerminal.fire(terminal);
		}
	}
}

export class Terminal implements IDisposable {
	private _name: string;
	private _exitStatus: TerminalExitStatus | undefined;
	private _disposed = false;
	private _pty: Pseudoterminal | undefined;
	private _dimensions: TerminalDimensions | undefined;

	constructor(
		private readonly _rpc: RPCProtocol,
		public readonly id: number,
		public readonly creationOptions: IExtHostTerminalOptions
	) {
		this._name = creationOptions.name ?? `Terminal ${id}`;
	}

	public get name(): string {
		return this._name;
	}

	public set name(value: string) {
		this._name = value;
	}

	public get exitStatus(): TerminalExitStatus | undefined {
		return this._exitStatus;
	}

	public set exitStatus(value: TerminalExitStatus | undefined) {
		this._exitStatus = value;
	}

	public sendText(text: string, addNewLine = true): void {
		if (this._disposed) {
			return;
		}
		this._rpc.notify('main', 'terminal.sendText', { id: this.id, text, addNewLine });
	}

	public show(preserveFocus?: boolean): void {
		this._rpc.notify('main', 'terminal.show', { id: this.id, preserveFocus: preserveFocus ?? false });
	}

	public hide(): void {
		this._rpc.notify('main', 'terminal.hide', { id: this.id });
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._pty?.close();
		this._rpc.notify('main', 'terminal.dispose', { id: this.id });
	}

	public get dimensions(): TerminalDimensions | undefined {
		return this._dimensions;
	}

	public _setPseudoTerminal(pty: Pseudoterminal): void {
		this._pty = pty;
	}

	public _onDimensionsChanged(dimensions: TerminalDimensions): void {
		this._dimensions = dimensions;
		this._pty?.setDimensions?.(dimensions);
	}

	public handleInput(data: string): void {
		this._pty?.handleInput?.(data);
	}

	public _onOpen(): void {
		this._pty?.open(this._dimensions);
	}
}
