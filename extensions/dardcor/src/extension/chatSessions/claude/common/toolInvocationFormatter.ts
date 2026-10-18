/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentInput, BashInput, FileReadInput, GlobInput, GrepInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import Anthropic from '@anthropic-ai/sdk';
import * as l10n from '@vscode/l10n';
import type { ChatSimpleToolResultData, ChatTerminalToolInvocationData } from 'vscode';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { ChatSubagentToolInvocationData, ChatToolInvocationPart, MarkdownString } from '../../../../dardcorTypes';
import { ClaudeToolNames, ExitPlanModeInput, LSInput } from './claudeTools';


function extractToolResultContent(content: Anthropic.Messages.ToolResultBlockParam['content']): string {
	if (!content) {
		return '';
	}
	if (typeof content === 'string') {
		return content;
	}
	return content
		.filter((block): block is Anthropic.Messages.TextBlockParam => block.type === 'text')
		.map(block => block.text)
		.join('\n');
}



export function completeToolInvocation(
	toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
	toolResult: Anthropic.Messages.ToolResultBlockParam,
	invocation: ChatToolInvocationPart
): void {
	const resultContent = extractToolResultContent(toolResult.content);

	switch (toolUse.name as ClaudeToolNames) {
		case ClaudeToolNames.Bash:
			completeBashInvocation(invocation, toolUse, resultContent);
			break;
		case ClaudeToolNames.Read:
		case ClaudeToolNames.LS:
			completeReadInvocation(invocation, toolUse, resultContent);
			break;
		case ClaudeToolNames.Glob:
		case ClaudeToolNames.Grep:
			completeSearchInvocation(invocation, toolUse, resultContent);
			break;
		case ClaudeToolNames.Edit:
		case ClaudeToolNames.MultiEdit:
		case ClaudeToolNames.Write:
		case ClaudeToolNames.TodoWrite:
			break;
		case ClaudeToolNames.Agent:
		case ClaudeToolNames.Task:
			completeTaskInvocation(invocation, resultContent);
			break;
		default:
			completeGenericInvocation(invocation, toolUse, resultContent);
			break;
	}
}

function completeBashInvocation(
	invocation: ChatToolInvocationPart,
	toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
	resultContent: string
): void {
	const exitCodeMatch = /(?:exit code|exited with)[:=\s]*(\d+)/i.exec(resultContent);
	const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : undefined;

	let text = resultContent;
	if (exitCode !== undefined) {
		text = resultContent.replace(/(?:exit code|exited with)[:=\s]*\d+\s*$/i, '').trimEnd();
	}

	text = text.replace(/\n/g, '\r\n');

	const toolSpecificData: ChatTerminalToolInvocationData = {
		commandLine: {
			original: (toolUse.input as BashInput)?.command ?? '',
		},
		language: 'bash',
		state: exitCode !== undefined ? { exitCode } : undefined,
		output: text ? { text } : undefined
	};
	invocation.toolSpecificData = toolSpecificData;
}

function completeReadInvocation(
	invocation: ChatToolInvocationPart,
	toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
	resultContent: string
): void {
	if (!resultContent) {
		return;
	}

	const input = toolUse.name === ClaudeToolNames.LS
		? (toolUse.input as LSInput)?.path ?? ''
		: (toolUse.input as FileReadInput)?.file_path ?? '';

	const toolSpecificData: ChatSimpleToolResultData = {
		input,
		output: resultContent
	};
	invocation.toolSpecificData = toolSpecificData;
}

function completeSearchInvocation(
	invocation: ChatToolInvocationPart,
	toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
	resultContent: string
): void {
	if (!resultContent) {
		return;
	}

	const input = toolUse.name === ClaudeToolNames.Glob
		? (toolUse.input as GlobInput)?.pattern ?? ''
		: (toolUse.input as GrepInput)?.pattern ?? '';

	const toolSpecificData: ChatSimpleToolResultData = {
		input,
		output: resultContent
	};
	invocation.toolSpecificData = toolSpecificData;
}

function completeTaskInvocation(
	invocation: ChatToolInvocationPart,
	resultContent: string
): void {
	if (invocation.toolSpecificData instanceof ChatSubagentToolInvocationData) {
		invocation.toolSpecificData.result = resultContent;
	}
}

function completeGenericInvocation(
	invocation: ChatToolInvocationPart,
	toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
	resultContent: string
): void {
	if (!resultContent) {
		return;
	}

	const toolSpecificData: ChatSimpleToolResultData = {
		input: toolUse.input ? JSON.stringify(toolUse.input, null, 2) : '',
		output: resultContent
	};
	invocation.toolSpecificData = toolSpecificData;
}



