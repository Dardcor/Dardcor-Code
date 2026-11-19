/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { coalesce } from '../../../util/dardcor/base/common/arrays';
import { URI } from '../../../util/dardcor/base/common/uri';
import { ChatReferenceBinaryData, ChatRequestTurn2 } from '../../../dardcorTypes';
import { tryParseClaudeModelId } from '../claude/node/claudeModelId';
import { completeToolInvocation, createFormattedToolInvocation } from '../claude/common/toolInvocationFormatter';
import { AssistantMessageContent, ContentBlock, IClaudeCodeSession, ImageBlock, ISubagentSession, StoredMessage, SYNTHETIC_MODEL_ID, TextBlock, ThinkingBlock, ToolResultBlock, ToolUseBlock } from '../claude/node/sessionParser/claudeSessionSchema';


interface ToolContext {
	unprocessedToolCalls: Map<string, ContentBlock>;
	pendingToolInvocations: Map<string, vscode.ChatToolInvocationPart>;
}



function isTextBlock(block: ContentBlock): block is TextBlock {
	return block.type === 'text';
}

function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
	return block.type === 'thinking';
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
	return block.type === 'tool_use';
}

function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
	return block.type === 'tool_result';
}

function isImageBlock(block: ContentBlock): block is ImageBlock {
	return block.type === 'image';
}



const COMMAND_NAME_PATTERN = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_STDOUT_PATTERN = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/;

function extractCommandInfo(contents: readonly (string | ContentBlock[])[]): { commandName: string; stdout?: string } | undefined {
	let commandName: string | undefined;
	let stdout: string | undefined;

	for (const content of contents) {
		if (typeof content === 'string') {
			const nameMatch = COMMAND_NAME_PATTERN.exec(content);
			if (nameMatch) {
				commandName ??= nameMatch[1].trim();
			}
			const stdoutMatch = COMMAND_STDOUT_PATTERN.exec(content);
			if (stdoutMatch) {
				stdout ??= stdoutMatch[1].trim();
			}
		} else {
			for (const block of content) {
				if (isTextBlock(block)) {
					const nameMatch = COMMAND_NAME_PATTERN.exec(block.text);
					if (nameMatch) {
						commandName ??= nameMatch[1].trim();
					}
					const stdoutMatch = COMMAND_STDOUT_PATTERN.exec(block.text);
					if (stdoutMatch) {
						stdout ??= stdoutMatch[1].trim();
					}
				}
			}
		}
	}

	if (commandName !== undefined) {
		return { commandName, stdout };
	}
	return undefined;
}



function isSystemReminderBlock(text: string): boolean {
	return text.includes('<system-reminder>');
}

function stripSystemReminders(text: string): string {
	return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '');
}

function extractTextContent(content: string | ContentBlock[]): string {
	if (typeof content === 'string') {
		return stripSystemReminders(content);
	}

	return content
		.filter(isTextBlock)
		.filter(block => !isSystemReminderBlock(block.text))
		.map(block => block.text)
		.join('');
}



function processToolResults(content: string | ContentBlock[], toolContext: ToolContext): void {
	if (typeof content === 'string') {
		return;
	}

	for (const block of content) {
		if (isToolResultBlock(block)) {
			const toolUse = toolContext.unprocessedToolCalls.get(block.tool_use_id);
			if (toolUse && isToolUseBlock(toolUse)) {
				toolContext.unprocessedToolCalls.delete(block.tool_use_id);
				const pendingInvocation = toolContext.pendingToolInvocations.get(block.tool_use_id);
				if (pendingInvocation) {
					pendingInvocation.isComplete = true;
					pendingInvocation.isConfirmed = true;
					pendingInvocation.isError = block.is_error;
					completeToolInvocation(toolUse, block, pendingInvocation);
					toolContext.pendingToolInvocations.delete(block.tool_use_id);
				}
			}
		}
	}
}



