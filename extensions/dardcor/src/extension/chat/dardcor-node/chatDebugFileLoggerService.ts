/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as vscode from 'vscode';
import { IChatDebugFileLoggerService, IDebugLogEntry, sessionResourceToId } from '../../../platform/chat/common/chatDebugFileLoggerService';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEnvService } from '../../../platform/env/common/envService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { DardcorChatAttr, GenAiAttr, GenAiOperationName } from '../../../platform/otel/common/index';
import { ICompletedSpanData, IOTelService, ISpanEventData, SpanStatusCode } from '../../../platform/otel/common/otelService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { Emitter } from '../../../util/dardcor/base/common/event';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { extUriBiasedIgnorePathCase } from '../../../util/dardcor/base/common/resources';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IExtensionContribution } from '../../common/contributions';

const DEBUG_LOGS_DIR_NAME = 'debug-logs';
const DEFAULT_MAX_RETAINED_LOGS = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 4_000;
const MIN_FLUSH_INTERVAL_MS = 2_000;
const MAX_ATTR_VALUE_LENGTH = 5_000;
const MAX_PENDING_CORE_EVENTS = 100;
const DEFAULT_MAX_SESSION_LOG_MB = 100;
const TRUNCATION_RETAIN_RATIO = 0.6;
const MAX_SPAN_SESSION_INDEX = 10_000;


interface IActiveLogSession {
	readonly uri: URI;
	readonly sessionDir: URI;
	readonly buffer: string[];
	flushPromise: Promise<void>;
	dirEnsured: boolean;
	bytesWritten: number;
	readonly parentSessionId?: string;
	readonly label?: string;
	hasOwnSpans: boolean;
	modelSnapshotWritten: boolean;
	systemPromptKey: string | undefined;
	systemPromptIndex: number;
	currentSystemPromptFile: string | undefined;
	toolsKey: string | undefined;
	toolsIndex: number;
	currentToolsFile: string | undefined;
	pendingToolDefs: string | undefined;
	resumeChecked: boolean;
	runIndex: number;
}

export type { IDebugLogEntry } from '../../../platform/chat/common/chatDebugFileLoggerService';

export class ChatDebugFileLoggerService extends Disposable implements IChatDebugFileLoggerService {
	declare readonly _serviceBrand: undefined;

	public readonly id = 'chatDebugFileLogger';

	private readonly _onDidEmitEntry = this._register(new Emitter<{ sessionId: string; entry: IDebugLogEntry }>());
	readonly onDidEmitEntry = this._onDidEmitEntry.event;

	private readonly _activeSessions = new Map<string, IActiveLogSession>();
	private readonly _childSessionMap = new Map<string, { parentSessionId: string; label: string; parentToolSpanId?: string }>();
	private readonly _spanSessionIndex = new Map<string, string>();
	private readonly _pendingCoreEvents: IDebugLogEntry[] = [];
	private _modelSnapshot: readonly unknown[] | undefined;
	private _debugLogsDirUri: URI | undefined;
	private _autoFlushTimer: ReturnType<typeof setInterval> | undefined;
	private _autoFlushIntervalMs: number;
	private _maxSessionLogBytes: number;
	private _totalBytesWritten = 0;
	private _totalSessionCount = 0;

	constructor(
		@IOTelService private readonly _otelService: IOTelService,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExperimentationService private readonly _experimentationService: IExperimentationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IEnvService private readonly _envService: IEnvService,
	) {
		super();

		const enabled = this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.ChatDebugFileLogging, this._experimentationService);
		if (!enabled) {
			this._telemetryService.sendMSFTTelemetryEvent('chatDebugFileLogger.disabled');
			this._autoFlushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS;
			this._maxSessionLogBytes = DEFAULT_MAX_SESSION_LOG_MB * 1024 * 1024;
			return;
		}

