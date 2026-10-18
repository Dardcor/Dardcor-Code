/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ActionType } from '../../../common/state/sessionActions.js';
import { SessionStatus } from '../../../common/state/sessionState.js';
import type { IAgentHostChatContribution, IAgentHostChatContributionContext, ITurnEnd } from '../../../common/agentHostChatContributionsService.js';
import { AgentHostStateManager, IAgentHostStateManager } from '../../agentHostStateManager.js';

export class MarkUnreadContribution extends Disposable implements IAgentHostChatContribution {

	static readonly id = 'markUnread';
	readonly order = 500;

	constructor(
		protected readonly _context: IAgentHostChatContributionContext,
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
	) {
		super();
	}

	onTurnEnd(turn: ITurnEnd): void {
		if (turn.reason.kind === 'localCommand' || turn.reason.kind === 'rejected') {
			return;
		}
		const status = this._stateManager.getSessionSummary(turn.session)?.status ?? 0;
		if (!(status & SessionStatus.IsRead)) {
			return;
		}
		this._stateManager.dispatchServerAction(turn.session, { type: ActionType.SessionIsReadChanged, isRead: false });
	}
}
