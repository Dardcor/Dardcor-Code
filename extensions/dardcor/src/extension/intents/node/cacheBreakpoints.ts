/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { CacheType } from '../../../platform/endpoint/common/endpointTypes';

const MaxCacheBreakpoints = 4;

export function addCacheBreakpoints(messages: Raw.ChatMessage[], apiType: string | undefined) {
	for (const message of messages) {
		if (!supportsCacheBreakpoint(message, apiType)) {
			message.content = message.content.filter(part => part.type !== Raw.ChatCompletionContentPartKind.CacheBreakpoint);
		}
	}

	let count = MaxCacheBreakpoints - countCacheBreakpoints(messages);
	let isBelowCurrentUserMessage = true;
	const reversedMsgs = [...messages].reverse();
	for (const [idx, msg] of reversedMsgs.entries()) {
		const prevMsg = reversedMsgs.at(idx - 1);
		const hasCacheBreakpoint = msg.content.some(part => part.type === Raw.ChatCompletionContentPartKind.CacheBreakpoint);
		if (hasCacheBreakpoint) {
			continue;
		}

		const isLastToolResultInRound = msg.role === Raw.ChatRole.Tool && prevMsg?.role !== Raw.ChatRole.Tool;
		const isAsstMsgWithNoTools = msg.role === Raw.ChatRole.Assistant && !msg.toolCalls?.length;
		if ((isBelowCurrentUserMessage && (isLastToolResultInRound || msg.role === Raw.ChatRole.User) || isAsstMsgWithNoTools) && supportsCacheBreakpoint(msg, apiType)) {
			count--;
			msg.content.push({
				type: Raw.ChatCompletionContentPartKind.CacheBreakpoint,
				cacheType: CacheType
			});

			if (count <= 0) {
				break;
			}
		}

		if (msg.role === Raw.ChatRole.User) {
			isBelowCurrentUserMessage = false;
		}
	}

	for (const msg of messages) {
		if (count <= 0) {
			break;
		}

		const hasCacheBreakpoint = msg.content.some(part => part.type === Raw.ChatCompletionContentPartKind.CacheBreakpoint);
		if ((msg.role === Raw.ChatRole.User || msg.role === Raw.ChatRole.System) && !hasCacheBreakpoint && supportsCacheBreakpoint(msg, apiType)) {
			count--;
			msg.content.push({
				type: Raw.ChatCompletionContentPartKind.CacheBreakpoint,
				cacheType: CacheType
			});
		}

		if (msg.role !== Raw.ChatRole.User && msg.role !== Raw.ChatRole.System) {
			break;
		}
	}
}

function supportsCacheBreakpoint(message: Raw.ChatMessage, apiType: string | undefined): boolean {
	if (apiType === 'responses') {
		if (message.role === Raw.ChatRole.Assistant) {
			return false;
		}

		return message.content.some(part => {
			if (message.role === Raw.ChatRole.Tool) {
				return part.type === Raw.ChatCompletionContentPartKind.Image || part.type === Raw.ChatCompletionContentPartKind.Document;
			}
			return part.type === Raw.ChatCompletionContentPartKind.Text
				|| part.type === Raw.ChatCompletionContentPartKind.Image
				|| part.type === Raw.ChatCompletionContentPartKind.Document
				|| isOpaqueBlockType(part, ['input_text', 'input_image', 'input_file']);
		});
	}

	return message.content.some(part => part.type === Raw.ChatCompletionContentPartKind.Text
		|| part.type === Raw.ChatCompletionContentPartKind.Image
		|| part.type === Raw.ChatCompletionContentPartKind.Document
		|| isOpaqueBlockType(part, ['text', 'image_url', 'input_audio', 'file', 'refusal']));
}

function isOpaqueBlockType(part: Raw.ChatCompletionContentPart, supportedTypes: readonly string[]): boolean {
	if (part.type !== Raw.ChatCompletionContentPartKind.Opaque || typeof part.value !== 'object' || part.value === null || !('type' in part.value)) {
		return false;
	}
	return supportedTypes.includes(String(part.value.type));
}

function countCacheBreakpoints(messages: Raw.ChatMessage[]) {
	let count = 0;
	for (const msg of messages) {
		count += msg.content.filter(part => part.type === Raw.ChatCompletionContentPartKind.CacheBreakpoint).length;
	}
	return count;
}
