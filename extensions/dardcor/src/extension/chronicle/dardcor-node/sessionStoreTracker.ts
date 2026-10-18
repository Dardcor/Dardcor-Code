/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IChatSessionService } from '../../../platform/chat/common/chatSessionService';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { type FileRow, type RefRow, type SessionRow, type TurnRow, ISessionStore } from '../../../platform/chronicle/common/sessionStore';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { DardcorChatAttr, GenAiAttr, GenAiOperationName } from '../../../platform/otel/common/genAiAttributes';
import { type ICompletedSpanData, IOTelService } from '../../../platform/otel/common/otelService';
import { Disposable, DisposableStore } from '../../../util/dardcor/base/common/lifecycle';
import { autorun } from '../../../util/dardcor/base/common/observableInternal';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { IExtensionContribution } from '../../common/contributions';
import {
	MAX_ASSISTANT_RESPONSE_LENGTH,
	MAX_SUMMARY_LENGTH,
	extractAgentName,
	extractAssistantResponse,
	extractFilePath,
	extractPlainTextFromContent,
	extractRefsFromMcpTool,
	extractRefsFromTerminal,
	extractRepoFromMcpTool,
	extractToolArgs,
	isGitHubMcpTool,
	isTerminalTool,
	truncateForStore,
} from '../common/sessionStoreTracking';

const FLUSH_INTERVAL_MS = 3_000;

const SESSION_UPSERT_COOLDOWN_MS = 30_000;

interface WriteBuffer {
	sessions: Map<string, SessionRow>;
	files: FileRow[];
	refs: RefRow[];
	turns: TurnRow[];
}

export class SessionStoreTracker extends Disposable implements IExtensionContribution {

	private readonly _initializedSessions = new Set<string>();

	private readonly _buffer: WriteBuffer = {
		sessions: new Map(),
		files: [],
		refs: [],
		turns: [],
	};

	private _flushTimer: ReturnType<typeof setInterval> | undefined;

	private readonly _lastSessionTimestamp = new Map<string, number>();

	private readonly _turnCounters = new Map<string, number>();

	private readonly _pendingToolSpans = new Map<string, ICompletedSpanData[]>();

