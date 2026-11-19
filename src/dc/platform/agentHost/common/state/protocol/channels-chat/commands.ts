/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';
import type { BaseParams } from '../common/commands.js';
import type { Message, SideChatSelection } from './state.js';


export const enum ChatSourceKind {
	Fork = 'fork',
	SideChat = 'sideChat',
}

export interface ForkChatSource {
	kind: ChatSourceKind.Fork;
	chat: URI;
	turnId: string;
}

export interface SideChatSource {
	kind: ChatSourceKind.SideChat;
	chat: URI;
	turnId: string;
	selection?: SideChatSelection;
}

export type ChatSource =
	| ForkChatSource
	| SideChatSource;

export interface CreateChatParams extends BaseParams {
	channel: URI;
	chat: URI;
	initialMessage?: Message;
	source?: ChatSource;
	workingDirectories?: URI[];
}


export interface DisposeChatParams extends BaseParams { }
