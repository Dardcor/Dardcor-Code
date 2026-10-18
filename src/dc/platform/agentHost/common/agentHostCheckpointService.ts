/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAgentHostCheckpointService = createDecorator<IAgentHostCheckpointService>('agentHostCheckpointService');

export function buildCheckpointRefName(sanitizedSessionId: string, turnNumber: number): string {
	return `refs/agents/${sanitizedSessionId}/checkpoints/turn/${turnNumber}`;
}

export interface IAgentHostCheckpointService {
	readonly _serviceBrand: undefined;

	captureBaselineCheckpoint(sessionUri: URI, workingDirectories: readonly URI[] | undefined): Promise<void>;

	captureTurnStartCheckpoint(sessionUri: URI, chatUri: URI, turnId: string, workingDirectories: readonly URI[] | undefined): Promise<void>;

	captureTurnCheckpoint(sessionUri: URI, chatUri: URI, turnId: string, workingDirectories: readonly URI[] | undefined): Promise<void>;

	discardTurnStartCheckpoint(sessionUri: URI, chatUri: URI, turnId: string): Promise<void>;

	discardChatTurnStartCheckpoints(sessionUri: URI, chatUri: URI): Promise<void>;

	getTurnCheckpointPair(sessionUri: URI, turnId: string, workingDirectory?: URI): Promise<{ parent: string; current: string } | undefined>;

	getBaselineCheckpoint(sessionUri: URI, workingDirectory?: URI): Promise<string | undefined>;

	deleteCheckpoints(sessionUri: URI, workingDirectories?: readonly string[]): Promise<void>;

	adoptLegacyCheckpoints?(sessionUri: URI, workingDirectory: URI, rawSessionId: string, turnIds: readonly string[]): Promise<void>;
}

export const NULL_CHECKPOINT_SERVICE: IAgentHostCheckpointService = {
	_serviceBrand: undefined,
	captureBaselineCheckpoint: async () => { },
	captureTurnStartCheckpoint: async () => { },
	captureTurnCheckpoint: async () => { },
	discardTurnStartCheckpoint: async () => { },
	discardChatTurnStartCheckpoints: async () => { },
	getTurnCheckpointPair: async () => undefined,
	getBaselineCheckpoint: async () => undefined,
	deleteCheckpoints: async () => { },
};
