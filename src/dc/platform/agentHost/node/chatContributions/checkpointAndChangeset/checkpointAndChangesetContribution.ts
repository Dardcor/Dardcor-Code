/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../log/common/log.js';
import { IAgentHostCheckpointService } from '../../../common/agentHostCheckpointService.js';
import { IAgentHostChangesetService } from '../../../common/agentHostChangesetService.js';
import type { IAgentHostChatContribution, IAgentHostChatContributionContext, ITurnEnd } from '../../../common/agentHostChatContributionsService.js';
import { IAgentConfigurationService } from '../../agentConfigurationService.js';
import { URI } from '../../../../../base/common/uri.js';

export class CheckpointAndChangesetContribution extends Disposable implements IAgentHostChatContribution {

	static readonly id = 'checkpointAndChangeset';
	readonly order = 100;

	constructor(
		protected readonly _context: IAgentHostChatContributionContext,
		@ILogService private readonly _logService: ILogService,
		@IAgentHostCheckpointService private readonly _checkpointService: IAgentHostCheckpointService,
		@IAgentHostChangesetService private readonly _changesets: IAgentHostChangesetService,
		@IAgentConfigurationService private readonly _agentConfigService: IAgentConfigurationService,
	) {
		super();
	}

	onTurnEnd(turn: ITurnEnd): void {
		if (turn.reason.kind !== 'success' && turn.reason.kind !== 'error') {
			return;
		}
		if (turn.reason.kind === 'error' && turn.reason.resumable) {
			return;
		}
		if (turn.turnId === undefined) {
			this._changesets.onTurnComplete(turn.session, turn.turnId, turn.clientContext);
			return;
		}

		const workingDirectories = this._agentConfigService.getEffectiveWorkingDirectories(turn.session)?.map(w => URI.parse(w));
		this._checkpointService.captureTurnCheckpoint(URI.parse(turn.session), URI.parse(turn.channel), turn.turnId, workingDirectories).then(() => {
			this._changesets.onTurnComplete(turn.session, turn.turnId, turn.clientContext);
		}, err => {
			if (turn.reason.kind === 'success') {
				this._logService.warn(`[AgentSideEffects] Turn checkpoint capture failed for ${turn.session}/${turn.turnId}: ${err instanceof Error ? err.message : String(err)}`);
			}
			this._changesets.onTurnComplete(turn.session, turn.turnId, turn.clientContext);
		});
	}
}
