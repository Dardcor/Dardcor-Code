/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, IDisposable } from '../../../base/common/lifecycle.js';
import { type AgentSelection, type ModelSelection } from '../common/state/protocol/state.js';

export interface IPersistedChat {
	readonly sdkSessionId: string;
	readonly model?: ModelSelection;
	readonly agent?: AgentSelection;
}

export interface IResolvedAgentChat<TSession extends IDisposable> {
	readonly chatSession: TSession;
	readonly isDefault: boolean;
}

export function encodeProviderData(backing: IPersistedChat): string {
	return JSON.stringify(backing);
}

export function decodeProviderData(providerData: string): IPersistedChat | undefined {
	try {
		const value = JSON.parse(providerData) as { sdkSessionId?: unknown; model?: unknown; agent?: unknown };
		if (!value || typeof value !== 'object') {
			return undefined;
		}
		const { sdkSessionId } = value;
		if (typeof sdkSessionId !== 'string' || !sdkSessionId) {
			return undefined;
		}
		const validModel = isModelSelection(value.model) ? value.model : undefined;
		const validAgent = isAgentSelection(value.agent) ? value.agent : undefined;
		return {
			sdkSessionId,
			...(validModel ? { model: validModel } : {}),
			...(validAgent ? { agent: validAgent } : {}),
		};
	} catch {
		return undefined;
	}
}

function isModelSelection(value: unknown): value is ModelSelection {
	return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';
}

function isAgentSelection(value: unknown): value is AgentSelection {
	return !!value && typeof value === 'object' && typeof (value as { uri?: unknown }).uri === 'string';
}

export class AgentSessionEntry<TSession extends IDisposable> extends Disposable {
	private readonly _chats = this._register(new DisposableMap<string, AgentSessionEntry<TSession>>());
	private _defaultChatKey: string | undefined;
	private _ownSession: TSession | undefined;

	constructor(session?: TSession) {
		super();
		if (session) {
			this._ownSession = session;
			this._register(session);
		}
	}

	get ownSession(): TSession | undefined {
		return this._ownSession;
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}


	setDefaultChat(chatKey: string, entry: AgentSessionEntry<TSession>): void {
		this._chats.set(chatKey, entry);
		this._defaultChatKey = chatKey;
	}

	clearDefaultChat(): void {
		if (this._defaultChatKey !== undefined) {
			this._chats.deleteAndDispose(this._defaultChatKey);
			this._defaultChatKey = undefined;
		}
	}

	get defaultChat(): TSession | undefined {
		return this._defaultChatKey !== undefined ? this._chats.get(this._defaultChatKey)?.ownSession : undefined;
	}

	getChat(chatKey: string): TSession | undefined {
		return this._chats.get(chatKey)?.ownSession;
	}

	resolveChat(chatKey: string): IResolvedAgentChat<TSession> | undefined {
		const chatSession = this._chats.get(chatKey)?.ownSession;
		if (!chatSession) {
			return undefined;
		}
		return { chatSession, isDefault: chatKey === this._defaultChatKey };
	}

	allChatSessions(): TSession[] {
		const sessions: TSession[] = [];
		for (const entry of this._chats.values()) {
			if (entry.ownSession) {
				sessions.push(entry.ownSession);
			}
		}
		return sessions;
	}


	getPeerChat(chatKey: string): TSession | undefined {
		return chatKey === this._defaultChatKey ? undefined : this._chats.get(chatKey)?.ownSession;
	}

	hasPeerChat(chatKey: string): boolean {
		return chatKey !== this._defaultChatKey && this._chats.has(chatKey);
	}

	registerPeerChat(chatKey: string, entry: AgentSessionEntry<TSession>): void {
		this._chats.set(chatKey, entry);
	}

	disposePeerChat(chatKey: string): void {
		if (chatKey !== this._defaultChatKey) {
			this._chats.deleteAndDispose(chatKey);
		}
	}

	peerChatKeys(): string[] {
		return [...this._chats.keys()].filter(key => key !== this._defaultChatKey);
	}

	peerChatSessions(): TSession[] {
		const sessions: TSession[] = [];
		for (const key of this._chats.keys()) {
			if (key === this._defaultChatKey) {
				continue;
			}
			const session = this._chats.get(key)?.ownSession;
			if (session) {
				sessions.push(session);
			}
		}
		return sessions;
	}
}
