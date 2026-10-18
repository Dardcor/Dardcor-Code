/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IReference } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import type { ILocalTurnRecord, ISessionDatabase, ISessionDataService } from '../common/sessionDataService.js';
import type { Turn } from '../common/state/sessionState.js';

export const IAgentHostLocalTurns = createDecorator<IAgentHostLocalTurns>('agentHostLocalTurns');

export interface IAgentHostLocalTurns {
	readonly _serviceBrand: undefined;

	isLocal(chat: string, turnId: string): boolean;
	findAnchorTurnId(chat: string, turns: readonly Turn[], turnId: string): string | undefined;
	record(session: string, chat: string, turn: Turn, anchorTurnId: string | undefined): void;
}

export class AgentHostLocalTurns implements IAgentHostLocalTurns {
	declare readonly _serviceBrand: undefined;

	private readonly _byChat = new Map<string, Map<string, { readonly anchorTurnId: string | undefined; readonly seq: number }>>();

	private readonly _seqBySession = new Map<string, number>();

	constructor(
		private readonly _sessionDataService: ISessionDataService,
		private readonly _logService: ILogService,
	) { }

	isLocal(chat: string, turnId: string): boolean {
		return this._byChat.get(chat)?.has(turnId) ?? false;
	}

	getLocalTurnIds(chat: string): string[] {
		const map = this._byChat.get(chat);
		return map ? [...map.keys()] : [];
	}

	resolveConcreteTurnId(chat: string, turnId: string): string | undefined {
		const entry = this._byChat.get(chat)?.get(turnId);
		return entry ? entry.anchorTurnId : turnId;
	}

	record(session: string, chat: string, turn: Turn, anchorTurnId: string | undefined): void {
		const seq = (this._seqBySession.get(session) ?? 0) + 1;
		this._noteInMemory(session, chat, turn.id, anchorTurnId, seq);
		const record: ILocalTurnRecord = { turnId: turn.id, chatUri: chat, anchorTurnId, seq, payload: JSON.stringify(turn) };
		let ref: IReference<ISessionDatabase>;
		try {
			ref = this._sessionDataService.openDatabase(URI.parse(session));
		} catch (err) {
			this._logService.warn(`[AgentHostLocalTurns] Failed to open database to persist local turn ${turn.id}`, err);
			return;
		}
		ref.object.insertLocalTurn(record).catch(err => {
			this._logService.warn(`[AgentHostLocalTurns] Failed to persist local turn ${turn.id}`, err);
		}).finally(() => ref.dispose());
	}

	findAnchorTurnId(chat: string, turns: readonly Turn[], turnId: string): string | undefined {
		for (let i = turns.findIndex(turn => turn.id === turnId) - 1; i >= 0; i--) {
			if (!this.isLocal(chat, turns[i].id)) {
				return turns[i].id;
			}
		}
		return undefined;
	}

	async loadForChat(session: string, chat: string): Promise<ILocalTurnRecord[]> {
		const records = await this._load(session);
		return records.filter(r => r.chatUri === chat);
	}

	noteInMemory(session: string, chat: string, turnId: string, anchorTurnId: string | undefined, seq: number): void {
		this._noteInMemory(session, chat, turnId, anchorTurnId, seq);
	}

	deleteLocals(session: string, turnIds: readonly string[]): void {
		if (turnIds.length === 0) {
			return;
		}
		const idSet = new Set(turnIds);
		for (const map of this._byChat.values()) {
			for (const id of idSet) {
				map.delete(id);
			}
		}
		let ref: IReference<ISessionDatabase>;
		try {
			ref = this._sessionDataService.openDatabase(URI.parse(session));
		} catch (err) {
			this._logService.warn(`[AgentHostLocalTurns] Failed to open database to delete local turns for ${session}`, err);
			return;
		}
		ref.object.deleteLocalTurns(turnIds).catch(err => {
			this._logService.warn(`[AgentHostLocalTurns] Failed to delete local turns for ${session}`, err);
		}).finally(() => ref.dispose());
	}

	forgetChat(chat: string): void {
		this._byChat.delete(chat);
	}

	private async _load(session: string): Promise<ILocalTurnRecord[]> {
		const ref = this._sessionDataService.tryOpenDatabase?.(URI.parse(session));
		if (!ref) {
			return [];
		}
		try {
			const db = await ref;
			if (!db) {
				return [];
			}
			try {
				const records = await db.object.getLocalTurns();
				for (const r of records) {
					this._noteInMemory(session, r.chatUri, r.turnId, r.anchorTurnId, r.seq);
				}
				return records;
			} finally {
				db.dispose();
			}
		} catch (err) {
			this._logService.warn(`[AgentHostLocalTurns] Failed to load local turns for ${session}`, err);
			return [];
		}
	}

	private _noteInMemory(session: string, chat: string, turnId: string, anchorTurnId: string | undefined, seq: number): void {
		let map = this._byChat.get(chat);
		if (!map) {
			map = new Map();
			this._byChat.set(chat, map);
		}
		map.set(turnId, { anchorTurnId, seq });
		this._seqBySession.set(session, Math.max(this._seqBySession.get(session) ?? 0, seq));
	}
}