export function createFormattedToolInvocation(
	toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
	complete?: boolean
): ChatToolInvocationPart | undefined {
	const invocation = new ChatToolInvocationPart(toolUse.name, toolUse.id);
	if (complete !== undefined) {
		invocation.isConfirmed = complete;
		invocation.isComplete = complete;
	}

	switch (toolUse.name as ClaudeToolNames) {
		case ClaudeToolNames.Bash:
			formatBashInvocation(invocation, toolUse);
			break;
		case ClaudeToolNames.Read:
			formatReadInvocation(invocation, toolUse);
			break;
		case ClaudeToolNames.Glob:
			formatGlobInvocation(invocation, toolUse);
			break;
		case ClaudeToolNames.Grep:
			formatGrepInvocation(invocation, toolUse);
			break;
		case ClaudeToolNames.LS:
			formatLSInvocation(invocation, toolUse);
			break;
		case ClaudeToolNames.Edit:
		case ClaudeToolNames.MultiEdit:
		case ClaudeToolNames.Write:
			return;
		case ClaudeToolNames.ExitPlanMode:
			formatExitPlanModeInvocation(invocation, toolUse);
			break;
		case ClaudeToolNames.Agent:
		case ClaudeToolNames.Task:
			formatTaskInvocation(invocation, toolUse);
			break;
		case ClaudeToolNames.TodoWrite:
			return;
		default:
			formatGenericInvocation(invocation, toolUse);
			break;
	}

	return invocation;
}

function formatBashInvocation(invocation: ChatToolInvocationPart, toolUse: Anthropic.Beta.Messages.BetaToolUseBlock): void {
	invocation.invocationMessage = '';
	invocation.toolSpecificData = {
		commandLine: {
			original: (toolUse.input as BashInput)?.command,
		},
		language: 'bash'
	};
}

function formatReadInvocation(invocation: ChatToolInvocationPart, toolUse: Anthropic.Beta.Messages.BetaToolUseBlock): void {
	const filePath: string = (toolUse.input as FileReadInput)?.file_path ?? '';
	const display = filePath ? formatUriForMessage(filePath) : '';
	invocation.invocationMessage = new MarkdownString(l10n.t("Read {0}", display));
}

function formatGlobInvocation(invocation: ChatToolInvocationPart, toolUse: Anthropic.Beta.Messages.BetaToolUseBlock): void {
	const pattern: string = (toolUse.input as GlobInput)?.pattern ?? '';
	invocation.invocationMessage = new MarkdownString(l10n.t("Searched for files matching `{0}`", pattern));
}

function formatGrepInvocation(invocation: ChatToolInvocationPart, toolUse: Anthropic.Beta.Messages.BetaToolUseBlock): void {
	const pattern: string = (toolUse.input as GrepInput)?.pattern ?? '';
	invocation.invocationMessage = new MarkdownString(l10n.t("Searched for regex `{0}`", pattern));
}

function formatLSInvocation(invocation: ChatToolInvocationPart, toolUse: Anthropic.Beta.Messages.BetaToolUseBlock): void {
	const path: string = (toolUse.input as LSInput)?.path ?? '';
	const display = path ? formatUriForMessage(path) : '';
	invocation.invocationMessage = new MarkdownString(l10n.t("Read {0}", display));
}

function formatExitPlanModeInvocation(invocation: ChatToolInvocationPart, toolUse: Anthropic.Beta.Messages.BetaToolUseBlock): void {
	invocation.invocationMessage = l10n.t("Here is Claude's plan:\n\n{0}", (toolUse.input as ExitPlanModeInput)?.plan ?? '');
}

function formatTaskInvocation(invocation: ChatToolInvocationPart, toolUse: Anthropic.Beta.Messages.BetaToolUseBlock): void {
	const description = (toolUse.input as AgentInput)?.description ?? '';
	invocation.invocationMessage = new MarkdownString(l10n.t("Completed Task: \"{0}\"", description));

	const input = toolUse.input as AgentInput;
	invocation.toolSpecificData = new ChatSubagentToolInvocationData(
		input.description,
		input.subagent_type,
		input.prompt);
}

function formatGenericInvocation(invocation: ChatToolInvocationPart, toolUse: Anthropic.Beta.Messages.BetaToolUseBlock): void {
	invocation.invocationMessage = l10n.t("Used tool: {0}", toolUse.name);
}

function formatUriForMessage(path: string): string {
	return `[](${URI.file(path).toString()})`;
}

