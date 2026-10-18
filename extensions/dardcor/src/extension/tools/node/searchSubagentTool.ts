/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { BudgetExceededError } from '@vscode/prompt-tsx/dist/base/materialized';
import * as path from 'path';
import type * as vscode from 'vscode';
import { ChatFetchResponseType } from '../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { TextDocumentSnapshot } from '../../../platform/editing/common/textDocumentSnapshot';
import { CapturingToken } from '../../../platform/requestLogger/common/capturingToken';
import { IRequestLogger } from '../../../platform/requestLogger/common/requestLogger';
import { getCurrentCapturingToken } from '../../../platform/requestLogger/node/requestLogger';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { WorkingDirectory } from '../../../platform/workspace/common/workingDirectory';
import { ChatResponseStreamImpl } from '../../../util/common/chatResponseStreamImpl';
import { URI } from '../../../util/dardcor/base/common/uri';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ChatResponseNotebookEditPart, ChatResponseTextEditPart, ChatToolInvocationPart, ExtendedLanguageModelToolResult, LanguageModelTextPart, MarkdownString, Range } from '../../../dardcorTypes';
import { Conversation, Turn } from '../../prompt/common/conversation';
import { IBuildPromptContext } from '../../prompt/common/intents';
import type { IToolCallLoopResult } from '../../intents/node/toolCallingLoop';
import { SearchSubagentToolCallingLoop, isContextOverflowBadRequest } from '../../prompt/node/searchSubagentToolCallingLoop';
import { ToolName } from '../common/toolNames';
import { AgentToolMode, IAgentTool, IAgentToolCtor, ToolRegistry } from '../common/toolsRegistry';
import { stripFinalAnswerTags, updateSubagentInvocation } from './subagentToolUtils';
import { assertFileOkForTool, isFileExternalAndNeedsConfirmation } from './toolUtils';

export interface ISearchSubagentParams {

	query: string;
	description: string;
	details: string;
	thoroughness?: 'normal' | 'deep';
}

const THOROUGHNESS_MULTIPLIERS: Record<NonNullable<ISearchSubagentParams['thoroughness']>, number> = {
	normal: 1,
	deep: 2,
};

export const CONTEXT_OVERFLOW_FALLBACK = `<final_answer>\nThe search subagent was unable to complete this query because the accumulated search context exceeded the model's context window. Consider issuing a more focused query.\n</final_answer>`;

function computeToolCallLimitForThoroughness(baseLimit: number, thoroughness: NonNullable<ISearchSubagentParams['thoroughness']>): number {
	return Math.max(1, Math.round(baseLimit * THOROUGHNESS_MULTIPLIERS[thoroughness]));
}

export function mapLoopResponseToText(result: IToolCallLoopResult): string {
	if (result.response.type === ChatFetchResponseType.Success) {
		return result.toolCallRounds.at(-1)?.response ?? result.round.response ?? '';
	}
	if (isContextOverflowBadRequest(result.response)) {
		return CONTEXT_OVERFLOW_FALLBACK;
	}
	return `The search subagent request failed with this message:\n${result.response.type}: ${result.response.reason}`;
}

