/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mark, clearMarks } from '../../../../base/common/performance.js';
import { URI } from '../../../../base/common/uri.js';
import { chatSessionResourceToId } from './model/chatUri.js';

const chatPerfPrefix = 'code/chat/';

const chatMarksBySession = new Map<string, Set<string>>();



























export const ChatPerfMark = {
	RequestStart: 'request/start',
	RequestUiUpdated: 'request/uiUpdated',
	WillCollectInstructions: 'request/willCollectInstructions',
	DidCollectInstructions: 'request/didCollectInstructions',
	FirstToken: 'request/firstToken',
	RequestComplete: 'request/complete',
	AgentWillInvoke: 'agent/willInvoke',
	AgentDidInvoke: 'agent/didInvoke',
} as const;

export function markChat(sessionResource: URI, name: string): void {
	const sessionId = chatSessionResourceToId(sessionResource);
	const fullName = `${chatPerfPrefix}${sessionId}/${name}`;
	let names = chatMarksBySession.get(sessionId);
	if (!names) {
		names = new Set();
		chatMarksBySession.set(sessionId, names);
	}
	names.add(fullName);
	mark(fullName);
}

export function clearChatMarks(sessionResource: URI): void {
	const sessionId = chatSessionResourceToId(sessionResource);
	const names = chatMarksBySession.get(sessionId);
	if (names) {
		for (const name of names) {
			clearMarks(name);
		}
		chatMarksBySession.delete(sessionId);
	}
}





export const ChatGlobalPerfMark = {
	WillWaitForActivation: 'willWaitForActivation',
	DidWaitForActivation: 'didWaitForActivation',
} as const;

export function markChatGlobal(name: string): void {
	mark(`${chatPerfPrefix}${name}`);
}
