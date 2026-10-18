/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mark, clearMarks } from '../../../../base/common/performance.js';
import { URI } from '../../../../base/common/uri.js';
import { chatSessionResourceToId } from './model/chatUri.js';

const chatPerfPrefix = 'code/chat/';

const chatMarksBySession = new Map<string, Set<string>>();

/**
 * Well-defined perf scenarios for chat request lifecycle.
 * Each mark is a boundary of a measurable scenario — don't add marks
 * without defining what scenario they belong to.
 *
 * ## Scenarios
 *
 * **Time to UI Feedback** (perceived input lag):
 *   `request/start` → `request/uiUpdated`
 *
 * **Instruction Collection Overhead**:
 *   `request/willCollectInstructions` → `request/didCollectInstructions`
 *
 * **Extension Activation Wait** (first-request cold start):
 *   `code/chat/willWaitForActivation` → `code/chat/didWaitForActivation`
 *   (global marks, not session-scoped — emitted via {@link markChatGlobal})
 *
 * **Time to First Token** (the headline metric):
 *   `request/start` → `request/firstToken`
 *
 * **Total Request Duration**:
 *   `request/start` → `request/complete`
 *
 * **Agent Invocation Time** (LLM round-trip):
 *   `agent/willInvoke` → `agent/didInvoke`
 */
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

/**
 * Well-defined one-time global perf marks (not scoped to a session).
 * These are emitted via {@link markChatGlobal} and are never cleared.
 */
export const ChatGlobalPerfMark = {
	WillWaitForActivation: 'willWaitForActivation',
	DidWaitForActivation: 'didWaitForActivation',
} as const;

export function markChatGlobal(name: string): void {
	mark(`${chatPerfPrefix}${name}`);
}
