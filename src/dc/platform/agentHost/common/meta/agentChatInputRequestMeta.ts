/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatInputRequest } from '../state/protocol/channels-chat/state.js';

export const enum ChatInputRequestPurpose {
	AskUser = 'askUser',
	Elicitation = 'elicitation',
	PlanReview = 'planReview',
}

type ChatInputRequestWithMeta = ChatInputRequest & { _meta?: Record<string, unknown> };

const PURPOSE_META_KEY = 'purpose';

function isChatInputRequestPurpose(value: unknown): value is ChatInputRequestPurpose {
	return value === ChatInputRequestPurpose.AskUser
		|| value === ChatInputRequestPurpose.Elicitation
		|| value === ChatInputRequestPurpose.PlanReview;
}

export function readChatInputRequestPurpose(request: ChatInputRequest): ChatInputRequestPurpose | undefined {
	const meta = (request as ChatInputRequestWithMeta)._meta;
	if (!meta) {
		return undefined;
	}
	const purpose = meta[PURPOSE_META_KEY];
	return isChatInputRequestPurpose(purpose) ? purpose : undefined;
}

export function withChatInputRequestPurpose<T extends ChatInputRequest>(request: T, purpose: ChatInputRequestPurpose): T {
	const meta = (request as ChatInputRequestWithMeta)._meta;
	return {
		...request,
		_meta: { ...meta, [PURPOSE_META_KEY]: purpose },
	};
}
