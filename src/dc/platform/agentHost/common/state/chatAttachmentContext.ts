/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageAttachmentKind, ResponsePartKind, type MessageChatAttachment, type SimpleMessageAttachment, type Turn } from './protocol/state.js';
import { SessionServerToolName } from '../serverToolNames.js';

export const MAX_CHAT_ATTACHMENT_EXCERPT_CHARS = 1000;

export function boundChatTranscriptTurns(turns: readonly Turn[], endTurn?: string): readonly Turn[] {
	if (endTurn === undefined) {
		return turns;
	}
	const index = turns.findIndex(t => t.id === endTurn);
	if (index < 0) {
		throw new Error(`Chat attachment endTurn ${endTurn} was not found in the retained transcript.`);
	}
	return turns.slice(0, index + 1);
}

export function formatChatTranscript(turns: readonly Turn[]): string {
	const blocks: string[] = [];
	for (const turn of turns) {
		const userText = turn.message?.text?.trim();
		if (userText) {
			blocks.push(`User: ${userText}`);
		}
		const assistantText = turn.responseParts
			.map(part => (part.kind === ResponsePartKind.Markdown ? part.content : ''))
			.join('')
			.trim();
		if (assistantText) {
			blocks.push(`Assistant: ${assistantText}`);
		}
	}
	return blocks.join('\n\n');
}

function truncateFront(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

function buildChatAttachmentPointer(label: string, resource: string, openLink: string | undefined, transcript: string): string {
	const intro = openLink
		? `The user referenced another chat, "${label}". ` +
		`That chat is identified by the link ${openLink}. ` +
		`To read its full transcript, call the ${SessionServerToolName.GetSessionContext} server tool with its "session" argument set to that link.`
		: `The user referenced another chat, "${label}", identified by ${resource}.`;

	if (!transcript) {
		return `${intro}\n\nThe referenced chat has no transcript content up to the selected turn.`;
	}

	if (transcript.length > MAX_CHAT_ATTACHMENT_EXCERPT_CHARS) {
		const excerpt = truncateFront(transcript, MAX_CHAT_ATTACHMENT_EXCERPT_CHARS);
		return `${intro}\n\nThe excerpt below is only the tail end of that transcript up to the selected turn (about the last ${MAX_CHAT_ATTACHMENT_EXCERPT_CHARS} characters; the earlier part was omitted to keep the most recent content):\n\n${excerpt}`;
	}

	return `${intro}\n\nThe excerpt below is that chat's full transcript up to the selected turn:\n\n${transcript}`;
}

export function resolveChatAttachment(attachment: MessageChatAttachment, sourceTurns: readonly Turn[], openLink: string | undefined): SimpleMessageAttachment {
	const bounded = boundChatTranscriptTurns(sourceTurns, attachment.endTurn);
	const transcript = formatChatTranscript(bounded);
	const modelRepresentation = buildChatAttachmentPointer(attachment.label, attachment.resource.toString(), openLink, transcript);
	return {
		type: MessageAttachmentKind.Simple,
		label: attachment.label,
		modelRepresentation,
		...(attachment.range !== undefined ? { range: attachment.range } : {}),
	};
}