		this._autoFlushIntervalMs = Math.max(MIN_FLUSH_INTERVAL_MS, this._configurationService.getConfig(ConfigKey.Advanced.ChatDebugFileLoggingFlushInterval) ?? DEFAULT_FLUSH_INTERVAL_MS);
		this._maxSessionLogBytes = this._resolveMaxSessionLogBytes();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ConfigKey.Advanced.ChatDebugFileLoggingFlushInterval.fullyQualifiedId)) {
				this._autoFlushIntervalMs = Math.max(MIN_FLUSH_INTERVAL_MS, this._configurationService.getConfig(ConfigKey.Advanced.ChatDebugFileLoggingFlushInterval) ?? DEFAULT_FLUSH_INTERVAL_MS);
				this._restartFlushTimer();
			}
			if (e.affectsConfiguration(ConfigKey.Advanced.ChatDebugFileLoggingMaxSessionLogSizeMB.fullyQualifiedId)) {
				this._maxSessionLogBytes = this._resolveMaxSessionLogBytes();
			}
		}));

		this._register(this._otelService.onDidCompleteSpan(span => {
			this._onSpanCompleted(span);
		}));

		this._register(this._otelService.onDidEmitSpanEvent(event => {
			this._onSpanEvent(event);
		}));

		if (typeof vscode.chat?.onDidReceiveChatDebugEvent === 'function') {
			this._register(vscode.chat.onDidReceiveChatDebugEvent(event => {
				this._onCoreDebugEvent(event);
			}));
		}
	}

	private _resolveMaxSessionLogBytes(): number {
		const raw = this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.ChatDebugFileLoggingMaxSessionLogSizeMB, this._experimentationService);
		const mb = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_MAX_SESSION_LOG_MB;
		return Math.max(1, Math.floor(mb)) * 1024 * 1024;
	}

	override dispose(): void {
		if (this._autoFlushTimer) {
			clearInterval(this._autoFlushTimer);
			this._autoFlushTimer = undefined;
		}
		for (const session of this._activeSessions.values()) {
			this._totalBytesWritten += session.bytesWritten;
		}
		this._telemetryService.sendMSFTTelemetryEvent('chatDebugFileLogger.end', undefined, { totalBytesWritten: this._totalBytesWritten, sessionCount: this._totalSessionCount });
		super.dispose();
	}

	public get debugLogsDir(): URI | undefined {
		return this._getDebugLogsDir();
	}

	private _getDebugLogsDir(): URI | undefined {
		if (this._debugLogsDirUri) {
			return this._debugLogsDirUri;
		}

		const storageUri = (this._extensionContext.storageUri ?? this._extensionContext.globalStorageUri) as URI | undefined;
		if (!storageUri) {
			return undefined;
		}
		this._debugLogsDirUri = URI.joinPath(storageUri, DEBUG_LOGS_DIR_NAME);
		return this._debugLogsDirUri;
	}










	private _getCandidateDebugLogsRoots(): URI[] {
		const roots: URI[] = [];
		const seen = new Set<string>();
		const add = (base: URI | undefined) => {
			if (!base) {
				return;
			}
			const dir = URI.joinPath(base, DEBUG_LOGS_DIR_NAME);
			if (!seen.has(dir.fsPath)) {
				seen.add(dir.fsPath);
				roots.push(dir);
			}
		};
		add(this._extensionContext.storageUri as URI | undefined);
		add(this._extensionContext.globalStorageUri as URI | undefined);
		return roots;
	}

	private _resolveHistoricalSessionDir(sessionId: string): URI | undefined {
		for (const root of this._getCandidateDebugLogsRoots()) {
			const candidate = URI.joinPath(root, sessionId);
			try {
				if (fs.statSync(candidate.fsPath).isDirectory()) {
					return candidate;
				}
			} catch {
			}
		}
		return undefined;
	}

	private _resolveParentSessionDir(parentSessionId: string, fallbackRoot: URI): URI {
		return this._activeSessions.get(parentSessionId)?.sessionDir
			?? this._resolveHistoricalSessionDir(parentSessionId)
			?? URI.joinPath(fallbackRoot, parentSessionId);
	}

	async startSession(sessionId: string): Promise<void> {
		this._ensureSession(sessionId, true);
	}

	startChildSession(childSessionId: string, parentSessionId: string, label: string, parentToolSpanId?: string): void {
		if (!this._childSessionMap.has(childSessionId)) {
			this._childSessionMap.set(childSessionId, { parentSessionId, label, parentToolSpanId });
		}
	}

	registerSpanSession(spanId: string, sessionId: string): void {
		this._spanSessionIndex.set(spanId, sessionId);
		if (this._spanSessionIndex.size > MAX_SPAN_SESSION_INDEX) {
			const excess = this._spanSessionIndex.size - MAX_SPAN_SESSION_INDEX;
			const iter = this._spanSessionIndex.keys();
			for (let i = 0; i < excess; i++) {
				this._spanSessionIndex.delete(iter.next().value!);
			}
		}
	}

	private _ensureSession(sessionId: string, hasOwnSpans = false): void {
		const existing = this._activeSessions.get(sessionId);
		if (existing) {
			if (hasOwnSpans && !existing.hasOwnSpans) {
				existing.hasOwnSpans = true;
				if (!existing.parentSessionId) {
					this._emitSessionStartAndReplay(sessionId, existing);
				}
			}
			return;
		}

		this._totalSessionCount++;

		const dir = this._getDebugLogsDir();
		if (!dir) {
			return;
		}

		const childInfo = this._childSessionMap.get(sessionId);
		let sessionDir: URI;
		let fileUri: URI;

		if (childInfo) {
			this._ensureSession(childInfo.parentSessionId, true);

			sessionDir = this._resolveParentSessionDir(childInfo.parentSessionId, dir);
			const safeLabel = childInfo.label.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').replace(/\.\./g, '_');
			const fileName = `${safeLabel}-${sessionId}.jsonl`;
			fileUri = URI.joinPath(sessionDir, fileName);

			this._bufferEntry(childInfo.parentSessionId, {
				ts: Date.now(),
				dur: 0,
				sid: childInfo.parentSessionId,
				type: 'child_session_ref',
				name: childInfo.label,
				spanId: `child-ref-${sessionId}`,
				...(childInfo.parentToolSpanId ? { parentSpanId: childInfo.parentToolSpanId } : {}),
				status: 'ok',
				attrs: {
					childSessionId: sessionId,
					childLogFile: `${safeLabel}-${sessionId}.jsonl`,
					label: childInfo.label,
				},
			});
		} else {
			sessionDir = this._resolveHistoricalSessionDir(sessionId) ?? URI.joinPath(dir, sessionId);
			fileUri = URI.joinPath(sessionDir, 'main.jsonl');
		}

		const session: IActiveLogSession = {
			uri: fileUri,
			sessionDir,
			buffer: [],
			flushPromise: Promise.resolve(),
			dirEnsured: false,
			bytesWritten: 0,
			parentSessionId: childInfo?.parentSessionId,
			label: childInfo?.label,
			hasOwnSpans,
			modelSnapshotWritten: false,
			systemPromptKey: undefined,
			systemPromptIndex: 0,
			currentSystemPromptFile: undefined,
			toolsKey: undefined,
			toolsIndex: 0,
			currentToolsFile: undefined,
			pendingToolDefs: undefined,
			resumeChecked: false,
			runIndex: 0,
		};
		this._activeSessions.set(sessionId, session);

		if (childInfo) {
			this._bufferEntry(sessionId, {
				v: 1,
				ts: Date.now(),
				dur: 0,
				sid: sessionId,
				type: 'session_start',
				name: 'session_start',
				spanId: `session-start-${sessionId}`,
				status: 'ok',
				attrs: {
					dardcorVersion: this._envService.getVersion(),
					vscodeVersion: this._envService.vscodeVersion,
					parentSessionId: childInfo.parentSessionId,
					label: childInfo.label,
				},
			});
		} else if (hasOwnSpans) {
			this._emitSessionStartAndReplay(sessionId, session);
		}

		if (this._activeSessions.size === 1 && !this._autoFlushTimer) {
			this._autoFlushTimer = setInterval(() => this._autoFlushAll(), this._autoFlushIntervalMs);
		}

		this._cleanupOldLogs().catch(() => { });
	}

	async endSession(sessionId: string): Promise<void> {
		await this.flush(sessionId);
		const session = this._activeSessions.get(sessionId);
		if (session) {
			this._totalBytesWritten += session.bytesWritten;
		}
		this._activeSessions.delete(sessionId);

		for (const [spanId, sid] of this._spanSessionIndex) {
			if (sid === sessionId) {
				this._spanSessionIndex.delete(spanId);
			}
		}

		if (this._activeSessions.size === 0 && this._autoFlushTimer) {
			clearInterval(this._autoFlushTimer);
			this._autoFlushTimer = undefined;
		}
	}

	async flush(sessionId: string): Promise<void> {
		const session = this._activeSessions.get(sessionId);
		if (!session) {
			return;
		}

		if (session.buffer.length === 0) {
			return session.flushPromise;
		}

		if (!session.parentSessionId && !session.hasOwnSpans) {
			return;
		}

		const lines = session.buffer.splice(0);
		const content = lines.join('');

		session.flushPromise = session.flushPromise.then(
			() => this._writeToFile(session, content),
			() => this._writeToFile(session, content),
		);
		return session.flushPromise;
	}

	getLogPath(sessionId: string): URI | undefined {
		const active = this._activeSessions.get(sessionId);
		if (active) {
			return active.uri;
		}
		const childInfo = this._childSessionMap.get(sessionId);
		if (childInfo) {
			const dir = this._getDebugLogsDir();
			if (!dir) { return undefined; }
			const parentDir = this._resolveParentSessionDir(childInfo.parentSessionId, dir);
			return URI.joinPath(parentDir, `${childInfo.label}-${sessionId}.jsonl`);
		}
		const sessionDir = this.getSessionDir(sessionId);
		return sessionDir ? URI.joinPath(sessionDir, 'main.jsonl') : undefined;
	}

	getSessionDir(sessionId: string): URI | undefined {
		const active = this._activeSessions.get(sessionId);
		if (active) {
			return active.sessionDir;
		}
		const childInfo = this._childSessionMap.get(sessionId);
		if (childInfo) {
			const dir = this._getDebugLogsDir();
			return dir ? this._resolveParentSessionDir(childInfo.parentSessionId, dir) : undefined;
		}
		const existing = this._resolveHistoricalSessionDir(sessionId);
		if (existing) {
			return existing;
		}
		const dir = this._getDebugLogsDir();
		return dir ? URI.joinPath(dir, sessionId) : undefined;
	}

	getActiveSessionIds(): string[] {
		return [...this._activeSessions.keys()];
	}

	isDebugLogUri(uri: URI): boolean {
		for (const dir of this._getCandidateDebugLogsRoots()) {
			if (extUriBiasedIgnorePathCase.isEqualOrParent(uri, dir)) {
				return true;
			}
		}
		return false;
	}

	getSessionDirForResource(sessionResource: URI): URI | undefined {
		const sessionId = sessionResourceToId(sessionResource);
		return this.getSessionDir(sessionId);
	}

	setModelSnapshot(models: readonly unknown[]): void {
		this._modelSnapshot = models;
		for (const [, session] of this._activeSessions) {
			if (!session.parentSessionId && session.hasOwnSpans) {
				this._enqueueModelSnapshotWrite(session);
			}
		}
	}

	private _enqueueModelSnapshotWrite(session: IActiveLogSession): void {
		session.flushPromise = session.flushPromise.then(
			() => this._writeModelSnapshot(session),
			() => this._writeModelSnapshot(session),
		);
	}

	private async _writeModelSnapshot(session: IActiveLogSession): Promise<void> {
		if (!this._modelSnapshot || session.modelSnapshotWritten) {
			return;
		}
		try {
			if (!session.dirEnsured) {
				await createDirectoryIfNotExists(this._fileSystemService, session.sessionDir);
				session.dirEnsured = true;
			}
			const modelsUri = URI.joinPath(session.sessionDir, 'models.json');
			await fs.promises.writeFile(modelsUri.fsPath, JSON.stringify(this._modelSnapshot, null, 2), 'utf-8');
			session.modelSnapshotWritten = true;
		} catch (err) {
			this._logService.error('[ChatDebugFileLogger] Failed to write models.json', err);
		}
	}

	private _enqueueFileWrite(session: IActiveLogSession, content: string, fileName: string): void {
		session.flushPromise = session.flushPromise.then(
			() => this._writeSessionFile(session, content, fileName),
			() => this._writeSessionFile(session, content, fileName),
		);
	}

	private async _writeSessionFile(session: IActiveLogSession, content: string, fileName: string): Promise<void> {
		try {
			if (!session.dirEnsured) {
				await createDirectoryIfNotExists(this._fileSystemService, session.sessionDir);
				session.dirEnsured = true;
			}
			const fileUri = URI.joinPath(session.sessionDir, fileName);
			await fs.promises.writeFile(fileUri.fsPath, fileName.endsWith('.json') ? JSON.stringify({ content }, null, 2) : content, 'utf-8');
		} catch (err) {
			this._logService.error(`[ChatDebugFileLogger] Failed to write ${fileName}`, err);
		}
	}

	private _emitSessionStartAndReplay(sessionId: string, session: IActiveLogSession): void {
		this._bufferEntry(sessionId, {
			v: 1,
			ts: Date.now(),
			dur: 0,
			sid: sessionId,
			type: 'session_start',
			name: 'session_start',
			spanId: `session-start-${sessionId}`,
			status: 'ok',
			attrs: {
				dardcorVersion: this._envService.getVersion(),
				vscodeVersion: this._envService.vscodeVersion,
			},
		});
		for (const entry of this._pendingCoreEvents) {
			this._bufferEntry(sessionId, { ...entry, sid: sessionId });
		}
		if (this._modelSnapshot) {
			this._enqueueModelSnapshotWrite(session);
		}
		if (session.pendingToolDefs) {
			const fileName = `tools_${session.toolsIndex}.json`;
			session.toolsIndex++;
			session.currentToolsFile = fileName;
			this._enqueueFileWrite(session, session.pendingToolDefs, fileName);
			session.pendingToolDefs = undefined;
		}
	}


	private _onSpanCompleted(span: ICompletedSpanData): void {
		const sessionId = this._extractSessionId(span);
		if (!sessionId) {
			return;
		}

		this._spanSessionIndex.set(span.spanId, sessionId);
		if (this._spanSessionIndex.size > MAX_SPAN_SESSION_INDEX) {
			const excess = this._spanSessionIndex.size - MAX_SPAN_SESSION_INDEX;
			const iter = this._spanSessionIndex.keys();
			for (let i = 0; i < excess; i++) {
				this._spanSessionIndex.delete(iter.next().value!);
			}
		}

		const parentChatSessionId = asString(span.attributes[DardcorChatAttr.PARENT_CHAT_SESSION_ID]);
		const debugLogLabel = asString(span.attributes[DardcorChatAttr.DEBUG_LOG_LABEL]);
		if (parentChatSessionId && debugLogLabel && !this._childSessionMap.has(sessionId)) {
			this._childSessionMap.set(sessionId, { parentSessionId: parentChatSessionId, label: debugLogLabel });
		}

		const entry = this._spanToEntry(span, sessionId);
		const opName = asString(span.attributes[GenAiAttr.OPERATION_NAME]);
		const outputMessages = opName === GenAiOperationName.CHAT
			? asString(span.attributes[GenAiAttr.OUTPUT_MESSAGES])
			: undefined;

		this._ensureSession(sessionId);

		const session = this._activeSessions.get(sessionId);
		if (session && !session.hasOwnSpans && !session.parentSessionId && !session.resumeChecked) {
			session.resumeChecked = true;
			const mainJsonl = URI.joinPath(session.sessionDir, 'main.jsonl');
			try {
				fs.accessSync(mainJsonl.fsPath);
				session.hasOwnSpans = true;
				session.dirEnsured = true;

				try {
					const tail = this._readTailBytes(mainJsonl.fsPath, 8192);
					let maxRIdx = 0;
					for (const line of tail.split('\n')) {
						if (!line.trim()) { continue; }
						try {
							const parsed = JSON.parse(line);
							if (typeof parsed.rIdx === 'number' && parsed.rIdx > maxRIdx) {
								maxRIdx = parsed.rIdx;
							}
						} catch { }
					}
					session.runIndex = maxRIdx + 1;
				} catch { }

				try {
					for (const f of fs.readdirSync(session.sessionDir.fsPath)) {
						const spIdx = f.startsWith('system_prompt_') ? parseInt(f.slice(14), 10) : -1;
						if (spIdx >= session.systemPromptIndex) { session.systemPromptIndex = spIdx + 1; }
						const tIdx = f.startsWith('tools_') ? parseInt(f.slice(6), 10) : -1;
						if (tIdx >= session.toolsIndex) { session.toolsIndex = tIdx + 1; }
					}
				} catch { }
			} catch {
			}
		}

		if (opName === GenAiOperationName.CHAT) {
			const session = this._activeSessions.get(sessionId);
			if (session && session.hasOwnSpans && !session.parentSessionId) {
				const model = asString(span.attributes[GenAiAttr.REQUEST_MODEL])
					?? asString(span.attributes[GenAiAttr.RESPONSE_MODEL])
					?? 'unknown';
				const systemInstructions = asString(span.attributes[GenAiAttr.SYSTEM_INSTRUCTIONS]);
				if (systemInstructions) {
					const key = `${model}:${systemInstructions.length}`;
					if (key !== session.systemPromptKey) {
						const fileName = `system_prompt_${session.systemPromptIndex}.json`;
						session.systemPromptKey = key;
						session.systemPromptIndex++;
						session.currentSystemPromptFile = fileName;
						this._enqueueFileWrite(session, systemInstructions, fileName);
					}
				}
			}
		}

		if (entry) {
			if (entry.type === 'llm_request') {
				const session = this._activeSessions.get(sessionId);
				if (session?.currentSystemPromptFile) {
					entry.attrs.systemPromptFile = session.currentSystemPromptFile;
				}
				if (session?.currentToolsFile) {
					entry.attrs.toolsFile = session.currentToolsFile;
				}
			}
			this._bufferEntry(sessionId, entry);
		}


		if (opName === GenAiOperationName.CHAT) {
			if (outputMessages) {
				const reasoningContent = asString(span.attributes[DardcorChatAttr.REASONING_CONTENT]);
				this._bufferEntry(sessionId, {
					ts: span.endTime,
					dur: 0,
					sid: sessionId,
					type: 'agent_response',
					name: 'agent_response',
					spanId: `agent-msg-${span.spanId}`,
					parentSpanId: span.parentSpanId,
					status: 'ok',
					attrs: {
						response: truncate(outputMessages, MAX_ATTR_VALUE_LENGTH),
						...(reasoningContent ? { reasoning: truncate(reasoningContent, MAX_ATTR_VALUE_LENGTH) } : {}),
					},
				});
			}
		}
	}

	private _onSpanEvent(event: ISpanEventData): void {
		if (event.eventName === 'turn_start' || event.eventName === 'turn_end') {
			this._onTurnBoundaryEvent(event);
			return;
		}

		if (event.eventName === 'tools_available') {
			this._onToolsAvailableEvent(event);
			return;
		}

		if (event.eventName !== 'user_message') {
			return;
		}
		const content = event.attributes.content;
		if (!content || (typeof content === 'string' && !content.trim())) {
			return;
		}

		const eventSessionId = event.attributes[DardcorChatAttr.CHAT_SESSION_ID];
		if (typeof eventSessionId === 'string') {
			this._ensureSession(eventSessionId);
			this._bufferEntry(eventSessionId, {
				ts: event.timestamp,
				dur: 0,
				sid: eventSessionId,
				type: 'user_message',
				name: 'user_message',
				spanId: event.spanId,
				parentSpanId: event.parentSpanId,
				status: 'ok',
				attrs: {
					content: truncate(String(content), MAX_ATTR_VALUE_LENGTH),
				},
			});
			return;
		}

		const inheritedSessionId = event.parentSpanId ? this._spanSessionIndex.get(event.parentSpanId) : undefined;
		if (inheritedSessionId && this._activeSessions.has(inheritedSessionId)) {
			this._bufferEntry(inheritedSessionId, {
				ts: event.timestamp,
				dur: 0,
				sid: inheritedSessionId,
				type: 'user_message',
				name: 'user_message',
				spanId: event.spanId,
				parentSpanId: event.parentSpanId,
				status: 'ok',
				attrs: {
					content: truncate(String(content), MAX_ATTR_VALUE_LENGTH),
				},
			});
			return;
		}

		const parentSessions = [...this._activeSessions.entries()]
			.filter(([, session]) => !session.parentSessionId && session.hasOwnSpans)
			.map(([id]) => id);
		if (parentSessions.length === 0) {
			return;
		}

		for (const sessionId of parentSessions) {
			const entry: IDebugLogEntry = {
				ts: event.timestamp,
				dur: 0,
				sid: sessionId,
				type: 'user_message',
				name: 'user_message',
				spanId: event.spanId,
				parentSpanId: event.parentSpanId,
				status: 'ok',
				attrs: {
					content: truncate(String(content), MAX_ATTR_VALUE_LENGTH),
				},
			};
			this._bufferEntry(sessionId, entry);
		}
	}

	private _onTurnBoundaryEvent(event: ISpanEventData): void {
		const type = event.eventName === 'turn_start' ? 'turn_start' : 'turn_end';
		const turnId = typeof event.attributes.turnId === 'string' ? event.attributes.turnId : String(event.attributes.turnId ?? '');
		const sessionId = typeof event.attributes[DardcorChatAttr.CHAT_SESSION_ID] === 'string'
			? event.attributes[DardcorChatAttr.CHAT_SESSION_ID] as string
			: (event.parentSpanId ? this._spanSessionIndex.get(event.parentSpanId) : undefined);

		if (!sessionId) {
			return;
		}

		this._ensureSession(sessionId);

		this._bufferEntry(sessionId, {
			ts: event.timestamp,
			dur: 0,
			sid: sessionId,
			type,
			name: `${type}:${turnId}`,
			spanId: `${type}-${event.spanId}-${turnId}`,
			parentSpanId: event.parentSpanId,
			status: 'ok',
			attrs: { turnId },
		});
	}

	private _onToolsAvailableEvent(event: ISpanEventData): void {
		const sessionId = typeof event.attributes[DardcorChatAttr.CHAT_SESSION_ID] === 'string'
			? event.attributes[DardcorChatAttr.CHAT_SESSION_ID] as string
			: (event.parentSpanId ? this._spanSessionIndex.get(event.parentSpanId) : undefined);

		if (!sessionId) {
			return;
		}

		const session = this._activeSessions.get(sessionId);
		if (!session || session.parentSessionId) {
			return;
		}

		if (!session.hasOwnSpans) {
			const toolDefs = typeof event.attributes.toolDefinitions === 'string' ? event.attributes.toolDefinitions : undefined;
			if (toolDefs) {
				session.pendingToolDefs = toolDefs;
			}
			return;
		}

		const toolDefs = typeof event.attributes.toolDefinitions === 'string' ? event.attributes.toolDefinitions : undefined;
		if (!toolDefs) {
			return;
		}

		const key = `tools:${toolDefs.length}`;
		if (key !== session.toolsKey) {
			const fileName = `tools_${session.toolsIndex}.json`;
			session.toolsKey = key;
			session.toolsIndex++;
			session.currentToolsFile = fileName;
			this._enqueueFileWrite(session, toolDefs, fileName);
		}
	}


	private _onCoreDebugEvent(event: vscode.ChatDebugEvent): void {
		if (!(event instanceof vscode.ChatDebugGenericEvent)) {
			return;
		}

		const timestamp = event.created.getTime();
		const eventId = event.id;
		const parentEventId = event.parentEventId;

		const entry: IDebugLogEntry = {
			ts: timestamp,
			dur: 0,
			sid: '',
			type: event.category === 'discovery' ? 'discovery' : 'generic',
			name: event.name,
			spanId: eventId ?? `core-${Date.now()}`,
			parentSpanId: parentEventId,
			status: event.level === vscode.ChatDebugLogLevel.Error ? 'error' : 'ok',
			attrs: {
				...(event.details ? { details: truncate(event.details, MAX_ATTR_VALUE_LENGTH) } : {}),
				...(event.category ? { category: event.category } : {}),
				source: 'core',
			},
		};

		if (this._pendingCoreEvents.length >= MAX_PENDING_CORE_EVENTS) {
			this._pendingCoreEvents.shift();
		}
		this._pendingCoreEvents.push(entry);
		for (const [sessionId, session] of this._activeSessions.entries()) {
			if (!session.parentSessionId && session.hasOwnSpans) {
				this._bufferEntry(sessionId, { ...entry, sid: sessionId });
			}
		}
	}


	private _spanToEntry(span: ICompletedSpanData, sessionId: string): IDebugLogEntry | undefined {
		const opName = asString(span.attributes[GenAiAttr.OPERATION_NAME]);
		const duration = span.endTime - span.startTime;
		const isError = span.status.code === SpanStatusCode.ERROR;

		switch (opName) {
			case GenAiOperationName.EXECUTE_TOOL: {
				const toolName = asString(span.attributes[GenAiAttr.TOOL_NAME]) ?? span.name;
				return {
					ts: span.startTime,
					dur: duration,
					sid: sessionId,
					type: 'tool_call',
					name: toolName,
					spanId: span.spanId,
					parentSpanId: span.parentSpanId,
					status: isError ? 'error' : 'ok',
					attrs: {
						...(span.attributes[GenAiAttr.TOOL_CALL_ARGUMENTS] !== undefined
							? { args: truncate(String(span.attributes[GenAiAttr.TOOL_CALL_ARGUMENTS]), MAX_ATTR_VALUE_LENGTH) }
							: {}),
						...(span.attributes[GenAiAttr.TOOL_CALL_RESULT] !== undefined
							? { result: truncate(String(span.attributes[GenAiAttr.TOOL_CALL_RESULT]), MAX_ATTR_VALUE_LENGTH) }
							: {}),
						...(isError && span.status.message ? { error: span.status.message } : {}),
					},
				};
			}

			case GenAiOperationName.CHAT: {
				const model = asString(span.attributes[GenAiAttr.REQUEST_MODEL])
					?? asString(span.attributes[GenAiAttr.RESPONSE_MODEL])
					?? 'unknown';
				const debugName = asString(span.attributes[DardcorChatAttr.DEBUG_NAME])
					?? asString(span.attributes[GenAiAttr.AGENT_NAME]);
				return {
					ts: span.startTime,
					dur: duration,
					sid: sessionId,
					type: 'llm_request',
					name: `chat:${model}`,
					spanId: span.spanId,
					parentSpanId: span.parentSpanId,
					status: isError ? 'error' : 'ok',
					attrs: {
						model,
						...(debugName ? { debugName } : {}),
						...(span.attributes[GenAiAttr.USAGE_INPUT_TOKENS] !== undefined
							? { inputTokens: asNumber(span.attributes[GenAiAttr.USAGE_INPUT_TOKENS]) }
							: {}),
						...(span.attributes[GenAiAttr.USAGE_OUTPUT_TOKENS] !== undefined
							? { outputTokens: asNumber(span.attributes[GenAiAttr.USAGE_OUTPUT_TOKENS]) }
							: {}),
						...(span.attributes[GenAiAttr.USAGE_CACHE_READ_INPUT_TOKENS] !== undefined
							? { cachedTokens: asNumber(span.attributes[GenAiAttr.USAGE_CACHE_READ_INPUT_TOKENS]) }
							: {}),
						...(span.attributes[DardcorChatAttr.TIME_TO_FIRST_TOKEN] !== undefined
							? { ttft: asNumber(span.attributes[DardcorChatAttr.TIME_TO_FIRST_TOKEN]) }
							: {}),
						...(span.attributes[GenAiAttr.RESPONSE_ID] !== undefined
							? { responseId: asString(span.attributes[GenAiAttr.RESPONSE_ID]) }
							: {}),
						...(span.attributes[DardcorChatAttr.USER_REQUEST] !== undefined
							? { userRequest: String(span.attributes[DardcorChatAttr.USER_REQUEST]) }
							: {}),
						...(span.attributes[GenAiAttr.INPUT_MESSAGES] !== undefined
							? { inputMessages: String(span.attributes[GenAiAttr.INPUT_MESSAGES]) }
							: {}),
						...(span.attributes[GenAiAttr.REQUEST_MAX_TOKENS] !== undefined
							? { maxTokens: asNumber(span.attributes[GenAiAttr.REQUEST_MAX_TOKENS]) }
							: {}),
						...(span.attributes[GenAiAttr.REQUEST_TEMPERATURE] !== undefined
							? { temperature: asNumber(span.attributes[GenAiAttr.REQUEST_TEMPERATURE]) }
							: {}),
						...(span.attributes[GenAiAttr.REQUEST_TOP_P] !== undefined
							? { topP: asNumber(span.attributes[GenAiAttr.REQUEST_TOP_P]) }
							: {}),
						...(span.attributes[DardcorChatAttr.REQUEST_OPTIONS] !== undefined
							? { requestOptions: String(span.attributes[DardcorChatAttr.REQUEST_OPTIONS]) }
							: {}),
						...(span.attributes[DardcorChatAttr.REQUEST_SHAPE] !== undefined
							? { requestShape: String(span.attributes[DardcorChatAttr.REQUEST_SHAPE]) }
							: {}),
						...(span.attributes[DardcorChatAttr.DARDCOR_USAGE_NANO_AIU] !== undefined
							? { dardcorUsageNanoAiu: asNumber(span.attributes[DardcorChatAttr.DARDCOR_USAGE_NANO_AIU]) }
							: {}),
						...(isError && span.status.message ? { error: span.status.message } : {}),
					},
				};
			}

			case GenAiOperationName.INVOKE_AGENT: {
				if (!span.parentSpanId) {
					return undefined;
				}
				const agentName = asString(span.attributes[GenAiAttr.AGENT_NAME]) ?? span.name;
				return {
					ts: span.startTime,
					dur: duration,
					sid: sessionId,
					type: 'subagent',
					name: agentName,
					spanId: span.spanId,
					parentSpanId: span.parentSpanId,
					status: isError ? 'error' : 'ok',
					attrs: {
						agentName,
						...(span.attributes[GenAiAttr.AGENT_DESCRIPTION] !== undefined
							? { description: truncate(String(span.attributes[GenAiAttr.AGENT_DESCRIPTION]), MAX_ATTR_VALUE_LENGTH) }
							: {}),
						...(isError && span.status.message ? { error: span.status.message } : {}),
					},
				};
			}

			case GenAiOperationName.CONTENT_EVENT:
			case 'core_event': {
				const name = asString(span.attributes[DardcorChatAttr.DEBUG_NAME]) ?? span.name;
				return {
					ts: span.startTime,
					dur: duration,
					sid: sessionId,
					type: 'generic',
					name,
					spanId: span.spanId,
					parentSpanId: span.parentSpanId,
					status: isError ? 'error' : 'ok',
					attrs: {
						...(span.attributes['dardcor_chat.event_details'] !== undefined
							? { details: truncate(String(span.attributes['dardcor_chat.event_details']), MAX_ATTR_VALUE_LENGTH) }
							: {}),
						...(span.attributes['dardcor_chat.event_category'] !== undefined
							? { category: String(span.attributes['dardcor_chat.event_category']) }
							: {}),
					},
				};
			}

			case GenAiOperationName.EXECUTE_HOOK: {
				const hookType = asString(span.attributes[DardcorChatAttr.HOOK_TYPE]) ?? span.name;
				return {
					ts: span.startTime,
					dur: duration,
					sid: sessionId,
					type: 'hook',
					name: hookType,
					spanId: span.spanId,
					parentSpanId: span.parentSpanId,
					status: isError ? 'error' : 'ok',
					attrs: {
						...(span.attributes['dardcor_chat.hook_command'] !== undefined
							? { command: truncate(String(span.attributes['dardcor_chat.hook_command']), MAX_ATTR_VALUE_LENGTH) }
							: {}),
						...(span.attributes[DardcorChatAttr.HOOK_INPUT] !== undefined
							? { input: truncate(String(span.attributes[DardcorChatAttr.HOOK_INPUT]), MAX_ATTR_VALUE_LENGTH) }
							: {}),
						...(span.attributes[DardcorChatAttr.HOOK_OUTPUT] !== undefined
							? { output: truncate(String(span.attributes[DardcorChatAttr.HOOK_OUTPUT]), MAX_ATTR_VALUE_LENGTH) }
							: {}),
						...(span.attributes[DardcorChatAttr.HOOK_RESULT_KIND] !== undefined
							? { resultKind: String(span.attributes[DardcorChatAttr.HOOK_RESULT_KIND]) }
							: {}),
						...(isError && span.status.message ? { error: span.status.message } : {}),
					},
				};
			}

			default:
				return undefined;
		}
	}


	private _readTailBytes(filePath: string, byteCount: number): string {
		const fd = fs.openSync(filePath, 'r');
		try {
			const stat = fs.fstatSync(fd);
			const start = Math.max(0, stat.size - byteCount);
			const buf = Buffer.alloc(Math.min(byteCount, stat.size));
			fs.readSync(fd, buf, 0, buf.length, start);
			return buf.toString('utf-8');
		} finally {
			fs.closeSync(fd);
		}
	}

	private _extractSessionId(span: ICompletedSpanData): string | undefined {
		const directSessionId = asString(span.attributes[DardcorChatAttr.CHAT_SESSION_ID])
			?? asString(span.attributes[GenAiAttr.CONVERSATION_ID]);

		if (span.parentSpanId) {
			const childSessionId = this._spanSessionIndex.get(span.parentSpanId);
			if (childSessionId && this._childSessionMap.has(childSessionId)) {
				return childSessionId;
			}
		}

		return directSessionId
			?? (span.parentSpanId ? this._spanSessionIndex.get(span.parentSpanId) : undefined);
	}

	private _bufferEntry(sessionId: string, entry: IDebugLogEntry): void {
		const session = this._activeSessions.get(sessionId);
		if (!session) {
			return;
		}
		let stamped = entry;
		if (session.runIndex > 0 && !stamped.rIdx) {
			stamped = { ...stamped, rIdx: session.runIndex };
		}
		session.buffer.push(JSON.stringify(stamped) + '\n');
		this._onDidEmitEntry.fire({ sessionId, entry: stamped });
	}

	async readEntries(sessionId: string): Promise<IDebugLogEntry[]> {
		const entries: IDebugLogEntry[] = [];
		await this.streamEntries(sessionId, entry => entries.push(entry));
		return entries;
	}

	async readTailEntries(sessionId: string, count: number): Promise<IDebugLogEntry[]> {
		const session = this._activeSessions.get(sessionId);
		const logPath = session?.uri ?? this.getLogPath(sessionId);
		let entries: IDebugLogEntry[] = [];

		if (logPath) {
			try {
				const stat = await fs.promises.stat(logPath.fsPath);
				const readSize = Math.min(stat.size, count * 4096);
				const startOffset = Math.max(0, stat.size - readSize);

				const fd = await fs.promises.open(logPath.fsPath, 'r');
				try {
					const buffer = Buffer.alloc(stat.size - startOffset);
					const { bytesRead } = await fd.read(buffer, 0, buffer.length, startOffset);

					const text = buffer.subarray(0, bytesRead).toString('utf-8');
					const lines = text.split('\n');
					const startIdx = startOffset > 0 ? 1 : 0;
					for (let i = startIdx; i < lines.length; i++) {
						if (!lines[i]) { continue; }
						try {
							entries.push(JSON.parse(lines[i]) as IDebugLogEntry);
						} catch { }
					}
				} finally {
					await fd.close();
				}

				if (entries.length > count) {
					entries = entries.slice(-count);
				}
			} catch {
			}
		}

		if (session) {
			for (const line of session.buffer) {
				try {
					entries.push(JSON.parse(line) as IDebugLogEntry);
				} catch { }
			}
		}

		if (entries.length > count) {
			entries = entries.slice(-count);
		}

		return entries;
	}

	async streamEntries(sessionId: string, onEntry: (entry: IDebugLogEntry) => void): Promise<void> {
		const session = this._activeSessions.get(sessionId);
		const logPath = session?.uri ?? this.getLogPath(sessionId);

		if (logPath) {
			try {
				await new Promise<void>((resolve, reject) => {
					const stream = fs.createReadStream(logPath.fsPath, { encoding: 'utf-8' });
					let partial = '';
					stream.on('data', (chunk) => {
						const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
						partial += text;
						const lines = partial.split('\n');
						partial = lines.pop() ?? '';
						for (const line of lines) {
							if (!line) { continue; }
							try {
								onEntry(JSON.parse(line) as IDebugLogEntry);
							} catch { }
						}
					});
					stream.on('end', () => {
						if (partial) {
							try {
								onEntry(JSON.parse(partial) as IDebugLogEntry);
							} catch { }
						}
						resolve();
					});
					stream.on('error', reject);
				});
			} catch {
			}
		}

		if (session) {
			for (const line of session.buffer) {
				try {
					onEntry(JSON.parse(line) as IDebugLogEntry);
				} catch { }
			}
		}
	}

	private async _writeToFile(session: IActiveLogSession, content: string): Promise<void> {
		try {
			if (!session.dirEnsured) {
				await createDirectoryIfNotExists(this._fileSystemService, session.sessionDir);
				session.dirEnsured = true;
			}
			await fs.promises.appendFile(session.uri.fsPath, content, 'utf-8');
			session.bytesWritten += Buffer.byteLength(content, 'utf-8');
			if (session.bytesWritten > this._maxSessionLogBytes) {
				await this._truncateLogFile(session);
			}
		} catch (err) {
			this._logService.error('[ChatDebugFileLogger] Failed to write debug log entries', err);
		}
	}

	private async _truncateLogFile(session: IActiveLogSession): Promise<void> {
		try {
			const filePath = session.uri.fsPath;
			const stat = await fs.promises.stat(filePath);
			if (stat.size <= this._maxSessionLogBytes) {
				return;
			}

			const retainBytes = Math.floor(this._maxSessionLogBytes * TRUNCATION_RETAIN_RATIO);
			const skipBytes = stat.size - retainBytes;
			const fd = await fs.promises.open(filePath, 'r');
			try {
				const probe = Buffer.alloc(4096);
				const { bytesRead } = await fd.read(probe, 0, probe.length, skipBytes);
				const newlineIdx = probe.indexOf(0x0A, 0);
				const cutOffset = skipBytes + (newlineIdx >= 0 && newlineIdx < bytesRead ? newlineIdx + 1 : 0);

				const tailSize = stat.size - cutOffset;
				if (tailSize <= 0) {
					await fd.close();
					return;
				}
				await fd.close();

				const tmpPath = filePath + '.tmp';
				await new Promise<void>((resolve, reject) => {
					const readStream = fs.createReadStream(filePath, { start: cutOffset });
					const writeStream = fs.createWriteStream(tmpPath);
					const onError = (err: Error) => {
						readStream.destroy();
						writeStream.destroy();
						reject(err);
					};
					readStream.on('error', onError);
					writeStream.on('error', onError);
					writeStream.on('finish', resolve);
					readStream.pipe(writeStream);
				});
				await fs.promises.rename(tmpPath, filePath);
				session.bytesWritten = tailSize;
				this._telemetryService.sendMSFTTelemetryEvent('chatDebugFileLogger.truncated', undefined, { previousSize: stat.size, retainedSize: tailSize });
			} catch (innerErr) {
				await fd.close().catch(() => { });
				await fs.promises.unlink(filePath + '.tmp').catch(() => { });
				throw innerErr;
			}
		} catch (err) {
			this._logService.warn(`[ChatDebugFileLogger] Failed to truncate log file: ${err}`);
			this._telemetryService.sendMSFTTelemetryEvent('chatDebugFileLogger.truncateFailed');
		}
	}

	private _autoFlushAll(): void {
		for (const sessionId of this._activeSessions.keys()) {
			this.flush(sessionId).catch(() => { });
		}
	}

	private _restartFlushTimer(): void {
		if (this._autoFlushTimer) {
			clearInterval(this._autoFlushTimer);
			this._autoFlushTimer = undefined;
		}
		if (this._activeSessions.size > 0) {
			this._autoFlushTimer = setInterval(() => this._autoFlushAll(), this._autoFlushIntervalMs);
		}
	}

	async listSessionIds(): Promise<string[]> {
		const roots = this._getCandidateDebugLogsRoots();
		const byName = new Map<string, number>();
		await Promise.all(roots.map(async dir => {
			try {
				const entries = await this._fileSystemService.readDirectory(dir);
				const dirs = entries.filter(([, type]) => type === 2 );
				await Promise.all(dirs.map(async ([name]) => {
					let mtime = 0;
					try {
						const stat = await this._fileSystemService.stat(URI.joinPath(dir, name));
						mtime = stat.mtime;
					} catch {
					}
					const existing = byName.get(name);
					if (existing === undefined || mtime > existing) {
						byName.set(name, mtime);
					}
				}));
			} catch {
			}
		}));
		return [...byName.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([name]) => name);
	}

	private async _cleanupOldLogs(): Promise<void> {

		const roots = this._getCandidateDebugLogsRoots();
		if (roots.length === 0) {
			return;
		}

		const configuredMax = this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.ChatDebugFileLoggingMaxRetainedSessionLogs, this._experimentationService);
		const maxRetainedSessionLogs = Number.isFinite(configuredMax) && configuredMax >= 1 ? Math.trunc(configuredMax) : DEFAULT_MAX_RETAINED_LOGS;

		const startTime = Date.now();
		let totalEntryCount = 0;
		let totalDeletedCount = 0;
		for (const dir of roots) {
			const result = await this._cleanupOldLogsInRoot(dir, maxRetainedSessionLogs);
			totalEntryCount += result.entryCount;
			totalDeletedCount += result.deletedCount;
		}

		this._telemetryService.sendMSFTTelemetryEvent('chatDebugFileLogger.cleanupOldLogs', undefined, { durationMs: Date.now() - startTime, entryCount: totalEntryCount, deletedCount: totalDeletedCount });
	}

	private async _cleanupOldLogsInRoot(dir: URI, maxRetainedSessionLogs: number): Promise<{ entryCount: number; deletedCount: number }> {
		try {
			const entries = await this._fileSystemService.readDirectory(dir);
			const sessionEntries = entries.filter(([name, type]) =>
				(type === 2 ) ||
				(name.endsWith('.jsonl') && type === 1 )
			);

			if (sessionEntries.length <= maxRetainedSessionLogs) {
				return { entryCount: sessionEntries.length, deletedCount: 0 };
			}

			const entryStats = await Promise.all(
				sessionEntries.map(async ([name, type]) => {
					const entryUri = URI.joinPath(dir, name);
					const sessionIdFromEntry = name.replace('.jsonl', '');
					try {
						const stat = await this._fileSystemService.stat(entryUri);
						return { name, uri: entryUri, mtime: stat.mtime, sessionId: sessionIdFromEntry, isDir: type === 2 };
					} catch {
						return { name, uri: entryUri, mtime: 0, sessionId: sessionIdFromEntry, isDir: type === 2 };
					}
				}),
			);

			entryStats.sort((a, b) => a.mtime - b.mtime);

			const toDelete = entryStats.length - maxRetainedSessionLogs;
			let deleted = 0;
			for (const entry of entryStats) {
				if (deleted >= toDelete) {
					break;
				}
				if (this._activeSessions.has(entry.sessionId)) {
					continue;
				}
				try {
					await this._fileSystemService.delete(entry.uri, { recursive: true });
					deleted++;
				} catch {
					this._logService.warn(`[ChatDebugFileLogger] Failed to delete old debug log: ${entry.name}`);
				}
			}
			return { entryCount: sessionEntries.length, deletedCount: deleted };
		} catch {
			return { entryCount: 0, deletedCount: 0 };
		}
	}
}

export class ChatDebugFileLoggerContribution implements IExtensionContribution {
	public readonly id = 'chatDebugFileLoggerContribution';

	constructor(
		@IChatDebugFileLoggerService _service: IChatDebugFileLoggerService,
	) {
	}
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
	return typeof v === 'number' ? v : undefined;
}

function truncate(s: string, maxLen: number): string {
	return s.length > maxLen ? s.slice(0, maxLen) + '[truncated]' : s;
}
