/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import type { CustomizationEnablementResolution, IAgentHostCustomizationEnablementService } from '../../node/agentHostCustomizationEnablementService.js';

export function createNoopCustomizationEnablementService(): IAgentHostCustomizationEnablementService {
	const resolution: CustomizationEnablementResolution = {
		kind: 'resolved',
		enablement: [],
		enabled: true,
		workingDirectory: { kind: 'workspaceless' },
	};
	return {
		_serviceBrand: undefined,
		onDidChange: Event.None,
		initializeSession: async () => { },
		getWorkingDirectoryState: () => ({ kind: 'workspaceless' }),
		resolve: () => resolution,
		applyClientGlobalEnablement: () => resolution,
		replaceEnablement: () => resolution,
		setEnablement: () => resolution,
		whenIdle: async () => { },
	};
}
