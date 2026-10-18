/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AGENTS_AUTHORITY } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ILinkPresentation, ILinkPresentationStatus } from '../../dataChannel/common/dataChannel.js';
import { AgentSession } from './agent.js';
import { SessionServerToolName } from './serverToolNames.js';
import { DEFAULT_CHAT_ID, isAhpChatChannel, parseChatUri } from './state/sessionState.js';

export const AGENT_HOST_SESSION_LINK_SCHEME = 'agent-host-session';
export const AGENT_HOST_SESSION_LINK_PATTERN = /^agent-host-session:\/\/[^/?#]+\/[^?#]+(?:\?[^#]*)?(?:#.*)?$/i;
export const AGENT_HOST_SESSION_ONLY_LINK_PATTERN = /^(?![^#]*[?&]chat=)agent-host-session:\/\/[^/?#]+\/[^?#]+(?:\?[^#]*)?(?:#.*)?$/i;
export const AGENT_HOST_CHAT_LINK_PATTERN = /^(?=[^#]*[?&]chat=)agent-host-session:\/\/[^/?#]+\/[^?#]+(?:\?[^#]*)?(?:#.*)?$/i;

const AGENT_HOST_SESSION_LINK_PATH_PREFIX = `/${AGENT_HOST_SESSION_LINK_SCHEME}/`;
const AGENT_HOST_CHAT_LINK_PATH_SEGMENT = '/chat/';

export type AgentSessionLinkStatus = 'untitled' | 'inProgress' | 'needsInput' | 'completed' | 'error';

export function buildAgentSessionLinkPresentation(title: string, description: string | undefined, status: AgentSessionLinkStatus, kind: 'session' | 'chat' = 'session'): ILinkPresentation {
	const presentationStatus = getAgentSessionLinkPresentationStatus(status);
	return {
		kind,
		title,
		...(description ? { detail: description } : {}),
		status: presentationStatus,
		tooltip: localize('agentSessionLink.tooltip', "{0} · {1}", title, presentationStatus.label),
		ariaLabel: kind === 'chat'
			? localize('agentChatLink.ariaLabel', "Agent chat {0}, {1}", title, presentationStatus.label)
			: localize('agentSessionLink.ariaLabel', "Agent session {0}, {1}", title, presentationStatus.label),
	};
}

function getAgentSessionLinkPresentationStatus(status: AgentSessionLinkStatus): ILinkPresentationStatus {
	switch (status) {
		case 'untitled': return { kind: 'neutral', label: localize('agentSessionLink.notStarted', "Not started") };
		case 'inProgress': return { kind: 'pending', label: localize('agentSessionLink.working', "Working") };
		case 'needsInput': return { kind: 'warning', label: localize('agentSessionLink.needsInput', "Needs input") };
		case 'completed': return { kind: 'success', label: localize('agentSessionLink.completed', "Completed") };
		case 'error': return { kind: 'error', label: localize('agentSessionLink.error', "Error") };
	}
}

function matchesToolName(toolName: string, bareName: string): boolean {
	return toolName === bareName || toolName.endsWith(`__${bareName}`);
}

export function isCreateSessionTool(toolName: string): boolean {
	return matchesToolName(toolName, SessionServerToolName.CreateSession);
}

export function isCreateChatTool(toolName: string): boolean {
	return matchesToolName(toolName, SessionServerToolName.CreateChat);
}

export function isSendMessageTool(toolName: string): boolean {
	return matchesToolName(toolName, SessionServerToolName.SendMessage);
}

export function buildOpenSessionLinkUri(backendSession: URI | string, chatId?: string, turnId?: string): string {
	const provider = AgentSession.provider(backendSession);
	const rawId = AgentSession.id(backendSession);
	if (!provider) {
		throw new Error(`Cannot build open-session link: missing provider in ${backendSession.toString()}`);
	}
	const base = URI.from({ scheme: AGENT_HOST_SESSION_LINK_SCHEME, authority: provider, path: `/${rawId}` }).toString();
	const query: string[] = [];
	if (chatId && chatId !== DEFAULT_CHAT_ID) {
		query.push(`chat=${encodeURIComponent(chatId)}`);
	}
	if (turnId) {
		query.push(`turn=${encodeURIComponent(turnId)}`);
	}
	return query.length > 0 ? `${base}?${query.join('&')}` : base;
}

export function buildExternalOpenSessionLinkUri(productUrlProtocol: string, backendSession: URI | string, chatId?: string, turnId?: string): string {
	const sessionLink = buildOpenSessionLinkUri(backendSession);
	const encodedTarget = sessionLink.slice(`${AGENT_HOST_SESSION_LINK_SCHEME}://`.length);
	const chatPath = chatId && chatId !== DEFAULT_CHAT_ID ? `${AGENT_HOST_CHAT_LINK_PATH_SEGMENT}${encodeURIComponent(encodeURIComponent(chatId))}` : '';
	const query = turnId ? `?turn=${encodeURIComponent(turnId)}` : '';
	return `${productUrlProtocol}://${AGENTS_AUTHORITY}${AGENT_HOST_SESSION_LINK_PATH_PREFIX}${encodedTarget}${chatPath}${query}`;
}

export function parseExternalOpenSessionLinkUri(uri: URI | string, productUrlProtocol: string): URI | undefined {
	const parsed = typeof uri === 'string' ? URI.parse(uri) : uri;
	if (parsed.scheme !== productUrlProtocol || parsed.authority !== AGENTS_AUTHORITY || !parsed.path.startsWith(AGENT_HOST_SESSION_LINK_PATH_PREFIX)) {
		return undefined;
	}

	const sessionPath = parsed.path.slice(AGENT_HOST_SESSION_LINK_PATH_PREFIX.length);
	const providerEnd = sessionPath.indexOf('/');
	if (providerEnd <= 0 || providerEnd === sessionPath.length - 1) {
		return undefined;
	}

	const chatSegmentIndex = sessionPath.lastIndexOf(AGENT_HOST_CHAT_LINK_PATH_SEGMENT);
	const hasChatSegment = chatSegmentIndex > providerEnd;
	let chatId: string | undefined;
	if (hasChatSegment) {
		const encodedChatId = sessionPath.slice(chatSegmentIndex + AGENT_HOST_CHAT_LINK_PATH_SEGMENT.length);
		if (!encodedChatId) {
			return undefined;
		}
		try {
			chatId = decodeURIComponent(encodedChatId);
		} catch {
			return undefined;
		}
	}
	const sessionTarget = hasChatSegment ? sessionPath.slice(0, chatSegmentIndex) : sessionPath;
	const query = [
		chatId ? `chat=${encodeURIComponent(chatId)}` : undefined,
		parsed.query,
	].filter(queryPart => !!queryPart).join('&');
	const sessionLink = URI.from({
		scheme: AGENT_HOST_SESSION_LINK_SCHEME,
		authority: sessionTarget.slice(0, providerEnd),
		path: sessionTarget.slice(providerEnd),
		query,
		fragment: parsed.fragment,
	});
	return parseOpenSessionLinkUri(sessionLink) ? sessionLink : undefined;
}

export function parseOpenSessionLinkUri(uri: URI | string): URI | undefined {
	const parsed = typeof uri === 'string' ? URI.parse(uri) : uri;
	if (parsed.scheme !== AGENT_HOST_SESSION_LINK_SCHEME || !parsed.authority) {
		return undefined;
	}
	const rawId = parsed.path.replace(/^\//, '');
	if (!rawId) {
		return undefined;
	}
	return AgentSession.uri(parsed.authority, rawId);
}

export function parseOpenSessionLinkChatId(uri: URI | string): string | undefined {
	const chatId = readOpenSessionLinkQueryParam(uri, 'chat');
	return chatId === DEFAULT_CHAT_ID ? undefined : chatId;
}

export function parseOpenSessionLinkTurnId(uri: URI | string): string | undefined {
	return readOpenSessionLinkQueryParam(uri, 'turn');
}

function readOpenSessionLinkQueryParam(uri: URI | string, name: string): string | undefined {
	const parsed = typeof uri === 'string' ? URI.parse(uri) : uri;
	if (parsed.scheme !== AGENT_HOST_SESSION_LINK_SCHEME) {
		return undefined;
	}
	const match = new RegExp(`(?:^|&)${name}=([^&]+)`).exec(parsed.query);
	try {
		return match ? decodeURIComponent(match[1]) : undefined;
	} catch {
		return undefined;
	}
}

export function buildOpenSessionLinkForChatResource(chatResource: URI | string): string | undefined {
	try {
		const resourceStr = typeof chatResource === 'string' ? chatResource : chatResource.toString();
		const parsedChat = isAhpChatChannel(resourceStr) ? parseChatUri(resourceStr) : undefined;
		const sourceSession = parsedChat ? parsedChat.session : URI.parse(resourceStr).toString();
		return buildOpenSessionLinkUri(sourceSession, parsedChat?.chatId);
	} catch {
		return undefined;
	}
}
