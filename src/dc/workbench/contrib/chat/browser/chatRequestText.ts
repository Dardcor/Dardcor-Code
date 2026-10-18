/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatRequestViewModel } from '../common/model/chatViewModel.js';
import { getAgentMergeRequestLabel } from './widget/chatContentParts/chatAgentMergeContentPart.js';

export function getChatRequestText(item: IChatRequestViewModel): string {
	const agentMergeLabel = getAgentMergeRequestLabel(item);
	if (agentMergeLabel !== undefined) {
		return agentMergeLabel;
	}
	return item.messageText;
}
