/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as l10n from '@vscode/l10n';
import { Raw } from '@vscode/prompt-tsx';

const IMAGE_PLACEHOLDER_TEXT = '[Image omitted from conversation history due to model limit.]';

export function filterHistoryImages(messages: Raw.ChatMessage[], maxImages: number): Raw.ChatMessage[] {
	let lastUserIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === Raw.ChatRole.User) {
			lastUserIdx = i;
			break;
		}
	}

	if (lastUserIdx === -1 && messages.length > 0) {
		lastUserIdx = messages.length - 1;
	}

	let currentTurnImages = 0;
	for (let i = Math.max(lastUserIdx, 0); i < messages.length; i++) {
		const content = messages[i].content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (const part of content) {
			if (part.type === Raw.ChatCompletionContentPartKind.Image) {
				currentTurnImages++;
			}
		}
	}

	let totalImages = 0;
	for (const message of messages) {
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (part.type === Raw.ChatCompletionContentPartKind.Image) {
					totalImages++;
				}
			}
		}
	}

	if (totalImages <= maxImages) {
		return messages;
	}

	if (currentTurnImages > maxImages) {
		throw new Error(l10n.t('Too many images in request: {0} images provided, but the model supports a maximum of {1} images.', currentTurnImages, maxImages));
	}

	let historyBudget = maxImages - currentTurnImages;

	const historyImageDecisions = new Map<string, boolean>();
	for (let i = lastUserIdx - 1; i >= 0; i--) {
		if (!Array.isArray(messages[i].content)) {
			continue;
		}
		for (let j = messages[i].content.length - 1; j >= 0; j--) {
			if (messages[i].content[j].type === Raw.ChatCompletionContentPartKind.Image) {
				const key = `${i}:${j}`;
				if (historyBudget > 0) {
					historyImageDecisions.set(key, true);
					historyBudget--;
				} else {
					historyImageDecisions.set(key, false);
				}
			}
		}
	}

	return messages.map((message, msgIdx) => {
		if (msgIdx >= lastUserIdx) {
			return message;
		}
		if (!Array.isArray(message.content)) {
			return message;
		}
		if (!message.content.some(p => p.type === Raw.ChatCompletionContentPartKind.Image)) {
			return message;
		}
		return {
			...message,
			content: message.content.map((part, partIdx) => {
				if (part.type !== Raw.ChatCompletionContentPartKind.Image) {
					return part;
				}
				if (historyImageDecisions.get(`${msgIdx}:${partIdx}`)) {
					return part;
				}
				return { type: Raw.ChatCompletionContentPartKind.Text, text: IMAGE_PLACEHOLDER_TEXT };
			})
		};
	});
}
