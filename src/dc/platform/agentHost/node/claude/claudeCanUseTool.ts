/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { URI } from '../../../../base/common/uri.js';
import type { IAgentServerToolHost } from '../../common/agentServerTools.js';
import { ClaudePermissionMode, ClaudeSessionConfigKey } from '../../common/claudeSessionConfigKeys.js';
import { ChatInputRequestPurpose, withChatInputRequestPurpose } from '../../common/meta/agentChatInputRequestMeta.js';
import { ChatInputResponseKind, ToolCallPendingConfirmationState, ToolCallStatus } from '../../common/state/protocol/state.js';
import { IAgentConfigurationService } from '../agentConfigurationService.js';
import { getServerToolDisplay } from '../shared/serverToolGroups.js';
import { ClaudeAgentSession } from './claudeAgentSession.js';
import { extractServerToolName } from './claudeServerToolMcpServer.js';
import { buildAskUserSessionInputQuestions, buildExitPlanModeConfirmationState, flattenAskUserAnswers, parseAskUserQuestionInput } from './claudeInteractiveTools.js';
import { CLAUDE_PLAN_DECLINED_MESSAGE, CLAUDE_QUESTION_CANCELLED_MESSAGE, CLAUDE_USER_DECLINED_MESSAGE } from './claudeToolDenial.js';
import { getClaudeConfirmationTitle, getClaudeInvocationMessage, getClaudePermissionKind, getClaudeToolDisplayName, getClaudeToolInputString, getClaudeToolPath, INTERACTIVE_CLAUDE_TOOLS, buildClaudeToolMeta } from './claudeToolDisplay.js';

export interface IClaudeCanUseToolDeps {
	readonly getSession: (sessionId: string) => ClaudeAgentSession | undefined;
	readonly configurationService: IAgentConfigurationService;
	readonly configurationResource: URI;
	readonly serverToolHost: IAgentServerToolHost | undefined;
}

export interface IClaudeCanUseToolOptions {
	readonly suggestions?: PermissionUpdate[];
	readonly signal: AbortSignal;
	readonly blockedPath?: string;
	readonly toolUseID: string;
	readonly requestId: string;
	readonly agentID?: string;
}

export async function handleCanUseTool(
	deps: IClaudeCanUseToolDeps,
	sessionId: string,
	toolName: string,
	input: Record<string, unknown>,
	options: IClaudeCanUseToolOptions,
): Promise<PermissionResult> {
	const session = deps.getSession(sessionId);
	if (!session) {
		return { behavior: 'deny', message: 'Session is no longer active' };
	}

	if (options.signal.aborted) {
		return { behavior: 'deny', message: 'SDK aborted the tool request' };
	}
	const abortHandler = () => {
		session.respondToPermissionRequest(options.toolUseID, false);
		session.respondToUserInputRequest(options.toolUseID, ChatInputResponseKind.Cancel);
	};
	options.signal.addEventListener('abort', abortHandler);
	try {
		return await dispatchCanUseTool(deps, session, toolName, input, options);
	} finally {
		options.signal.removeEventListener('abort', abortHandler);
	}
}

async function dispatchCanUseTool(
	deps: IClaudeCanUseToolDeps,
	session: ClaudeAgentSession,
	toolName: string,
	input: Record<string, unknown>,
	options: IClaudeCanUseToolOptions,
): Promise<PermissionResult> {
	if (INTERACTIVE_CLAUDE_TOOLS.has(toolName)) {
		return handleInteractiveTool(deps, session, toolName, input, options);
	}

	const serverToolName = extractServerToolName(toolName);
	const serverToolHost = deps.serverToolHost;
	if (serverToolName
		&& serverToolHost?.toolNames.includes(serverToolName)
		&& !serverToolHost.requiresConfirmation(session.chatChannelUri.toString(), serverToolName)
	) {
		return { behavior: 'allow', updatedInput: input };
	}

	const permissionKind = getClaudePermissionKind(toolName);
	const displayName = getClaudeToolDisplayName(toolName);
	const permissionPath = options.blockedPath ?? getClaudeToolPath(toolName, input);
	const serverDisplay = serverToolName ? getServerToolDisplay(serverToolName, input) : undefined;
	const toolInputString = serverDisplay?.hideConfirmationInput ? undefined : getClaudeToolInputString(toolName, input);
	const meta = buildClaudeToolMeta(toolName);
	const state: ToolCallPendingConfirmationState = {
		status: ToolCallStatus.PendingConfirmation,
		toolCallId: options.toolUseID,
		toolName,
		displayName,
		invocationMessage: serverDisplay?.confirmationMessage ?? getClaudeInvocationMessage(toolName, displayName, input),
		toolInput: toolInputString,
		confirmationTitle: serverDisplay?.confirmationTitle ?? getClaudeConfirmationTitle(toolName),
		...(meta ? { _meta: meta } : {}),
	};

	const parentToolCallId = resolveSubagentParent(session, options);

	const approved = await session.requestPermission({
		toolUseID: options.toolUseID,
		state,
		permissionKind,
		...(permissionPath !== undefined ? { permissionPath } : {}),
		...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
	});
	return approved
		? { behavior: 'allow', updatedInput: input }
		: { behavior: 'deny', message: CLAUDE_USER_DECLINED_MESSAGE };
}

