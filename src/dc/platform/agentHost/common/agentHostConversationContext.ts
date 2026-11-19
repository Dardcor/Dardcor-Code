/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResponsePartKind, type ResponsePart, type Turn } from './state/sessionState.js';

export interface IConversationContextOptions {
	readonly maxChars: number;

	readonly framing?: string;
}

export function renderResponseMarkdown(parts: readonly ResponsePart[]): string {
	const segments: string[] = [];
	for (const part of parts) {
		if (part.kind === ResponsePartKind.Markdown) {
			const text = part.content.trim();
			if (text) {
				segments.push(text);
			}
		}
	}
	return segments.join('\n\n');
}

export function buildConversationContext(turns: readonly Turn[], options: IConversationContextOptions): string | undefined {
	const blocks: string[] = [];
	for (const turn of turns) {
		const userText = turn.message.text.trim();
		const responseText = renderResponseMarkdown(turn.responseParts);
		if (!userText && !responseText) {
			continue;
		}
		blocks.push(responseText
			? `User request:\n${userText}\n\nAgent response:\n${responseText}`
			: `User request:\n${userText}`);
	}
	if (blocks.length === 0) {
		return undefined;
	}
	const conversation = blocks.join('\n\n---\n\n');
	const truncatedConversation = conversation.length > options.maxChars ? truncateMiddle(conversation, options.maxChars) : conversation;
	return `${options.framing ?? ''}${truncatedConversation}`;
}

export function truncateMiddle(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	const marker = '\n...\n';
	if (maxChars <= marker.length) {
		return text.slice(0, maxChars);
	}
	const keep = maxChars - marker.length;
	const head = Math.ceil(keep / 2);
	const tail = keep - head;
	return `${text.slice(0, head)}${marker}${text.slice(text.length - tail)}`;
}

export function resolveLastNonLocalTurnId(turns: readonly Turn[], isLocal: (turnId: string) => boolean): string | undefined {
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i];
		if (!isLocal(turn.id)) {
			return turn.id;
		}
	}
	return undefined;
}
