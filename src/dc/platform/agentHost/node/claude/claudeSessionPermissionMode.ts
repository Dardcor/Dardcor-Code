/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from '../../../../base/common/uri.js';
import { type ClaudePermissionMode, ClaudeSessionConfigKey, narrowClaudePermissionMode } from '../../common/claudeSessionConfigKeys.js';
import type { IAgentConfigurationService } from '../agentConfigurationService.js';

export function readClaudePermissionMode(
	configurationService: IAgentConfigurationService,
	sessionUri: URI,
): ClaudePermissionMode | undefined {
	return narrowClaudePermissionMode(
		configurationService.getSessionConfigValues(sessionUri.toString())?.[ClaudeSessionConfigKey.PermissionMode],
	);
}
