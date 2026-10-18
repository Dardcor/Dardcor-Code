/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { chatSummaryFromState, MessageKind, ResponsePartKind, SessionStatus, ToolCallConfirmationReason, ToolCallStatus, type ChatState, type ResponsePart, type ToolCallState } from '../../../common/state/sessionState.js';

function pendingToolCall(toolCallId: string, autoApprove: boolean): ResponsePart {
	const toolCall: ToolCallState = {
		status: ToolCallStatus.PendingConfirmation,
		toolCallId,
		toolName: 'browser_navigate',
		displayName: 'Navigate Browser',
		invocationMessage: 'Navigate',
		confirmationTitle: 'Navigate',
		...(autoApprove ? { _meta: { autoApproveBySetting: true } } : {}),
	};
	return { kind: ResponsePartKind.ToolCall, toolCall };
}

function pendingResultToolCall(toolCallId: string, autoApprove: boolean): ResponsePart {
	const toolCall: ToolCallState = {
		status: ToolCallStatus.PendingResultConfirmation,
		toolCallId,
		toolName: 'browser_navigate',
		displayName: 'Navigate Browser',
		invocationMessage: 'Navigate',
		confirmed: ToolCallConfirmationReason.Setting,
		success: true,
		pastTenseMessage: 'Navigated',
		...(autoApprove ? { _meta: { autoApproveBySetting: true } } : {}),
	};
	return { kind: ResponsePartKind.ToolCall, toolCall };
}

function chatState(status: SessionStatus, parts: ResponsePart[]): ChatState {
	return {
		resource: 'agent-host-copilot:/session-1',
		title: 'Chat',
		status,
		modifiedAt: '2024-01-01T00:00:00.000Z',
		turns: [],
		activeTurn: { id: 'turn-1', startedAt: '2024-01-01T00:00:00.000Z', message: { text: 'go', origin: { kind: MessageKind.User } }, responseParts: parts, usage: undefined },
	};
}

function restoredChatState(status: SessionStatus): ChatState {
	return {
		resource: 'agent-host-copilot:/session-1',
		title: 'Chat',
		status,
		modifiedAt: '2024-01-01T00:00:00.000Z',
		turns: [],
		activeTurn: undefined,
	};
}

suite('chatSummaryFromState status projection', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('demotes InputNeeded to InProgress when caused solely by auto-approved confirmations', () => {
		const state = chatState(SessionStatus.InputNeeded | SessionStatus.IsRead, [pendingToolCall('tc-auto', true)]);
		assert.strictEqual(chatSummaryFromState(state).status, SessionStatus.InProgress | SessionStatus.IsRead);
	});

	test('keeps InputNeeded for a genuine (non-auto-approved) confirmation', () => {
		const state = chatState(SessionStatus.InputNeeded, [pendingToolCall('tc-user', false)]);
		assert.strictEqual(chatSummaryFromState(state).status, SessionStatus.InputNeeded);
	});

	test('keeps InputNeeded when a genuine confirmation coexists with an auto-approved one', () => {
		const state = chatState(SessionStatus.InputNeeded, [pendingToolCall('tc-auto', true), pendingToolCall('tc-user', false)]);
		assert.strictEqual(chatSummaryFromState(state).status, SessionStatus.InputNeeded);
	});

	test('leaves non-InputNeeded statuses untouched', () => {
		const state = chatState(SessionStatus.InProgress, [pendingToolCall('tc-auto', true)]);
		assert.strictEqual(chatSummaryFromState(state).status, SessionStatus.InProgress);
	});

	test('keeps InputNeeded for a result confirmation even when the call was auto-approved', () => {
		const state = chatState(SessionStatus.InputNeeded, [pendingResultToolCall('tc-auto', true)]);
		assert.strictEqual(chatSummaryFromState(state).status, SessionStatus.InputNeeded);
	});

	test('preserves InputNeeded for a restored chat with no loaded active turn', () => {
		const state = restoredChatState(SessionStatus.InputNeeded);
		assert.strictEqual(chatSummaryFromState(state).status, SessionStatus.InputNeeded);
	});
});
