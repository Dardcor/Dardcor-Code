/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type { IChatDebugFileLoggerService, IDebugLogEntry } from '../../../platform/chat/common/chatDebugFileLoggerService';
import type { ISessionStore, SessionRow, TurnRow, FileRow, RefRow } from '../../../platform/chronicle/common/sessionStore';
import type { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import {
	MAX_ASSISTANT_RESPONSE_LENGTH,
	MAX_SUMMARY_LENGTH,
	MAX_USER_MESSAGE_LENGTH,
	extractAssistantResponse,
	extractFilePath,
	extractPlainTextFromContent,
	extractRefsFromMcpTool,
	extractRefsFromTerminal,
	extractRepoFromMcpTool,
	isGitHubMcpTool,
	isTerminalTool,
	truncateForStore,
} from '../common/sessionStoreTracking';

export interface ReindexResult {
	processed: number;
	skipped: number;
	cancelled: boolean;
}

interface PerSessionWriteBuffer {
	session: SessionRow | undefined;
	turns: TurnRow[];
	files: FileRow[];
	refs: RefRow[];
}

function tryParseArgs(raw: string | number | boolean | undefined): unknown {
	if (typeof raw !== 'string') {
		return undefined;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export async function reindexSessions(
	store: ISessionStore,
	debugLogService: IChatDebugFileLoggerService,
	reportProgress: (message: string) => void,
	token: CancellationToken,
	force: boolean = false,
): Promise<ReindexResult> {
	const sessionIds = await debugLogService.listSessionIds();

	let processed = 0;
	let skipped = 0;

	for (let i = 0; i < sessionIds.length; i++) {
		if (token.isCancellationRequested) {
			return { processed, skipped, cancelled: true };
		}

		const sessionId = sessionIds[i];

		if (!force && store.getSession(sessionId)) {
			skipped++;
			continue;
		}

		reportProgress(l10n.t('Reindexing session {0} of {1}...', i + 1, sessionIds.length));

		try {
			await reindexOneSession(store, debugLogService, sessionId);
			processed++;
		} catch {
			skipped++;
		}

		await new Promise<void>(resolve => setTimeout(resolve, 0));
	}

	return { processed, skipped, cancelled: false };
}

async function reindexOneSession(
	store: ISessionStore,
	debugLogService: IChatDebugFileLoggerService,
	sessionId: string,
): Promise<void> {
	const buffer: PerSessionWriteBuffer = {
		session: undefined,
		turns: [],
		files: [],
		refs: [],
	};

	let pendingUserMessage: string | undefined;
	let pendingUserTimestamp: string | undefined;
	let turnIndex = 0;

	await debugLogService.streamEntries(sessionId, (entry: IDebugLogEntry) => {
		processEntry(entry, sessionId, buffer, {
			get pendingUserMessage() { return pendingUserMessage; },
			set pendingUserMessage(v) { pendingUserMessage = v; },
			get pendingUserTimestamp() { return pendingUserTimestamp; },
			set pendingUserTimestamp(v) { pendingUserTimestamp = v; },
			get turnIndex() { return turnIndex; },
			set turnIndex(v) { turnIndex = v; },
		});
	});

	if (pendingUserMessage) {
		buffer.turns.push({
			session_id: sessionId,
			turn_index: turnIndex,
			user_message: truncateForStore(pendingUserMessage, MAX_USER_MESSAGE_LENGTH),
			timestamp: pendingUserTimestamp,
		});
	}

	if (!buffer.session) {
		buffer.session = { id: sessionId, host_type: 'vscode' };
	}

	store.runInTransaction(() => {
		store.upsertSession(buffer.session!);

		for (const turn of buffer.turns) {
			store.insertTurn(turn);
		}
		for (const file of buffer.files) {
			store.insertFile(file);
		}
		for (const ref of buffer.refs) {
			store.insertRef(ref);
		}
	});

	buffer.turns.length = 0;
	buffer.files.length = 0;
	buffer.refs.length = 0;
}

interface TurnPairingState {
	pendingUserMessage: string | undefined;
	pendingUserTimestamp: string | undefined;
	turnIndex: number;
}

function processEntry(
	entry: IDebugLogEntry,
	sessionId: string,
	buffer: PerSessionWriteBuffer,
	state: TurnPairingState,
): void {
	switch (entry.type) {
		case 'session_start':
			processSessionStart(entry, sessionId, buffer);
			break;
		case 'user_message':
		case 'turn_start':
			processUserMessage(entry, state);
			break;
		case 'agent_response':
			processAssistantResponse(entry, sessionId, buffer, state);
			break;
		case 'tool_call':
			processToolCall(entry, sessionId, buffer, state);
			break;
	}
}

function processSessionStart(
	entry: IDebugLogEntry,
	sessionId: string,
	buffer: PerSessionWriteBuffer,
): void {
	const attrs = entry.attrs;
	buffer.session = {
		id: sessionId,
		host_type: 'vscode',
		cwd: typeof attrs.cwd === 'string' ? attrs.cwd : undefined,
		repository: typeof attrs.repository === 'string' ? attrs.repository : undefined,
		branch: typeof attrs.branch === 'string' ? attrs.branch : undefined,
		created_at: new Date(entry.ts).toISOString(),
	};
}

function processUserMessage(
	entry: IDebugLogEntry,
	state: TurnPairingState,
): void {
	const content = typeof entry.attrs.content === 'string'
		? entry.attrs.content
		: typeof entry.attrs.userRequest === 'string'
			? entry.attrs.userRequest
			: undefined;
	if (content) {
		state.pendingUserMessage = content;
		state.pendingUserTimestamp = new Date(entry.ts).toISOString();
	}
}

function processAssistantResponse(
	entry: IDebugLogEntry,
	sessionId: string,
	buffer: PerSessionWriteBuffer,
	state: TurnPairingState,
): void {
	const responseRaw = entry.attrs.response as string | undefined;
	const assistantResponse = extractAssistantResponse(responseRaw);

	if (!state.pendingUserMessage && !assistantResponse) {
		return;
	}

	buffer.turns.push({
		session_id: sessionId,
		turn_index: state.turnIndex,
		user_message: truncateForStore(state.pendingUserMessage, MAX_USER_MESSAGE_LENGTH),
		assistant_response: truncateForStore(assistantResponse, MAX_ASSISTANT_RESPONSE_LENGTH),
		timestamp: state.pendingUserTimestamp ?? new Date(entry.ts).toISOString(),
	});

	if (!buffer.session?.summary && state.pendingUserMessage) {
		const summary = truncateForStore(extractPlainTextFromContent(state.pendingUserMessage), MAX_SUMMARY_LENGTH);
		if (!buffer.session) {
			buffer.session = { id: sessionId, host_type: 'vscode' };
		}
		buffer.session.summary = summary;
	}

	state.turnIndex++;
	state.pendingUserMessage = undefined;
	state.pendingUserTimestamp = undefined;
}

function processToolCall(
	entry: IDebugLogEntry,
	sessionId: string,
	buffer: PerSessionWriteBuffer,
	state: TurnPairingState,
): void {
	const toolName = entry.name;
	const toolArgs = tryParseArgs(entry.attrs.args);
	const resultText = typeof entry.attrs.result === 'string' ? entry.attrs.result : undefined;

	const filePath = extractFilePath(toolName, toolArgs);
	if (filePath) {
		buffer.files.push({
			session_id: sessionId,
			file_path: filePath,
			tool_name: toolName,
			turn_index: state.turnIndex,
		});
	}

	if (isGitHubMcpTool(toolName)) {
		const refs = extractRefsFromMcpTool(toolName, toolArgs);
		for (const ref of refs) {
			buffer.refs.push({ session_id: sessionId, ...ref, turn_index: state.turnIndex });
		}

		const repo = extractRepoFromMcpTool(toolArgs);
		if (repo) {
			if (!buffer.session) {
				buffer.session = { id: sessionId, host_type: 'vscode' };
			}
			buffer.session.repository = repo;
		}
	}

	if (isTerminalTool(toolName)) {
		const refs = extractRefsFromTerminal(toolArgs, resultText);
		for (const ref of refs) {
			buffer.refs.push({ session_id: sessionId, ...ref, turn_index: state.turnIndex });
		}
	}
}