function extractImageReferences(contents: readonly (string | ContentBlock[])[]): vscode.ChatPromptReference[] {
	const references: vscode.ChatPromptReference[] = [];
	let imageIndex = 0;
	for (const content of contents) {
		if (typeof content === 'string') {
			continue;
		}
		for (const block of content) {
			if (!isImageBlock(block)) {
				continue;
			}
			const id = `image-${imageIndex + 1}`;
			if (block.source.type === 'base64') {
				const source = block.source;
				references.push({
					id,
					name: id,
					value: new ChatReferenceBinaryData(
						source.media_type,
						() => Promise.resolve(Buffer.from(source.data, 'base64'))
					),
				});
				imageIndex++;
			} else if (block.source.type === 'url') {
				references.push({
					id,
					name: id,
					value: URI.parse(block.source.url),
				});
				imageIndex++;
			}
		}
	}
	return references;
}



function extractUserRequest(contents: readonly (string | ContentBlock[])[], messageId: string, modelId: string | undefined): vscode.ChatRequestTurn2 | undefined {
	const textParts: string[] = [];
	for (const content of contents) {
		const text = extractTextContent(content);
		if (text.trim()) {
			textParts.push(text);
		}
	}

	const combinedText = textParts.join('\n\n');
	const imageReferences = extractImageReferences(contents);

	if (!combinedText.trim() && imageReferences.length === 0) {
		return;
	}

	if (combinedText === '[Request interrupted by user]') {
		return;
	}

	return new ChatRequestTurn2(combinedText, undefined, imageReferences, '', [], undefined, messageId, modelId, undefined);
}

function extractAssistantParts(messages: readonly AssistantMessageContent[], toolContext: ToolContext): (vscode.ChatResponseMarkdownPart | vscode.ChatResponseThinkingProgressPart | vscode.ChatToolInvocationPart)[] {
	const allParts: (vscode.ChatResponseMarkdownPart | vscode.ChatResponseThinkingProgressPart | vscode.ChatToolInvocationPart)[] = [];

	for (const message of messages) {
		const parts = coalesce(message.content.map(block => {
			if (isTextBlock(block)) {
				return new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString(block.text));
			} else if (isThinkingBlock(block)) {
				return new vscode.ChatResponseThinkingProgressPart(block.thinking);
			} else if (isToolUseBlock(block)) {
				toolContext.unprocessedToolCalls.set(block.id, block);
				const toolInvocation = createFormattedToolInvocation(block);
				if (toolInvocation) {
					toolContext.pendingToolInvocations.set(block.id, toolInvocation);
				}
				return toolInvocation;
			}
		}));
		allParts.push(...parts);
	}

	return allParts;
}



function buildSubagentMap(subagents: readonly ISubagentSession[]): Map<string, ISubagentSession> {
	const map = new Map<string, ISubagentSession>();
	for (const subagent of subagents) {
		if (subagent.parentToolUseId) {
			map.set(subagent.parentToolUseId, subagent);
		}
	}
	return map;
}

function extractSubagentToolParts(
	subagent: ISubagentSession,
	taskToolUseId: string
): vscode.ChatToolInvocationPart[] {
	const toolContext: ToolContext = {
		unprocessedToolCalls: new Map(),
		pendingToolInvocations: new Map()
	};
	const parts: vscode.ChatToolInvocationPart[] = [];

	for (const message of subagent.messages) {
		if (message.type === 'assistant') {
			const assistantContent = message.message as AssistantMessageContent;
			for (const block of assistantContent.content) {
				if (isToolUseBlock(block)) {
					toolContext.unprocessedToolCalls.set(block.id, block);
					const toolInvocation = createFormattedToolInvocation(block, true);
					if (toolInvocation) {
						toolInvocation.subAgentInvocationId = taskToolUseId;
						toolContext.pendingToolInvocations.set(block.id, toolInvocation);
						parts.push(toolInvocation);
					}
				}
			}
		} else if (message.type === 'user') {
			const content = message.message.content;
			if (typeof content !== 'string') {
				processToolResults(content, toolContext);
			}
		}
	}

	return parts;
}



function findModelIdForRequest(
	messages: readonly StoredMessage[],
	startIndex: number,
): string | undefined {
	for (let j = startIndex; j < messages.length; j++) {
		const msg = messages[j];
		if (msg.type === 'assistant' && msg.message.role === 'assistant') {
			const assistantMsg = msg.message as AssistantMessageContent;
			if (assistantMsg.model && assistantMsg.model !== SYNTHETIC_MODEL_ID) {
				return tryParseClaudeModelId(assistantMsg.model)?.toEndpointModelId() ?? assistantMsg.model;
			}
		}
	}
	return undefined;
}