class SearchSubagentTool implements IAgentTool<ISearchSubagentParams> {
	public static readonly toolName = ToolName.SearchSubagent;
	public static readonly nonDeferred = true;
	protected readonly toolName: ToolName = ToolName.SearchSubagent;
	private _inputContext: IBuildPromptContext | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IRequestLogger private readonly requestLogger: IRequestLogger,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IExperimentationService private readonly experimentationService: IExperimentationService
	) { }

	alternativeDefinition(tool: vscode.LanguageModelToolInformation): vscode.LanguageModelToolInformation {
		const thoroughnessEnabled = this.configurationService.getExperimentBasedConfig(ConfigKey.Advanced.SearchSubagentThoroughnessEnabled, this.experimentationService);
		if (!thoroughnessEnabled) {
			return tool;
		}

		return {
			...tool,
			description: tool.description
				+ '\n- thoroughness (optional): Search thoroughness — \'normal\' (balanced and quick, sufficient for most cases) or \'deep\' (more turns, broader exploration; only use when normal is clearly not enough).',
			inputSchema: {
				...tool.inputSchema as Record<string, unknown>,
				properties: {
					...(tool.inputSchema as { properties: Record<string, unknown> }).properties,
					thoroughness: {
						type: 'string',
						enum: ['normal', 'deep'],
						description: 'Controls the search thoroughness and turn limit. \'normal\' is balanced and quick, sufficient for most searches. Only use \'deep\' when the task clearly requires broader exploration across many files.',
					},
				},
			},
		};
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchSubagentParams>, token: vscode.CancellationToken) {
		const workingDir = new WorkingDirectory(options.workingDirectory, this.workspaceService);
		const cwd = workingDir.getFolders()[0]?.fsPath;

		const searchInstruction = [
			`Find relevant code snippets for: ${options.input.query}`,
			'',
			...(cwd ? [`Current working directory: ${cwd}`, ''] : []),
			'More detailed instructions: ',
			`${options.input.details}`,
			'',
		].join('\n');

		const request = this._inputContext!.request!;
		const parentSessionId = this._inputContext?.conversation?.sessionId ?? generateUuid();
		const parentToolCallId = options.chatStreamToolCallId;
		const subAgentInvocationId = parentToolCallId ?? generateUuid();

		const toolCallLimit = this.configurationService.getExperimentBasedConfig(ConfigKey.Advanced.SearchSubagentToolCallLimit, this.experimentationService);
		const thoroughnessEnabled = this.configurationService.getExperimentBasedConfig(ConfigKey.Advanced.SearchSubagentThoroughnessEnabled, this.experimentationService);

		const effectiveToolCallLimit = thoroughnessEnabled && options.input.thoroughness
			? computeToolCallLimitForThoroughness(toolCallLimit, options.input.thoroughness)
			: toolCallLimit;

		const loop = this.instantiationService.createInstance(SearchSubagentToolCallingLoop, {
			toolCallLimit: effectiveToolCallLimit,
			conversation: new Conversation(parentSessionId, [new Turn(generateUuid(), { type: 'user', message: searchInstruction })]),
			request: request,
			location: request.location,
			promptText: options.input.query,
			subAgentInvocationId: subAgentInvocationId,
			parentToolCallId,
			parentHeaderRequestId: this._inputContext?.parentHeaderRequestId,
			parentModelCallId: this._inputContext?.parentModelCallId,
			topLevelTurnId: this._inputContext?.requestId,
			thoroughness: thoroughnessEnabled ? options.input.thoroughness : undefined,
		});

		const stream = this._inputContext?.stream && ChatResponseStreamImpl.filter(
			this._inputContext.stream,
			part => part instanceof ChatToolInvocationPart || part instanceof ChatResponseTextEditPart || part instanceof ChatResponseNotebookEditPart
		);
		const modelName = await loop.getModelName();
		updateSubagentInvocation(stream, parentToolCallId, this.toolName, {
			description: options.input.description,
			agentName: 'search',
			prompt: options.input.query,
			modelName,
		});

		const parentChatSessionId = getCurrentCapturingToken()?.chatSessionId ?? parentSessionId;
		const searchSubagentToken = new CapturingToken(
			`Search: ${options.input.query.substring(0, 50)}${options.input.query.length > 50 ? '...' : ''}`,
			'search',
			subAgentInvocationId,
			'search',
			subAgentInvocationId,
			parentChatSessionId,
			'searchSubagent',
		);

		const toolMetadata = {
			query: options.input.query,
			description: options.input.description,
			subAgentInvocationId: subAgentInvocationId,
			agentName: 'search',
			modelName,
		};

		let subagentResponse: string;
		try {
			const loopResult = await this.requestLogger.captureInvocation(searchSubagentToken, () => loop.run(stream, token));
			subagentResponse = mapLoopResponseToText(loopResult);
		} catch (err) {
			if (!(err instanceof BudgetExceededError)) {
				throw err;
			}
			subagentResponse = CONTEXT_OVERFLOW_FALLBACK;
		}
		const hydratedResponse = stripFinalAnswerTags(await this.parseFinalAnswerAndHydrate(subagentResponse, cwd, options.workingDirectory, token));
		updateSubagentInvocation(stream, parentToolCallId, this.toolName, {
			description: options.input.description,
			agentName: 'search',
			prompt: options.input.query,
			modelName,
			result: hydratedResponse,
		});

		const result = new ExtendedLanguageModelToolResult([new LanguageModelTextPart(hydratedResponse)]);
		result.toolMetadata = toolMetadata;
		result.toolResultMessage = new MarkdownString(l10n.t`Search complete: ${options.input.description}`);
		return result;
	}

	private async parseFinalAnswerAndHydrate(response: string, cwd: string | undefined, workingDirectory: URI | undefined, token: vscode.CancellationToken): Promise<string> {
		const lines = response.split('\n');

		const fileRangePattern = /^(.+):(\d+)-(\d+)$/;
		const processedLines: string[] = [];

		for (const line of lines) {
			const trimmedLine = line.trim();

			const match = trimmedLine.match(fileRangePattern);
			if (!match) {
				processedLines.push(line);
				continue;
			}

			const [, filePath, startLineStr, endLineStr] = match;
			const startLine = parseInt(startLineStr, 10);
			const endLine = parseInt(endLineStr, 10);

			const uri = (!path.isAbsolute(filePath) && cwd)
				? URI.joinPath(URI.file(cwd), filePath)
				: URI.file(filePath);

			try {
				await this.instantiationService.invokeFunction(accessor =>
					assertFileOkForTool(accessor, uri, this._inputContext, { readOnly: true, workingDirectory })
				);
				const document = await this.workspaceService.openTextDocument(uri);

				const snapshot = TextDocumentSnapshot.create(document);

				const clampedStartLine = Math.max(1, Math.min(startLine, snapshot.lineCount));
				const clampedEndLine = Math.max(1, Math.min(endLine, snapshot.lineCount));

				const range = new Range(
					clampedStartLine - 1, 0,
					clampedEndLine - 1, Number.MAX_SAFE_INTEGER
				);

				const code = snapshot.getText(range);
				processedLines.push(`File: \`${uri.fsPath}\`, lines ${clampedStartLine}-${clampedEndLine}:\n\`\`\`\n${code}\n\`\`\``);
			} catch {
				let isExternal = false;
				try {
					isExternal = await this.instantiationService.invokeFunction(accessor =>
						isFileExternalAndNeedsConfirmation(accessor, uri, this._inputContext, { readOnly: true, workingDirectory })
					);
				} catch {
				}

				if (!isExternal) {
					processedLines.push(line);
				}
			}

			if (token.isCancellationRequested) {
				break;
			}
		}

		return processedLines.join('\n');
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchSubagentParams>, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: options.input.description,
		};
	}

	async resolveInput(input: ISearchSubagentParams, promptContext: IBuildPromptContext, _mode: AgentToolMode): Promise<ISearchSubagentParams> {
		this._inputContext = promptContext;
		return input;
	}
}

class ExploreSubagentTool extends (SearchSubagentTool as new (...args: never[]) => SearchSubagentTool) {
	public static readonly toolName = ToolName.ExploreSubagent;
	public static readonly nonDeferred = true;
	protected override readonly toolName: ToolName = ToolName.ExploreSubagent;
}

ToolRegistry.registerTool(SearchSubagentTool);
ToolRegistry.registerTool(ExploreSubagentTool as unknown as IAgentToolCtor);
