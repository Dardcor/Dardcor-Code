/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { URI } from '../../../base/common/uri.js';
import { CompletionItem, CompletionItemKind, CompletionsParams } from '../common/state/protocol/commands.js';
import { ChatInteractivity, ChatOriginKind, MessageAttachmentKind } from '../common/state/protocol/state.js';
import { buildDefaultChatUri, isAhpChatChannel, isDefaultChatUri, parseRequiredSessionUriFromChatUri } from '../common/state/sessionState.js';
import { CompletionTriggerCharacter, IAgentHostCompletionItemProvider } from './agentHostCompletions.js';
import { AgentHostStateManager, resolveChatStateForUri } from './agentHostStateManager.js';

const MAX_RESULTS = 20;

const CHAT_PREFIX = 'chat:';

export interface IChatToken {
	readonly typed: string;
	readonly rangeStart: number;
	readonly rangeEnd: number;
}

export function extractChatToken(text: string, offset: number): IChatToken | undefined {
	if (offset < 0 || offset > text.length) {
		return undefined;
	}
	for (let i = offset - 1; i >= 0; i--) {
		const ch = text.charCodeAt(i);
		if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d ) {
			return undefined;
		}
		if (text[i] === CompletionTriggerCharacter.Hash) {
			if (i > 0) {
				const prev = text.charCodeAt(i - 1);
				const prevIsWs = prev === 0x20 || prev === 0x09 || prev === 0x0a || prev === 0x0d;
				if (!prevIsWs) {
					return undefined;
				}
			}
			const raw = text.slice(i + 1, offset);
			const lower = raw.toLowerCase();
			if (lower.startsWith(CHAT_PREFIX)) {
				return { typed: raw.slice(CHAT_PREFIX.length), rangeStart: i, rangeEnd: offset };
			}
			if (CHAT_PREFIX.startsWith(lower)) {
				return { typed: '', rangeStart: i, rangeEnd: offset };
			}
			return undefined;
		}
	}
	return undefined;
}

function sanitizeChatTitle(title: string): string {
	return title.replace(/\s+/g, ' ').trim();
}

export class AgentHostChatCompletionProvider implements IAgentHostCompletionItemProvider {

	readonly kinds: ReadonlySet<CompletionItemKind> = new Set([CompletionItemKind.UserMessage]);

	readonly triggerCharacters: readonly string[] = [CompletionTriggerCharacter.Hash];

	constructor(
		private readonly _stateManager: AgentHostStateManager,
	) { }

	async provideCompletionItems(params: CompletionsParams, token: CancellationToken): Promise<readonly CompletionItem[]> {
		const chatToken = extractChatToken(params.text, params.offset);
		if (!chatToken) {
			return [];
		}

		const session = this._stateManager.getSessionState(params.channel);
		if (!session) {
			return [];
		}

		const sessionUri = isAhpChatChannel(params.channel) ? parseRequiredSessionUriFromChatUri(params.channel) : params.channel;
		const defaultChatUri = session.defaultChat ?? buildDefaultChatUri(sessionUri);
		const currentChatId = this._canonicalChatId(params.channel, sessionUri, defaultChatUri);

		const filter = sanitizeChatTitle(chatToken.typed).toLowerCase();

		const candidates = session.chats
			.filter(chat => {
				if (this._canonicalChatId(chat.resource, sessionUri, defaultChatUri) === currentChatId) {
					return false;
				}
				if (chat.origin?.kind === ChatOriginKind.Tool) {
					return false;
				}
				if (chat.interactivity === ChatInteractivity.Hidden) {
					return false;
				}
				if (filter && !sanitizeChatTitle(chat.title).toLowerCase().includes(filter)) {
					return false;
				}
				return true;
			})
			.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));

		const items: CompletionItem[] = [];
		for (const chat of candidates) {
			if (token.isCancellationRequested || items.length >= MAX_RESULTS) {
				break;
			}
			const endTurn = this._lastCompletedTurnId(chat.resource);
			if (!endTurn) {
				continue;
			}
			const sanitizedTitle = sanitizeChatTitle(chat.title);
			items.push({
				insertText: `#chat:${sanitizedTitle} `,
				rangeStart: chatToken.rangeStart,
				rangeEnd: chatToken.rangeEnd,
				attachment: {
					type: MessageAttachmentKind.Chat,
					resource: chat.resource,
					endTurn,
					label: sanitizedTitle,
				},
			});
		}
		return items;
	}

	private _canonicalChatId(uri: string, sessionUri: string, defaultChatUri: string): string {
		const normalizedDefault = URI.parse(defaultChatUri).toString();
		const normalized = URI.parse(uri).toString();
		if (normalized === URI.parse(sessionUri).toString() || isDefaultChatUri(uri)) {
			return normalizedDefault;
		}
		return normalized;
	}

	private _lastCompletedTurnId(chatUri: string): string | undefined {
		const turns = resolveChatStateForUri(this._stateManager, chatUri)?.turns;
		return turns && turns.length > 0 ? turns[turns.length - 1].id : undefined;
	}
}