function resolveSubagentParent(
	session: ClaudeAgentSession,
	options: IClaudeCanUseToolOptions,
): string | undefined {
	if (!options.agentID) {
		return undefined;
	}
	const parentSpawn = session.subagents.getParentSpawn(options.toolUseID);
	if (parentSpawn) {
		parentSpawn.setAgentId(options.agentID);
		return parentSpawn.toolUseId;
	}
	return undefined;
}

function handleInteractiveTool(
	deps: IClaudeCanUseToolDeps,
	session: ClaudeAgentSession,
	toolName: string,
	input: Record<string, unknown>,
	options: IClaudeCanUseToolOptions,
): Promise<PermissionResult> {
	switch (toolName) {
		case 'ExitPlanMode':
			return handleExitPlanMode(deps, session, input, options);
		case 'AskUserQuestion':
			return handleAskUserQuestion(deps, session, input, options);
		default:
			return Promise.resolve({ behavior: 'deny', message: `Unsupported interactive tool: ${toolName}` });
	}
}

async function handleExitPlanMode(
	deps: IClaudeCanUseToolDeps,
	session: ClaudeAgentSession,
	input: Record<string, unknown>,
	options: IClaudeCanUseToolOptions,
): Promise<PermissionResult> {
	const toolUseID = options.toolUseID;
	const parentToolCallId = resolveSubagentParent(session, options);
	const approved = await session.requestPermission({
		toolUseID,
		state: buildExitPlanModeConfirmationState(input, toolUseID),
		permissionKind: getClaudePermissionKind('ExitPlanMode'),
		...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
	});
	if (approved) {
		deps.configurationService.updateSessionConfig(deps.configurationResource.toString(), {
			[ClaudeSessionConfigKey.PermissionMode]: 'acceptEdits' satisfies ClaudePermissionMode,
		});
		return { behavior: 'allow', updatedInput: input };
	}
	return { behavior: 'deny', message: CLAUDE_PLAN_DECLINED_MESSAGE };
}

async function handleAskUserQuestion(
	deps: IClaudeCanUseToolDeps,
	session: ClaudeAgentSession,
	input: Record<string, unknown>,
	options: IClaudeCanUseToolOptions,
): Promise<PermissionResult> {
	const toolUseID = options.toolUseID;
	const askInput = parseAskUserQuestionInput(input);
	if (!askInput) {
		return { behavior: 'deny', message: 'AskUserQuestion called without questions' };
	}

	const parentToolCallId = resolveSubagentParent(session, options);
	const answer = await session.requestUserInput(withChatInputRequestPurpose({
		id: toolUseID,
		questions: buildAskUserSessionInputQuestions(askInput),
	}, ChatInputRequestPurpose.AskUser), parentToolCallId);
	if (answer.response !== ChatInputResponseKind.Accept || !answer.answers) {
		return { behavior: 'deny', message: CLAUDE_QUESTION_CANCELLED_MESSAGE };
	}

	const answers = flattenAskUserAnswers(askInput, answer.answers);
	if (Object.keys(answers).length === 0) {
		return { behavior: 'deny', message: CLAUDE_QUESTION_CANCELLED_MESSAGE };
	}
	return { behavior: 'allow', updatedInput: { ...input, answers } };
}
