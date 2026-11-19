/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IChatAutoModeResolutionPart } from './chatService/chatService.js';

export const HIDE_AUTO_EXPLAINABILITY_TREATMENT = 'copilotchat.hideAutoExplainability';

export function autoModeRoutingTitle(part: IChatAutoModeResolutionPart): string {
	return part.resolved
		? localize('autoMode.routedTo', "Auto routed task to {0}", part.resolved.name)
		: localize('autoMode.routing', "Auto routing task");
}
