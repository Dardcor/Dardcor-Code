/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import {
	IHistoricalTurn,
	ISessionTranscriptService,
	ToolRequest,
	TranscriptEntry,
} from '../../../platform/chat/common/sessionTranscriptService';
import { IEnvService } from '../../../platform/env/common/envService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IFileSystemService, createDirectoryIfNotExists } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { extUriBiasedIgnorePathCase } from '../../../util/dardcor/base/common/resources';
import { URI } from '../../../util/dardcor/base/common/uri';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';

const TRANSCRIPT_VERSION = 1;
const TRANSCRIPT_PRODUCER = 'dardcor-agent';
const DEFAULT_MAX_RETAINED = 20;

function stripInternalToolCallId(id: string): string {
	return id.split('__vscode-')[0];
}

interface IActiveSession {
	readonly uri: URI;
	lastEntryId: string | null;
	readonly buffer: string[];
	flushPromise: Promise<void>;
	lineCount: number;
}

export class SessionTranscriptService implements ISessionTranscriptService {
	declare readonly _serviceBrand: undefined;

	private readonly _activeSessions = new Map<string, IActiveSession>();
	private _transcriptsDirUri: URI | undefined;

	constructor(
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IEnvService private readonly _envService: IEnvService,
		@ILogService private readonly _logService: ILogService,
	) { }

	private _getTranscriptsDir(): URI | undefined {
		if (this._transcriptsDirUri) {
			return this._transcriptsDirUri;
		}
		const storageUri = this._extensionContext.storageUri;
		if (!storageUri) {
			return undefined;
		}
		this._transcriptsDirUri = URI.joinPath(storageUri, 'transcripts');
		return this._transcriptsDirUri;
	}

	async startSession(sessionId: string, context?: { cwd?: string }, history?: readonly IHistoricalTurn[]): Promise<void> {
		if (this._activeSessions.has(sessionId)) {
			return;
		}

		const dir = this._getTranscriptsDir();
		if (!dir) {
			this._logService.warn('[SessionTranscript] No workspace storage available, transcript will not be written');
			return;
		}

		try {
			await createDirectoryIfNotExists(this._fileSystemService, dir);
		} catch (err) {
			this._logService.error('[SessionTranscript] Failed to create transcripts directory', err);
			return;
		}

		const fileUri = URI.joinPath(dir, `${sessionId}.jsonl`);
		const session: IActiveSession = {
			uri: fileUri,
			lastEntryId: null,
			buffer: [],
			flushPromise: Promise.resolve(),
			lineCount: 0,
		};
		this._activeSessions.set(sessionId, session);

		let fileAlreadyExists = false;
		try {
			await this._fileSystemService.stat(fileUri);
			fileAlreadyExists = true;
		} catch {
		}

		if (fileAlreadyExists) {
			try {
				const content = await fs.promises.readFile(fileUri.fsPath, 'utf-8');
				session.lineCount = content.split('\n').filter(l => l.length > 0).length;
			} catch {
			}
			return;
		}

		const startTime = (history && history.length > 0)
			? new Date(history[0].timestamp).toISOString()
			: new Date().toISOString();

		this._bufferEntry(sessionId, {
			type: 'session.start',
			data: {
				sessionId,
				version: TRANSCRIPT_VERSION,
				producer: TRANSCRIPT_PRODUCER,
				dardcorVersion: this._envService.getVersion(),
				vscodeVersion: this._envService.vscodeVersion,
				startTime,
				context,
			},
		});

		if (history) {
			this._replayHistory(sessionId, history);
		}

		this.cleanupOldTranscripts().catch(() => { });
	}

	logUserMessage(sessionId: string, content: string, attachments?: readonly unknown[]): void {
		this._bufferEntry(sessionId, {
			type: 'user.message',
			data: {
				content,
				attachments: attachments ?? [],
			},
		});
	}

	logAssistantTurnStart(sessionId: string, turnId: string): void {
		this._bufferEntry(sessionId, {
			type: 'assistant.turn_start',
			data: { turnId },
		});
	}

	logAssistantMessage(sessionId: string, content: string, toolRequests: readonly ToolRequest[], reasoningText?: string): void {
		this._bufferEntry(sessionId, {
			type: 'assistant.message',
			data: {
				messageId: generateUuid(),
				content,
				toolRequests: toolRequests.map(tr => ({ ...tr, toolCallId: stripInternalToolCallId(tr.toolCallId) })),
				...(reasoningText !== undefined ? { reasoningText } : {}),
			},
		});
	}

	logToolExecutionStart(sessionId: string, toolCallId: string, toolName: string, args: unknown): void {
		this._bufferEntry(sessionId, {
			type: 'tool.execution_start',
			data: {
				toolCallId: stripInternalToolCallId(toolCallId),
				toolName,
				arguments: args,
			},
		});
	}

	logToolExecutionComplete(sessionId: string, toolCallId: string, success: boolean, resultContent?: string): void {
		this._bufferEntry(sessionId, {
			type: 'tool.execution_complete',
			data: {
				toolCallId: stripInternalToolCallId(toolCallId),
				success,
				...(resultContent !== undefined ? { result: { content: resultContent } } : {}),
			},
		});
	}

