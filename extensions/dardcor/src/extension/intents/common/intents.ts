/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defaultAgentName, editingSessionAgentName, editorAgentName, editsAgentName, getChatParticipantNameFromId, terminalAgentName, vscodeAgentName } from '../../../platform/chat/common/chatAgents';

export function participantIdToModeName(participantId: string): string {
	const name = getChatParticipantNameFromId(participantId);

	switch (name) {
		case defaultAgentName:
		case vscodeAgentName:
		case 'terminalPanel':
			return 'ask';
		case editsAgentName:
			return 'agent';
		case editingSessionAgentName:
			return 'edit';
		case editorAgentName:
		case terminalAgentName:
		default:
			return 'inline';
	}
}
