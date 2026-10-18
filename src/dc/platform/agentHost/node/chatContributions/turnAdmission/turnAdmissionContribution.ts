/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../log/common/log.js';
import { type IAgentHostChatContribution, type IAgentHostChatContributionContext, type IIncomingRequest, type IncomingRequestDisposition } from '../../../common/agentHostChatContributionsService.js';
import { isChatReadOnly, SessionStatus } from '../../../common/state/sessionState.js';
import { AgentHostStateManager, IAgentHostStateManager } from '../../agentHostStateManager.js';

export class TurnAdmissionContribution extends Disposable implements IAgentHostChatContribution {

	static readonly id = 'turnAdmission';
	readonly order = 100;

	constructor(
		protected readonly _context: IAgentHostChatContributionContext,
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	onIncomingRequest(request: IIncomingRequest): IncomingRequestDisposition | undefined {
		const chatState = this._stateManager.getChatState(request.chat);
		const sessionStatus = this._stateManager.getSessionSummary(request.session)?.status ?? 0;
		const sessionArchived = (sessionStatus & SessionStatus.IsArchived) === SessionStatus.IsArchived;
		if (isChatReadOnly(chatState?.interactivity, sessionArchived)) {
			const error = sessionArchived
				? { errorType: 'archived', message: 'This session is archived and read-only. Restore the session to continue the conversation.' }
				: { errorType: 'readOnly', message: 'This chat is read-only.' };
			this._logService.warn(`[TurnAdmissionContribution] Rejecting turn on read-only chat=${request.chat} (archived=${sessionArchived}), turnId=${request.turnId}`);
			return { kind: 'reject', error, stage: 'validation' };
		}
		return undefined;
	}
}