export function buildChatHistory(session: IClaudeCodeSession, getModelDetails?: (modelId: string) => string | undefined): (vscode.ChatRequestTurn2 | vscode.ChatResponseTurn2)[] {
	const result: (vscode.ChatRequestTurn2 | vscode.ChatResponseTurn2)[] = [];
	const toolContext: ToolContext = {
		unprocessedToolCalls: new Map(),
		pendingToolInvocations: new Map()
	};
	let i = 0;
	const messages = session.messages;
	let pendingResponseParts: (vscode.ChatResponseMarkdownPart | vscode.ChatResponseThinkingProgressPart | vscode.ChatToolInvocationPart)[] = [];
	let pendingResponseModelId: string | undefined;
	const makeResponseResult = (modelId: string | undefined): vscode.ChatResult => {
		if (!modelId || !getModelDetails) {
			return {};
		}
		const details = getModelDetails(modelId);
		return details ? { details } : {};
	};

	const subagentMap = buildSubagentMap(session.subagents);

	while (i < messages.length) {
		const currentType = messages[i].type;
		const currentMessageId = messages[i].uuid;
		if (currentType === 'user') {
			const userMessages: StoredMessage[] = [];
			while (i < messages.length && messages[i].type === 'user' && messages[i].message.role === 'user') {
				userMessages.push(messages[i]);
				i++;
			}

			const userContents = userMessages.map(m => m.message.content as string | ContentBlock[]);

			for (const content of userContents) {
				processToolResults(content, toolContext);
			}

			for (const content of userContents) {
				if (typeof content === 'string') {
					continue;
				}
				for (const block of content) {
					if (isToolResultBlock(block)) {
						const subagent = subagentMap.get(block.tool_use_id);
						if (subagent) {
							const subagentParts = extractSubagentToolParts(subagent, block.tool_use_id);
							pendingResponseParts.push(...subagentParts);
						}
					}
				}
			}

			const commandInfo = extractCommandInfo(userContents);
			const modelId = findModelIdForRequest(messages, i);
			if (commandInfo) {
				if (pendingResponseParts.length > 0) {
					result.push(new vscode.ChatResponseTurn2(pendingResponseParts, makeResponseResult(pendingResponseModelId), ''));
					pendingResponseParts = [];
					pendingResponseModelId = undefined;
				}
				result.push(new ChatRequestTurn2(commandInfo.commandName, undefined, [], '', [], undefined, currentMessageId, modelId, undefined));
				if (commandInfo.stdout) {
					result.push(new vscode.ChatResponseTurn2(
						[new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString(commandInfo.stdout))],
						{},
						''
					));
				}
			} else {
				const requestTurn = extractUserRequest(userContents, currentMessageId, modelId);
				if (requestTurn) {
					if (pendingResponseParts.length > 0) {
						result.push(new vscode.ChatResponseTurn2(pendingResponseParts, makeResponseResult(pendingResponseModelId), ''));
						pendingResponseParts = [];
						pendingResponseModelId = undefined;
					}
					result.push(requestTurn);
				}
			}
		} else if (currentType === 'assistant') {
			const assistantMessages: AssistantMessageContent[] = [];
			while (i < messages.length && messages[i].type === 'assistant' && messages[i].message.role === 'assistant') {
				const assistantMessage = messages[i].message as AssistantMessageContent;
				if (assistantMessage.model !== SYNTHETIC_MODEL_ID) {
					assistantMessages.push(assistantMessage);
					if (assistantMessage.model) {
						pendingResponseModelId = assistantMessage.model;
					}
				}
				i++;
			}

			const parts = extractAssistantParts(assistantMessages, toolContext);
			pendingResponseParts.push(...parts);
		} else if (currentType === 'system') {
			const msg = messages[i];
			if (msg.message.role === 'system') {
				const content = (msg.message as { role: 'system'; content: string }).content.trim();
				pendingResponseParts.push(
					new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString(`\n\n---\n\n*${content}*`))
				);
			}
			i++;
		} else {
			i++;
		}
	}

	if (pendingResponseParts.length > 0) {
		result.push(new vscode.ChatResponseTurn2(pendingResponseParts, makeResponseResult(pendingResponseModelId), ''));
	}

	return result;
}

