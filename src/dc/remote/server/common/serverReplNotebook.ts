import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerReplNotebookSession {
	readonly id: string;
	readonly notebookUri: string;
}

export interface IServerReplNotebookService {
	readonly onDidCreateRepl: Event<IServerReplNotebookSession>;
	readonly onDidCloseRepl: Event<string>;
	createRepl(title?: string): IServerReplNotebookSession;
	closeRepl(id: string): void;
	getRepl(id: string): IServerReplNotebookSession | undefined;
	getRepls(): IServerReplNotebookSession[];
}

export class ServerReplNotebookCommon implements IServerReplNotebookService {
	private readonly _repls = new Map<string, IServerReplNotebookSession>();
	private _nextId = 1;

	private readonly _onDidCreateRepl = new Emitter<IServerReplNotebookSession>();
	readonly onDidCreateRepl = this._onDidCreateRepl.event;

	private readonly _onDidCloseRepl = new Emitter<string>();
	readonly onDidCloseRepl = this._onDidCloseRepl.event;

	createRepl(_title?: string): IServerReplNotebookSession {
		const id = `repl-${this._nextId++}`;
		const repl: IServerReplNotebookSession = { id, notebookUri: `repl:${id}` };
		this._repls.set(id, repl);
		this._onDidCreateRepl.fire(repl);
		return repl;
	}

	closeRepl(id: string): void {
		this._repls.delete(id);
		this._onDidCloseRepl.fire(id);
	}

	getRepl(id: string): IServerReplNotebookSession | undefined {
		return this._repls.get(id);
	}

	getRepls(): IServerReplNotebookSession[] {
		return Array.from(this._repls.values());
	}
}
