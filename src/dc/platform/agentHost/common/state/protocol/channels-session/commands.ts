/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';
import type { BaseParams } from '../common/commands.js';
import type { SessionActiveClient } from './state.js';
import type { MessageAttachment } from '../channels-chat/state.js';


export interface CreateSessionParams extends BaseParams {
	channel: URI;
	provider?: string;
	workingDirectories?: URI[];
	config?: Record<string, unknown>;
	activeClient?: SessionActiveClient;
	progressToken?: string;
}


export interface DisposeSessionParams extends BaseParams { }


export interface FetchTurnsParams extends BaseParams {
	channel: URI;
	cursor?: string;
}

export interface FetchTurnsResult { }


export const enum CompletionItemKind {
	UserMessage = 'userMessage',
}

export interface CompletionsParams extends BaseParams {
	kind: CompletionItemKind;
	channel: URI;
	text: string;
	offset: number;
}

export interface CompletionItem {
	insertText: string;

	rangeStart?: number;

	rangeEnd?: number;

	attachment: MessageAttachment;
}

export interface CompletionsResult {
	items: CompletionItem[];
}
