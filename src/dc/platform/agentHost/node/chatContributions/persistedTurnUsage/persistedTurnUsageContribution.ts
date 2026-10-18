/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IReference } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILogService } from '../../../../log/common/log.js';
import type { IAgentHostChatContribution, IAgentHostChatContributionContext, IHydrationContext, IDispatchedAction } from '../../../common/agentHostChatContributionsService.js';
import { ISessionDatabase, ISessionDataService } from '../../../common/sessionDataService.js';
import { ActionType, isChatAction, type ChatAction } from '../../../common/state/sessionActions.js';
import { chatStorageUri, hasReportedUsage, isAhpChatChannel, isSubagentChatUri, type Turn, type URI as ProtocolURI, type UsageInfo } from '../../../common/state/sessionState.js';

export class PersistedTurnUsageContribution extends Disposable implements IAgentHostChatContribution {

	static readonly id = 'persistedTurnUsage';
	readonly order = 100;

	constructor(
		protected readonly _context: IAgentHostChatContributionContext,
		@ILogService private readonly _logService: ILogService,
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
	) {
		super();
	}

	onDidDispatchAction(dispatched: IDispatchedAction): void {
		if (dispatched.rejectionReason !== undefined) {
			return;
		}
		if (isAhpChatChannel(dispatched.channel) && isChatAction(dispatched.action)) {
			this._trackTurnUsage(dispatched.channel, dispatched.action);
		}
	}

	async onHydrateTurns(context: IHydrationContext, turns: readonly Turn[]): Promise<readonly Turn[]> {
		const chat = URI.parse(context.chat);
		if (turns.length === 0 || turns.every(turn => hasReportedUsage(turn.usage)) || isSubagentChatUri(chat.toString())) {
			return turns;
		}
		const storage = chatStorageUri(chat);
		if (!storage) {
			return turns;
		}
		let usages: Map<string, string>;
		const ref = await this._sessionDataService.tryOpenDatabase(storage);
		if (!ref) {
			return turns;
		}
		try {
			usages = await ref.object.getTurnUsages();
			this._logService.trace(`[AgentService] getTurnUsages done: ${usages.size} row(s) for ${storage.toString()}`);
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to read persisted turn usage for ${storage.toString()}`, err);
			return turns;
		} finally {
			ref.dispose();
		}
		if (usages.size === 0) {
			return turns;
		}
		return turns.map(turn => {
			const raw = hasReportedUsage(turn.usage) ? undefined : usages.get(turn.id);
			if (!raw) {
				return turn;
			}
			try {
				const parsed: unknown = JSON.parse(raw);
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					return turn;
				}
				const persisted = parsed as UsageInfo;
				const meta = { ...turn.usage?._meta, ...persisted._meta };
				return {
					...turn,
					usage: {
						...turn.usage,
						...persisted,
						...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
					},
				};
			} catch {
				return turn;
			}
		});
	}

	private _trackTurnUsage(channel: ProtocolURI, action: ChatAction): void {
		if (action.type !== ActionType.ChatUsage || isSubagentChatUri(channel)) {
			return;
		}
		if (!action.turnId) {
			return;
		}
		const storage = chatStorageUri(channel);
		if (!storage) {
			return;
		}
		let ref: IReference<ISessionDatabase>;
		try {
			ref = this._sessionDataService.openDatabase(storage);
		} catch (err) {
			this._logService.warn(`[AgentSideEffects] Failed to open database to persist turn usage for ${channel}`, err);
			return;
		}
		ref.object.setTurnUsage(action.turnId, JSON.stringify(action.usage)).catch(err => {
			this._logService.warn(`[AgentSideEffects] Failed to persist turn usage for ${channel}/${action.turnId}`, err);
		}).finally(() => ref.dispose());
	}
}
