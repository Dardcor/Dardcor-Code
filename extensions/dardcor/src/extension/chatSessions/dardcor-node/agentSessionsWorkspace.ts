/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAgentSessionsWorkspace } from '../common/agentSessionsWorkspace';

export class AgentSessionsWorkspace implements IAgentSessionsWorkspace {
	declare _serviceBrand: undefined;
	get isAgentSessionsWorkspace(): boolean {
		return false;
	}
}
