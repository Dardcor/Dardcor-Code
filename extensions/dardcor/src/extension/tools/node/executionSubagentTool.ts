/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ChatFetchResponseType } from '../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { CapturingToken } from '../../../platform/requestLogger/common/capturingToken';
import { IRequestLogger } from '../../../platform/requestLogger/common/requestLogger';
import { getCurrentCapturingToken } from '../../../platform/requestLogger/node/requestLogger';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ChatResponseStreamImpl } from '../../../util/common/chatResponseStreamImpl';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ChatResponseNotebookEditPart, ChatResponseTextEditPart, ChatToolInvocationPart, ExtendedLanguageModelToolResult, LanguageModelTextPart, MarkdownString } from '../../../dardcorTypes';
import { Conversation, Turn } from '../../prompt/common/conversation';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { ExecutionSubagentToolCallingLoop, IBackgroundCommand } from '../../prompt/node/executionSubagentToolCallingLoop';
import { ToolName } from '../common/toolNames';
import { AgentToolMode, IAgentTool, ToolRegistry } from '../common/toolsRegistry';
import { stripFinalAnswerTags, updateSubagentInvocation } from './subagentToolUtils';

export interface IExecutionSubagentParams {

	query: string;
	description: string;
}

class ExecutionSubagentTool implements IAgentTool<IExecutionSubagentParams> {
	public static readonly toolName = ToolName.ExecutionSubagent;
	public static readonly nonDeferred = true;
	private _inputContext: IBuildPromptContext | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IRequestLogger private readonly requestLogger: IRequestLogger,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IExperimentationService private readonly experimentationService: IExperimentationService
	) { }
	async invoke(options: vscode.LanguageModelToolInvocationOptions<IExecutionSubagentParams>, token: vscode.CancellationToken) {
		const executionInstruction = [
			'Execution query: ',
			`${options.input.query}`,
			'',
		].join('\n');

		if (!this._inputContext) {
			throw new Error('ExecutionSubagentTool: _inputContext is not set. Ensure resolveInput is called before invoke.');
		}

		const request = this._inputContext.request!;
		const parentSessionId = this._inputContext.conversation?.sessionId ?? generateUuid();
		const parentToolCallId = options.chatStreamToolCallId;
		const subAgentInvocationId = parentToolCallId ?? generateUuid();

		const toolCallLimit = this.configurationService.getExperimentBasedConfig(ConfigKey.Advanced.ExecutionSubagentToolCallLimit, this.experimentationService);

		const loop = this.instantiationService.createInstance(ExecutionSubagentToolCallingLoop, {
			toolCallLimit,
			conversation: new Conversation(parentSessionId, [new Turn(generateUuid(), { type: 'user', message: executionInstruction })]),
			request: request,
			location: request.location,
			promptText: options.input.query,
			subAgentInvocationId: subAgentInvocationId,
			parentToolCallId,
			parentHeaderRequestId: this._inputContext?.parentHeaderRequestId,
			parentModelCallId: this._inputContext?.parentModelCallId,
			topLevelTurnId: this._inputContext?.requestId,
		});

		const stream = this._inputContext?.stream && ChatResponseStreamImpl.filter(
			this._inputContext.stream,
			part => part instanceof ChatToolInvocationPart || part instanceof ChatResponseTextEditPart || part instanceof ChatResponseNotebookEditPart
		);
		const modelName = await loop.getModelName();
		updateSubagentInvocation(stream, parentToolCallId, ToolName.ExecutionSubagent, {
			description: options.input.description,
			agentName: 'execution',
			prompt: options.input.query,
			modelName,
		});

		const parentChatSessionId = getCurrentCapturingToken()?.chatSessionId ?? request.sessionId ?? parentSessionId;
		const executionSubagentToken = new CapturingToken(
			`Execution: ${options.input.query.substring(0, 50)}${options.input.query.length > 50 ? '...' : ''}`,
			'execution',
			subAgentInvocationId,
			'execution',
			subAgentInvocationId,
			parentChatSessionId,
			'executionSubagent',
		);

		const loopResult = await this.requestLogger.captureInvocation(executionSubagentToken, () => loop.run(stream, token));

		const toolMetadata = {
			query: options.input.query,
			description: options.input.description,
			subAgentInvocationId: subAgentInvocationId,
			agentName: 'execution',
			modelName,
		};

		let subagentResponse = '';
		if (loopResult.response.type === ChatFetchResponseType.Success) {
			subagentResponse = loopResult.toolCallRounds.at(-1)?.response ?? loopResult.round.response ?? '';
		} else {
			subagentResponse = `The execution subagent request failed with this message:\n${loopResult.response.type}: ${loopResult.response.reason}`;
		}

		subagentResponse = appendBackgroundCommandNotesToFinalAnswer(subagentResponse, loop.backgroundCommands);
		subagentResponse = stripFinalAnswerTags(subagentResponse);
		updateSubagentInvocation(stream, parentToolCallId, ToolName.ExecutionSubagent, {
			description: options.input.description,
			agentName: 'execution',
			prompt: options.input.query,
			modelName,
			result: subagentResponse,
		});

		const result = new ExtendedLanguageModelToolResult([new LanguageModelTextPart(subagentResponse)]);
		result.toolMetadata = toolMetadata;
		result.toolResultMessage = new MarkdownString(l10n.t`Execution complete: ${options.input.description}`);
		return result;
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IExecutionSubagentParams>, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: options.input.description,
		};
	}

	async resolveInput(input: IExecutionSubagentParams, promptContext: IBuildPromptContext, _mode: AgentToolMode): Promise<IExecutionSubagentParams> {
		this._inputContext = promptContext;
		return input;
	}
}

ToolRegistry.registerTool(ExecutionSubagentTool);

function appendBackgroundCommandNotesToFinalAnswer(
	response: string,
	backgroundCommands: readonly IBackgroundCommand[],
): string {
	if (backgroundCommands.length === 0) {
		return response;
	}

	const notes = backgroundCommands.map(c => {
		if (c.reason === 'timeout') {
			const timeoutText = c.timeoutMs !== undefined ? ` after ${c.timeoutMs} ms` : '';
			return `Note: The command \`${c.command}\` timed out${timeoutText}. It may still be running in terminal ID ${c.termId}.`;
		}
		if (c.reason === 'inputNeeded') {
			return `Note: The command \`${c.command}\` may be waiting for input in terminal ID ${c.termId}. Use send_to_terminal or get_terminal_output to check.`;
		}
		return `Note: The command \`${c.command}\` was started in the background. It may still be running in terminal ID ${c.termId}.`;
	}).join('\n');

	const closingTag = '</final_answer>';
	const closeIdx = response.lastIndexOf(closingTag);
	if (closeIdx === -1) {
		return response.length > 0 ? `${response}\n\n${notes}` : notes;
	}
	const insertAt = closeIdx + closingTag.length;
	const before = response.slice(0, insertAt);
	const after = response.slice(insertAt).replace(/^\s*/, '');
	return after.length > 0 ? `${before}\n${notes}\n${after}` : `${before}\n${notes}`;
}
