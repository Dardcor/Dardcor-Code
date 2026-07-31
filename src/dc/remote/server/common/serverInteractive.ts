import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerInteractiveSession {
	readonly id: string;
	readonly notebookUri: string;
	readonly inputUri: string;
	readonly language: string;
}

export interface IServerInteractiveService {
	readonly onDidCreateSession: Event<IServerInteractiveSession>;
	readonly onDidCloseSession: Event<string>;
	createSession(language: string): IServerInteractiveSession;
	closeSession(id: string): void;
	getSession(id: string): IServerInteractiveSession | undefined;
	getSessions(): IServerInteractiveSession[];
	executeCode(sessionId: string, code: string): Promise<void>;
}

export class ServerInteractiveCommon implements IServerInteractiveService {
	private readonly _sessions = new Map<string, IServerInteractiveSession>();
	private _nextId = 1;

	private readonly _onDidCreateSession = new Emitter<IServerInteractiveSession>();
	readonly onDidCreateSession = this._onDidCreateSession.event;

	private readonly _onDidCloseSession = new Emitter<string>();
	readonly onDidCloseSession = this._onDidCloseSession.event;

	createSession(language: string): IServerInteractiveSession {
		const id = `interactive-${this._nextId++}`;
		const session: IServerInteractiveSession = { id, notebookUri: `interactive:${id}`, inputUri: `interactive-input:${id}`, language };
		this._sessions.set(id, session);
		this._onDidCreateSession.fire(session);
		return session;
	}

	closeSession(id: string): void {
		this._sessions.delete(id);
		this._onDidCloseSession.fire(id);
	}

	getSession(id: string): IServerInteractiveSession | undefined {
		return this._sessions.get(id);
	}

	getSessions(): IServerInteractiveSession[] {
		return Array.from(this._sessions.values());
	}

	async executeCode(_sessionId: string, _code: string): Promise<void> {}
}