	constructor(
		@ISessionStore private readonly _sessionStore: ISessionStore,
		@IOTelService private readonly _otelService: IOTelService,
		@IChatSessionService private readonly _chatSessionService: IChatSessionService,
		@IConfigurationService private readonly _configService: IConfigurationService,
		@IExperimentationService private readonly _expService: IExperimentationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();

		const featureEnabled = this._configService.getExperimentBasedConfigObservable(ConfigKey.LocalIndexEnabled, this._expService);
		const spanListenerStore = this._register(new DisposableStore());
		this._register(autorun(reader => {
			spanListenerStore.clear();
			if (!featureEnabled.read(reader)) {
				return;
			}

			try {
				this._sessionStore.getStats();
			} catch (err) {
				this._telemetryService.sendMSFTTelemetryErrorEvent('chronicle.localStore', {
					operation: 'dbInit',
					success: 'false',
					error: err instanceof Error ? err.message.substring(0, 100) : 'unknown',
				}, {});
			}

			this._flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS);
			spanListenerStore.add({ dispose: () => { if (this._flushTimer) { clearInterval(this._flushTimer); this._flushTimer = undefined; } } });

			spanListenerStore.add(this._otelService.onDidCompleteSpan(span => {
				queueMicrotask(() => this._handleSpan(span));
			}));

			spanListenerStore.add(this._chatSessionService.onDidDisposeChatSession(sessionId => {
				this._initializedSessions.delete(sessionId);
				this._lastSessionTimestamp.delete(sessionId);
				this._turnCounters.delete(sessionId);
				this._pendingToolSpans.delete(sessionId);
			}));
		}));
	}

	override dispose(): void {
		if (this._flushTimer !== undefined) {
			clearInterval(this._flushTimer);
			this._flushTimer = undefined;
		}
		this._flush();
		super.dispose();
	}


	private _handleSpan(span: ICompletedSpanData): void {
		try {
			const operationName = span.attributes[GenAiAttr.OPERATION_NAME] as string | undefined;

			const parentChatSessionId = span.attributes[DardcorChatAttr.PARENT_CHAT_SESSION_ID] as string | undefined;
			if (parentChatSessionId) {
				if (operationName === GenAiOperationName.EXECUTE_TOOL && this._initializedSessions.has(parentChatSessionId)) {
					this._handleToolSpan(parentChatSessionId, span);
				}
				return;
			}

			const sessionId = this._getSessionId(span);
			if (!sessionId) {
				return;
			}

			if (!this._initializedSessions.has(sessionId)) {
				if (operationName === GenAiOperationName.EXECUTE_TOOL) {
					let pending = this._pendingToolSpans.get(sessionId);
					if (!pending) {
						pending = [];
						this._pendingToolSpans.set(sessionId, pending);
					}
					pending.push(span);
					return;
				}
				if (operationName !== GenAiOperationName.INVOKE_AGENT) {
					return;
				}
				this._initSession(sessionId, span);
			}

			this._backfillFromSpanAttributes(sessionId, span);

			if (operationName === GenAiOperationName.INVOKE_AGENT) {
				this._handleAgentSpan(sessionId, span);
			}

			if (operationName === GenAiOperationName.EXECUTE_TOOL) {
				this._handleToolSpan(sessionId, span);
			}

			this._bufferSessionTimestamp(sessionId);
		} catch {
		}
	}

	private _getSessionId(span: ICompletedSpanData): string | undefined {
		return (span.attributes[DardcorChatAttr.CHAT_SESSION_ID] as string | undefined)
			?? (span.attributes[GenAiAttr.CONVERSATION_ID] as string | undefined)
			?? (span.attributes[DardcorChatAttr.SESSION_ID] as string | undefined);
	}

	private _initSession(sessionId: string, span: ICompletedSpanData): void {
		this._initializedSessions.add(sessionId);

		const sessionSource = extractAgentName(span);
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		this._bufferSessionUpsert({ id: sessionId, host_type: 'vscode', agent_name: sessionSource, ...(cwd ? { cwd } : {}) });

		if (!this._firstWriteSessionSource) {
			this._firstWriteSessionSource = sessionSource;
		}

		const pendingSpans = this._pendingToolSpans.get(sessionId);
		const pendingCount = pendingSpans?.length ?? 0;
		if (pendingSpans) {
			this._pendingToolSpans.delete(sessionId);
			for (const toolSpan of pendingSpans) {
				this._handleToolSpan(sessionId, toolSpan);
			}
		}

		this._telemetryService.sendMSFTTelemetryEvent('chronicle.localStore', {
			operation: 'sessionInit',
			sessionSource,
		}, {
			pendingSpansProcessed: pendingCount,
		});
	}

	private _backfillFromSpanAttributes(sessionId: string, span: ICompletedSpanData): void {
		const branch = span.attributes[DardcorChatAttr.REPO_HEAD_BRANCH_NAME] as string | undefined;
		const remoteUrl = span.attributes[DardcorChatAttr.REPO_REMOTE_URL] as string | undefined;
		const userRequest = span.attributes[DardcorChatAttr.USER_REQUEST] as string | undefined;

		if (branch || remoteUrl || userRequest) {
			const summary = userRequest ? truncateForStore(extractPlainTextFromContent(userRequest), MAX_SUMMARY_LENGTH) : undefined;

			this._bufferSessionUpsert({
				id: sessionId,
				...(branch ? { branch } : {}),
				...(remoteUrl ? { repository: remoteUrl } : {}),
				...(summary ? { summary } : {}),
			});
		}

		const agentName = extractAgentName(span);
		if (agentName !== 'unknown') {
			this._bufferSessionUpsert({ id: sessionId, agent_name: agentName });
		}
	}

	private _handleToolSpan(sessionId: string, span: ICompletedSpanData): void {
		const toolName = span.attributes[GenAiAttr.TOOL_NAME] as string | undefined;
		if (!toolName) {
			return;
		}

		const turnIndex = span.attributes[DardcorChatAttr.TURN_INDEX] as number | undefined;
		const toolArgs = extractToolArgs(span);

		const filePath = extractFilePath(toolName, toolArgs);
		if (filePath) {
			this._buffer.files.push({
				session_id: sessionId,
				file_path: filePath,
				tool_name: toolName,
				turn_index: turnIndex,
			});
		}

		if (isGitHubMcpTool(toolName)) {
			const refs = extractRefsFromMcpTool(toolName, toolArgs);
			for (const ref of refs) {
				this._buffer.refs.push({ session_id: sessionId, ...ref, turn_index: turnIndex });
			}

			const repo = extractRepoFromMcpTool(toolArgs);
			if (repo) {
				this._bufferSessionUpsert({ id: sessionId, repository: repo });
			}
		}

		if (isTerminalTool(toolName)) {
			const resultText = span.attributes['gen_ai.tool.result'] as string | undefined;
			const refs = extractRefsFromTerminal(toolArgs, resultText);
			for (const ref of refs) {
				this._buffer.refs.push({ session_id: sessionId, ...ref, turn_index: turnIndex });
			}
		}
	}

	private _handleAgentSpan(sessionId: string, span: ICompletedSpanData): void {
		const userRequest = span.attributes[DardcorChatAttr.USER_REQUEST] as string | undefined;

		const userMessages: { turnIndex: number; content: string }[] = [];
		let turnCounter = 0;

		for (const event of span.events) {
			if (event.name === 'user_message') {
				const content = event.attributes?.['content'] as string | undefined;
				if (content) {
					userMessages.push({ turnIndex: turnCounter, content });
				}
				turnCounter++;
			}
		}

		if (userMessages.length === 0 && userRequest) {
			userMessages.push({ turnIndex: 0, content: userRequest });
		}

		const existingSession = this._buffer.sessions.get(sessionId);
		if (!existingSession?.summary) {
			const rawFirst = userMessages[0]?.content ?? userRequest;
			const summary = rawFirst ? truncateForStore(extractPlainTextFromContent(rawFirst), MAX_SUMMARY_LENGTH) : undefined;
			if (summary) {
				this._bufferSessionUpsert({ id: sessionId, summary });
			}
		}

		const fullResponse = extractAssistantResponse(span.attributes[GenAiAttr.OUTPUT_MESSAGES] as string | undefined);
		const assistantResponse = truncateForStore(fullResponse, MAX_ASSISTANT_RESPONSE_LENGTH);

		if (!this._turnCounters.has(sessionId)) {
			this._turnCounters.set(sessionId, this._sessionStore.getMaxTurnIndex(sessionId) + 1);
		}
		for (let i = 0; i < userMessages.length; i++) {
			const msg = userMessages[i];
			const absoluteTurnIndex = this._turnCounters.get(sessionId)!;
			this._turnCounters.set(sessionId, absoluteTurnIndex + 1);
			this._buffer.turns.push({
				session_id: sessionId,
				turn_index: absoluteTurnIndex,
				user_message: msg.content,
				...(i === userMessages.length - 1 && assistantResponse
					? { assistant_response: assistantResponse }
					: {}),
			});
		}
	}


	private _bufferSessionUpsert(session: SessionRow): void {
		const existing = this._buffer.sessions.get(session.id);
		if (existing) {
			this._buffer.sessions.set(session.id, {
				...existing,
				...(session.cwd ? { cwd: session.cwd } : {}),
				...(session.repository ? { repository: session.repository } : {}),
				...(session.host_type ? { host_type: session.host_type } : {}),
				...(session.branch ? { branch: session.branch } : {}),
				...(session.summary ? { summary: session.summary } : {}),
				...(session.agent_name && session.agent_name !== 'unknown' ? { agent_name: session.agent_name } : {}),
			});
		} else {
			this._buffer.sessions.set(session.id, { ...session });
		}
	}

	private _bufferSessionTimestamp(sessionId: string): void {
		const now = Date.now();
		const last = this._lastSessionTimestamp.get(sessionId) ?? 0;
		if (now - last < SESSION_UPSERT_COOLDOWN_MS) {
			return;
		}
		this._lastSessionTimestamp.set(sessionId, now);
		this._bufferSessionUpsert({ id: sessionId, host_type: 'vscode' });
	}

	private _firstWriteLogged = false;

	private _firstWriteSessionSource: string | undefined;


	private _flush(): void {
		const { sessions, files, refs, turns } = this._buffer;
		const totalOps = sessions.size + files.length + refs.length + turns.length;
		if (totalOps === 0) {
			return;
		}

		const sessionsToFlush = [...sessions.values()];
		const filesToFlush = [...files];
		const refsToFlush = [...refs];
		const turnsToFlush = [...turns];
		sessions.clear();
		files.length = 0;
		refs.length = 0;
		turns.length = 0;

		try {
			this._sessionStore.runInTransaction(() => {
				for (const session of sessionsToFlush) {
					this._sessionStore.upsertSession(session);
				}
				for (const file of filesToFlush) {
					this._sessionStore.insertFile(file);
				}
				for (const ref of refsToFlush) {
					this._sessionStore.insertRef(ref);
				}
				for (const turn of turnsToFlush) {
					this._sessionStore.insertTurn(turn);
				}
			});

			if (!this._firstWriteLogged) {
				this._firstWriteLogged = true;

				this._telemetryService.sendMSFTTelemetryEvent('chronicle.localStore', {
					operation: 'firstWrite',
					sessionSource: this._firstWriteSessionSource ?? 'unknown',
				}, {
					filesCount: filesToFlush.length,
					refsCount: refsToFlush.length,
				});
			}
		} catch (err) {

			this._requeueFailedFlush(sessionsToFlush, filesToFlush, refsToFlush, turnsToFlush);

			this._telemetryService.sendMSFTTelemetryErrorEvent('chronicle.localStore', {
				operation: 'flush',
				success: 'false',
				error: err instanceof Error ? err.message.substring(0, 100) : 'unknown',
			}, { opsCount: totalOps });
		}
	}

	private _requeueFailedFlush(sessions: SessionRow[], files: FileRow[], refs: RefRow[], turns: TurnRow[]): void {
		for (const session of sessions) {
			if (!this._buffer.sessions.has(session.id)) {
				this._buffer.sessions.set(session.id, session);
			}
		}

		this._buffer.files = files.concat(this._buffer.files);
		this._buffer.refs = refs.concat(this._buffer.refs);
		this._buffer.turns = turns.concat(this._buffer.turns);
	}
}