	logAssistantTurnEnd(sessionId: string, turnId: string): void {
		this._bufferEntry(sessionId, {
			type: 'assistant.turn_end',
			data: { turnId },
		});
	}

	async flush(sessionId: string): Promise<void> {
		const session = this._activeSessions.get(sessionId);
		if (!session || session.buffer.length === 0) {
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

	async endSession(sessionId: string): Promise<void> {
		await this.flush(sessionId);
		this._activeSessions.delete(sessionId);
	}

	getTranscriptPath(sessionId: string): URI | undefined {
		return this._activeSessions.get(sessionId)?.uri;
	}

	getLineCount(sessionId: string): number | undefined {
		return this._activeSessions.get(sessionId)?.lineCount;
	}

	isTranscriptUri(uri: URI): boolean {
		const dir = this._getTranscriptsDir();
		if (!dir) {
			return false;
		}
		return extUriBiasedIgnorePathCase.isEqualOrParent(uri, dir);
	}

	async cleanupOldTranscripts(maxRetained: number = DEFAULT_MAX_RETAINED): Promise<void> {
		const dir = this._getTranscriptsDir();
		if (!dir) {
			return;
		}

		try {
			const entries = await this._fileSystemService.readDirectory(dir);
			const jsonlFiles = entries
				.filter(([name, type]) => name.endsWith('.jsonl') && type === 1 );

			if (jsonlFiles.length <= maxRetained) {
				return;
			}

			const fileStats = await Promise.all(
				jsonlFiles.map(async ([name]) => {
					const fileUri = URI.joinPath(dir, name);
					const sessionIdFromFile = name.replace('.jsonl', '');
					try {
						const stat = await this._fileSystemService.stat(fileUri);
						return { name, uri: fileUri, mtime: stat.mtime, sessionId: sessionIdFromFile };
					} catch {
						return { name, uri: fileUri, mtime: 0, sessionId: sessionIdFromFile };
					}
				})
			);

			fileStats.sort((a, b) => a.mtime - b.mtime);

			const toDelete = fileStats.length - maxRetained;
			let deleted = 0;
			for (const file of fileStats) {
				if (deleted >= toDelete) {
					break;
				}
				if (this._activeSessions.has(file.sessionId)) {
					continue;
				}
				try {
					await this._fileSystemService.delete(file.uri);
					deleted++;
				} catch (err) {
					this._logService.warn(`[SessionTranscript] Failed to delete old transcript: ${file.name}`);
				}
			}
		} catch {
		}
	}

	private _replayHistory(sessionId: string, history: readonly IHistoricalTurn[]): void {
		for (const [turnIndex, turn] of history.entries()) {
			const turnTimestamp = new Date(turn.timestamp).toISOString();

			this._bufferEntry(sessionId, {
				type: 'user.message',
				data: {
					content: turn.userMessage,
					attachments: [],
				},
			}, turnTimestamp);

			for (const [roundIndex, round] of turn.rounds.entries()) {
				const roundTimestamp = round.timestamp
					? new Date(round.timestamp).toISOString()
					: turnTimestamp;
				const turnId = `${turnIndex}.${roundIndex}`;

				this._bufferEntry(sessionId, {
					type: 'assistant.turn_start',
					data: { turnId },
				}, roundTimestamp);

				const toolRequests: ToolRequest[] = round.toolCalls.map(tc => ({
					toolCallId: tc.id,
					name: tc.name,
					arguments: tc.arguments,
					type: 'function' as const,
				}));

				this._bufferEntry(sessionId, {
					type: 'assistant.message',
					data: {
						messageId: generateUuid(),
						content: round.response,
						toolRequests,
						...(round.reasoningText !== undefined ? { reasoningText: round.reasoningText } : {}),
					},
				}, roundTimestamp);

				this._bufferEntry(sessionId, {
					type: 'assistant.turn_end',
					data: { turnId },
				}, roundTimestamp);
			}
		}
	}

	private _bufferEntry(sessionId: string, entry: Omit<TranscriptEntry, 'id' | 'timestamp' | 'parentId'>, timestampOverride?: string): void {
		const session = this._activeSessions.get(sessionId);
		if (!session) {
			return;
		}

		const id = generateUuid();
		const fullEntry: TranscriptEntry = {
			...entry,
			id,
			timestamp: timestampOverride ?? new Date().toISOString(),
			parentId: session.lastEntryId,
		} as TranscriptEntry;

		session.lastEntryId = id;
		session.lineCount++;
		session.buffer.push(JSON.stringify(fullEntry) + '\n');
	}

	private async _writeToFile(session: IActiveSession, content: string): Promise<void> {
		try {
			await fs.promises.appendFile(session.uri.fsPath, content, 'utf-8');
		} catch (err) {
			this._logService.error('[SessionTranscript] Failed to write transcript entries', err);
		}
	}
}
