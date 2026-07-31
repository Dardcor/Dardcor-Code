import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerChatSession {
	readonly id: string;
	readonly providerId: string;
}

export interface IServerChatViewService {
	readonly onDidCreateSession: Event<IServerChatSession>;
	readonly onDidCloseSession: Event<string>;
	createSession(providerId: string): IServerChatSession;
	closeSession(id: string): void;
	getSession(id: string): IServerChatSession | undefined;
	getSessions(): IServerChatSession[];
	revealSession(id: string): void;
}

export class ServerChatViewCommon implements IServerChatViewService {
	private readonly _sessions = new Map<string, IServerChatSession>();
	private _nextId = 1;

	private readonly _onDidCreateSession = new Emitter<IServerChatSession>();
	readonly onDidCreateSession = this._onDidCreateSession.event;

	private readonly _onDidCloseSession = new Emitter<string>();
	readonly onDidCloseSession = this._onDidCloseSession.event;

	createSession(providerId: string): IServerChatSession {
		const id = `chat-${this._nextId++}`;
		const session: IServerChatSession = { id, providerId };
		this._sessions.set(id, session);
		this._onDidCreateSession.fire(session);
		return session;
	}

	closeSession(id: string): void {
		this._sessions.delete(id);
		this._onDidCloseSession.fire(id);
	}

	getSession(id: string): IServerChatSession | undefined {
		return this._sessions.get(id);
	}

	getSessions(): IServerChatSession[] {
		return Array.from(this._sessions.values());
	}

	revealSession(_id: string): void {}
}
