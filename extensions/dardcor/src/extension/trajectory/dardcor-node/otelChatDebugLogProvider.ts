/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as vscode from 'vscode';
import { IChatDebugFileLoggerService, IDebugLogEntry, sessionResourceToId } from '../../../platform/chat/common/chatDebugFileLoggerService';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { Disposable, type IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IExtensionContribution } from '../../common/contributions';
import {
	debugLogEntryToDebugEvent,
	entryDedupKey,
	extractSessionId,
	resolveDebugLogEntry,
} from './otelSpanToChatDebugEvent';
import {
	parseResourceSpans,
	wrapInResourceSpans,
	type ChatDebugLogExport,
} from './otlpFormatConversion';

export class OTelChatDebugLogProviderContribution extends Disposable implements IExtensionContribution {
	public readonly id = 'otelChatDebugLogProvider';

	private static readonly MAX_ENTRY_CACHE = 1000;

	private _activeSessionId: string | undefined;

	private _activeProgress: vscode.Progress<vscode.ChatDebugEvent> | undefined;

	private readonly _sentDedupKeys = new Set<string>();

	private _activeEntryCache = new Map<string, IDebugLogEntry>();

	private readonly _importedSessions = new Map<string, IDebugLogEntry[]>();

	private readonly _activeChildSessions = new Map<string, string>();

	private _skipCoreEvents = true;

	private _liveSubscription: IDisposable | undefined;

	constructor(
		@IChatDebugFileLoggerService private readonly _fileLogger: IChatDebugFileLoggerService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExperimentationService private readonly _experimentationService: IExperimentationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();

		if (!this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.ChatDebugFileLogging, this._experimentationService)) {
			return;
		}

		if (typeof vscode.chat?.registerChatDebugLogProvider !== 'function') {
			this._logService.info('[OTelDebug] Chat debug API not available, skipping registration');
			return;
		}

		try {
			this._register(vscode.chat.registerChatDebugLogProvider({
				provideChatDebugLog: (sessionResource, progress, token) =>
					this._provideChatDebugLog(sessionResource, progress, token),
				resolveChatDebugLogEvent: (eventId, token) =>
					this._resolveChatDebugLogEvent(eventId, token),
				provideChatDebugLogExport: (sessionResource, options, token) =>
					this._provideChatDebugLogExport(sessionResource, options, token),
				resolveChatDebugLogImport: (data, token) =>
					this._resolveChatDebugLogImport(data, token),
				provideAvailableDebugSessionResources: (token) =>
					this._getAvailableDebugSessionResources(token),
			}));
		} catch (e) {
			this._logService.warn(`[OTelDebug] Failed to register debug log provider: ${e}`);
		}
	}

	private _scopeEventIds(evt: vscode.ChatDebugEvent, runIndex: number): void {
		if (runIndex === 0) { return; }
		const suffix = `:r${runIndex}`;
		const evtWithId = evt as { id?: string; parentEventId?: string };
		if (evtWithId.id) { evtWithId.id += suffix; }
		if (evtWithId.parentEventId) { evtWithId.parentEventId += suffix; }
	}

	private _streamEvent(evt: vscode.ChatDebugEvent, dedupKey?: string): void {
		if (!this._activeProgress) { return; }
		if (dedupKey) {
			if (this._sentDedupKeys.has(dedupKey)) { return; }
			this._sentDedupKeys.add(dedupKey);
		}
		this._activeProgress.report(evt);
	}

	private _prefixChildEventId(evt: vscode.ChatDebugEvent, entry: IDebugLogEntry): void {
		if (entry.type === 'user_message' || entry.type === 'subagent') {
			const evtWithId = evt as { id?: string };
			if (evtWithId.id) {
				evtWithId.id = `child-${entry.type}-${evtWithId.id}`;
			}
		}
	}

	private _cacheEntry(evtId: string, entry: IDebugLogEntry): void {
		this._activeEntryCache.delete(evtId);
		this._activeEntryCache.set(evtId, entry);
		if (this._activeEntryCache.size > OTelChatDebugLogProviderContribution.MAX_ENTRY_CACHE) {
			const excess = this._activeEntryCache.size - OTelChatDebugLogProviderContribution.MAX_ENTRY_CACHE;
			const iter = this._activeEntryCache.keys();
			for (let i = 0; i < excess; i++) {
				this._activeEntryCache.delete(iter.next().value!);
			}
		}
	}

	private async _provideChatDebugLog(
		sessionResource: vscode.Uri,
		progress: vscode.Progress<vscode.ChatDebugEvent>,
		token: vscode.CancellationToken,
	): Promise<vscode.ChatDebugEvent[]> {
		const sessionId = sessionResourceToId(sessionResource);

		this._activeProgress = progress;
		this._activeSessionId = sessionId;
		this._sentDedupKeys.clear();
		this._activeEntryCache.clear();
		this._activeChildSessions.clear();
		this._skipCoreEvents = this._fileLogger.getActiveSessionIds().includes(sessionId);

		token.onCancellationRequested(() => {
			if (this._activeSessionId === sessionId) {
				this._activeProgress = undefined;
				this._activeSessionId = undefined;
				this._activeEntryCache.clear();
				this._sentDedupKeys.clear();
				this._activeChildSessions.clear();
				this._liveSubscription?.dispose();
				this._liveSubscription = undefined;
			}
		});

		this._liveSubscription?.dispose();
		this._liveSubscription = this._fileLogger.onDidEmitEntry(({ sessionId: sid, entry }) => {
			const childParentId = this._activeChildSessions.get(sid);
			if (sid !== this._activeSessionId && !childParentId) { return; }

			if (childParentId) {
				const evt = debugLogEntryToDebugEvent(entry, this._skipCoreEvents);
				if (evt) {
					this._scopeEventIds(evt, entry.rIdx ?? 0);
					this._prefixChildEventId(evt, entry);
					if ('parentEventId' in evt) {
						(evt as { parentEventId?: string }).parentEventId = childParentId;
					}
					const evtId = 'id' in evt ? (evt as { id?: string }).id : undefined;
					if (evtId) {
						this._cacheEntry(evtId, entry);
					}
					this._streamEvent(evt, entryDedupKey(entry));
				}
				return;
			}

			const evt = debugLogEntryToDebugEvent(entry, this._skipCoreEvents);
			if (evt) {
				this._scopeEventIds(evt, entry.rIdx ?? 0);
				const evtId = 'id' in evt ? (evt as { id?: string }).id : undefined;
				if (evtId) {
					this._cacheEntry(evtId, entry);
				}
				this._streamEvent(evt, entryDedupKey(entry));
			}

			if (entry.type === 'child_session_ref' && evt) {
				const childSessionId = entry.attrs.childSessionId as string | undefined;
				if (childSessionId) {
					const parentRunIndex = entry.rIdx ?? 0;
					const scopedParentId = parentRunIndex > 0 ? `${entry.spanId}:r${parentRunIndex}` : entry.spanId;
					this._activeChildSessions.set(childSessionId, scopedParentId);
					this._streamChildSessionEntries(childSessionId, scopedParentId, entry).catch(() => {
					});
				}
			}
		});

		const startTime = Date.now();
		const importedEntries = this._importedSessions.get(sessionId);

		if (importedEntries) {
			return await this._processEntries(importedEntries, startTime);
		}

		const INITIAL_TAIL_COUNT = 500;
		try {
			const tailEntries = await this._fileLogger.readTailEntries(sessionId, INITIAL_TAIL_COUNT);
			const events = await this._processEntries(tailEntries, startTime);

			this._streamOlderEntries(sessionId, token);

			return events;
		} catch (err) {
			this._logService.error(`[OTelDebug] Error in _provideChatDebugLog: ${err}`);
			return [];
		}
	}

	private async _processEntries(entries: readonly IDebugLogEntry[], startTime: number): Promise<vscode.ChatDebugEvent[]> {
		const events: vscode.ChatDebugEvent[] = [];

		for (const entry of entries) {
			const dedupKey = entryDedupKey(entry);
			if (this._sentDedupKeys.has(dedupKey)) { continue; }

			const evt = debugLogEntryToDebugEvent(entry, this._skipCoreEvents);
			if (evt) {
				this._scopeEventIds(evt, entry.rIdx ?? 0);
				const evtId = 'id' in evt ? (evt as { id?: string }).id : undefined;
				if (evtId) {
					this._cacheEntry(evtId, entry);
				}
				events.push(evt);
			}
			this._sentDedupKeys.add(dedupKey);

			if (entry.type === 'child_session_ref' && evt) {
				const childSessionId = entry.attrs.childSessionId as string | undefined;
				if (childSessionId) {
					const parentRunIndex = entry.rIdx ?? 0;
					const scopedParentId = parentRunIndex > 0 ? `${entry.spanId}:r${parentRunIndex}` : entry.spanId;
					this._activeChildSessions.set(childSessionId, scopedParentId);
					try {
						const childEntries = await this._readChildEntries(entry);
						for (const childEntry of childEntries) {
							const childEvt = debugLogEntryToDebugEvent(childEntry, this._skipCoreEvents);
							if (childEvt) {
								this._scopeEventIds(childEvt, childEntry.rIdx ?? 0);
								this._prefixChildEventId(childEvt, childEntry);
								if ('parentEventId' in childEvt) {
									(childEvt as { parentEventId?: string }).parentEventId = scopedParentId;
								}
								const childEvtId = 'id' in childEvt ? (childEvt as { id?: string }).id : undefined;
								if (childEvtId) {
									this._cacheEntry(childEvtId, childEntry);
								}
								events.push(childEvt);
							}
							this._sentDedupKeys.add(entryDedupKey(childEntry));
						}
					} catch (err) {
					}
				}
			}
		}

		events.sort((a, b) => {
			const aTime = 'created' in a ? (a as { created: Date }).created.getTime() : 0;
			const bTime = 'created' in b ? (b as { created: Date }).created.getTime() : 0;
			return aTime - bTime;
		});

		this._telemetryService.sendMSFTTelemetryEvent('otelDebug.convertEntriesToEvents', undefined, {
			durationMs: Date.now() - startTime,
			entryCount: entries.length,
			eventCount: events.length,
		});

		return events;
	}

	private _streamOlderEntries(sessionId: string, token: vscode.CancellationToken): void {
		const childRefs: { childSessionId: string; scopedParentId: string }[] = [];

		this._fileLogger.streamEntries(sessionId, entry => {
			if (token.isCancellationRequested) { return; }

			const dedupKey = entryDedupKey(entry);
			if (this._sentDedupKeys.has(dedupKey)) { return; }

			const evt = debugLogEntryToDebugEvent(entry, this._skipCoreEvents);
			if (evt) {
				this._scopeEventIds(evt, entry.rIdx ?? 0);
				const evtId = 'id' in evt ? (evt as { id?: string }).id : undefined;
				if (evtId) {
					this._cacheEntry(evtId, entry);
				}
				this._streamEvent(evt, dedupKey);
			}

			if (entry.type === 'child_session_ref' && evt) {
				const childSessionId = entry.attrs.childSessionId as string | undefined;
				if (childSessionId) {
					const parentRunIndex = entry.rIdx ?? 0;
					const scopedParentId = parentRunIndex > 0 ? `${entry.spanId}:r${parentRunIndex}` : entry.spanId;
					childRefs.push({ childSessionId, scopedParentId });
					this._activeChildSessions.set(childSessionId, scopedParentId);
				}
			}
		}).then(async () => {
			for (const { childSessionId, scopedParentId } of childRefs) {
				if (token.isCancellationRequested) { break; }
				await this._streamChildSessionEntries(childSessionId, scopedParentId);
			}
		}).catch(() => { });
	}

	private async _streamChildSessionEntries(childSessionId: string, scopedParentId: string, childSessionRefEntry?: IDebugLogEntry): Promise<void> {
		try {
			const childEntries = childSessionRefEntry
				? await this._readChildEntries(childSessionRefEntry)
				: await this._fileLogger.readEntries(childSessionId);
			for (const childEntry of childEntries) {
				const childEvt = debugLogEntryToDebugEvent(childEntry, this._skipCoreEvents);
				if (childEvt) {
					this._scopeEventIds(childEvt, childEntry.rIdx ?? 0);
					this._prefixChildEventId(childEvt, childEntry);
					if ('parentEventId' in childEvt) {
						(childEvt as { parentEventId?: string }).parentEventId = scopedParentId;
					}
					const childEvtId = 'id' in childEvt ? (childEvt as { id?: string }).id : undefined;
					if (childEvtId) {
						this._cacheEntry(childEvtId, childEntry);
					}
					this._streamEvent(childEvt, entryDedupKey(childEntry));
				}
			}
		} catch {
		}
	}

	private async _readChildEntries(childSessionRefEntry: IDebugLogEntry): Promise<IDebugLogEntry[]> {
		const childSessionId = childSessionRefEntry.attrs.childSessionId as string | undefined;

		if (childSessionId) {
			const entries = await this._fileLogger.readEntries(childSessionId);
			if (entries.length > 0) {
				return entries;
			}
		}

		const childLogFile = childSessionRefEntry.attrs.childLogFile as string | undefined;
		const parentSessionId = childSessionRefEntry.sid;
		if (childLogFile) {
			const parentDir = this._fileLogger.getSessionDir(parentSessionId);
			if (parentDir) {
				const childFilePath = URI.joinPath(parentDir, childLogFile).fsPath;
				try {
					const entries: IDebugLogEntry[] = [];
					const stream = fs.createReadStream(childFilePath, { encoding: 'utf-8' });
					let remainder = '';
					await new Promise<void>((resolve, reject) => {
						stream.on('data', (chunk) => {
							remainder += String(chunk);
							const lines = remainder.split('\n');
							remainder = lines.pop()!;
							for (const line of lines) {
								if (!line.trim()) { continue; }
								try { entries.push(JSON.parse(line) as IDebugLogEntry); } catch { }
							}
						});
						stream.on('end', () => {
							if (remainder.trim()) {
								try { entries.push(JSON.parse(remainder) as IDebugLogEntry); } catch { }
							}
							resolve();
						});
						stream.on('error', reject);
					});
					return entries;
				} catch {
				}
			}
		}

		return [];
	}

	private _resolveChatDebugLogEvent(
		eventId: string,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.ChatDebugResolvedEventContent> {
		const entry = this._activeEntryCache.get(eventId);
		if (entry) {
			this._activeEntryCache.delete(eventId);
			this._activeEntryCache.set(eventId, entry);
			return this._resolveEntry(entry);
		}

		if (this._activeSessionId) {
			const sessionId = this._activeSessionId;
			return this._findEntryOnDisk(sessionId, eventId).then(found => {
				if (found) {
					this._cacheEntry(eventId, found);
					return this._resolveEntry(found);
				}
				return undefined;
			});
		}
		return undefined;
	}

	private _resolveEntry(entry: IDebugLogEntry): vscode.ProviderResult<vscode.ChatDebugResolvedEventContent> {
		const sessionDir = this._fileLogger.getSessionDir(entry.sid);
		const readCompanionFile = sessionDir
			? async (fileName: string): Promise<string | undefined> => {
				if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
					return undefined;
				}
				try {
					const fileUri = URI.joinPath(sessionDir, fileName);
					const raw = await fs.promises.readFile(fileUri.fsPath, 'utf-8');
					try {
						const parsed = JSON.parse(raw);
						return typeof parsed.content === 'string' ? parsed.content : raw;
					} catch {
						return raw;
					}
				} catch {
					return undefined;
				}
			}
			: undefined;
		return resolveDebugLogEntry(entry, readCompanionFile);
	}

	private async _findEntryOnDisk(sessionId: string, eventId: string): Promise<IDebugLogEntry | undefined> {
		const runMatch = /:r(\d+)$/.exec(eventId);
		const rawSpanId = runMatch ? eventId.slice(0, runMatch.index) : eventId;
		const targetRunIndex = runMatch ? parseInt(runMatch[1], 10) : 0;

		let found: IDebugLogEntry | undefined;
		const childSessionIds: string[] = [];

		await this._fileLogger.streamEntries(sessionId, entry => {
			if (found) { return; }

			if (entry.spanId === rawSpanId && (entry.rIdx ?? 0) === targetRunIndex) {
				found = entry;
			}

			if (entry.type === 'child_session_ref') {
				const childSessionId = entry.attrs.childSessionId as string | undefined;
				if (childSessionId) {
					childSessionIds.push(childSessionId);
				}
			}
		});

		if (found) {
			return found;
		}

		for (const childSessionId of childSessionIds) {
			try {
				const childEntries = await this._fileLogger.readEntries(childSessionId);
				for (const childEntry of childEntries) {
					if (childEntry.spanId === rawSpanId && (childEntry.rIdx ?? 0) === targetRunIndex) {
						return childEntry;
					}
				}
			} catch {
			}
		}

		return undefined;
	}


	private async _provideChatDebugLogExport(
		sessionResource: vscode.Uri,
		options: vscode.ChatDebugLogExportOptions,
		_token: vscode.CancellationToken,
	): Promise<Uint8Array | undefined> {
		const sessionId = sessionResourceToId(sessionResource);

		const entries = await this._fileLogger.readEntries(sessionId);

		const existingSpanIds = new Set(entries.map(e => e.spanId));
		let coreIdx = 0;
		const coreEntries = options.coreEvents
			.filter(e => e instanceof vscode.ChatDebugGenericEvent)
			.filter(e => {
				const id = (e as vscode.ChatDebugGenericEvent).id;
				return !id || !existingSpanIds.has(id);
			})
			.map((e): IDebugLogEntry => {
				const ge = e as vscode.ChatDebugGenericEvent;
				return {
					ts: ge.created.getTime(),
					dur: 0,
					sid: sessionId,
					type: ge.category === 'discovery' ? 'discovery' : 'generic',
					name: ge.name,
					spanId: ge.id ?? `core-${Date.now()}-${coreIdx++}`,
					parentSpanId: ge.parentEventId,
					status: ge.level === vscode.ChatDebugLogLevel.Error ? 'error' : 'ok',
					attrs: {
						...(ge.details ? { details: ge.details } : {}),
						...(ge.category ? { category: ge.category } : {}),
						source: 'core',
					},
				};
			});

		const allEntries = [...entries, ...coreEntries];
		if (allEntries.length === 0) {
			this._logService.warn(`[OTelDebug] No entries found for session ${sessionId}`);
			return undefined;
		}

		const spans = allEntries.map(entry => entryToExportSpan(entry));

		const otlpExport = wrapInResourceSpans(spans, {
			'service.name': 'dardcor-chat',
			'session.id': sessionId,
		});

		const exportData: ChatDebugLogExport = {
			...otlpExport,
			dardcorChat: {
				exportedAt: new Date().toISOString(),
				exporterVersion: '',
				sessionId,
				sessionTitle: options.sessionTitle ?? deriveSessionTitleFromEntries(allEntries),
			},
		};

		const json = JSON.stringify(exportData, null, 2);
		return new TextEncoder().encode(json);
	}

	private _resolveChatDebugLogImport(
		data: Uint8Array,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.ChatDebugLogImportResult> {
		try {
			const jsonString = new TextDecoder().decode(data);

			const spans = parseResourceSpans(jsonString);
			if (spans.length === 0) {
				this._logService.warn('[OTelDebug] No spans found in imported file');
				return undefined;
			}

			let sourceSessionId: string | undefined;
			let sessionTitle: string | undefined;
			try {
				const parsed = JSON.parse(jsonString);
				sourceSessionId = parsed.dardcorChat?.sessionId;
				sessionTitle = parsed.dardcorChat?.sessionTitle;
			} catch { }
			sourceSessionId ??= extractSessionId(spans[0]) ?? `imported-${Date.now()}`;
			sessionTitle ??= deriveSessionTitleFromSpans(spans);

			const importedSessionId = `import:${sourceSessionId}:${Date.now()}`;
			const entries: IDebugLogEntry[] = spans.map(span => spanToImportEntry(span, importedSessionId));
			this._importedSessions.set(importedSessionId, entries);

			const encoded = Buffer.from(importedSessionId).toString('base64');
			const uri = vscode.Uri.parse(`vscode-chat-session://imported/${encoded}`);
			return { uri, sessionTitle };
		} catch (err) {
			this._logService.error(`[OTelDebug] Failed to parse import file: ${err}`);
			return undefined;
		}
	}

	private async _getAvailableDebugSessionResources(
		token: vscode.CancellationToken,
	): Promise<{ uri: vscode.Uri; title?: string }[]> {
		const MAX_TAIL_READS = 15;

		try {
			const sessionIds = await this._fileLogger.listSessionIds();

			const toRead = sessionIds.slice(0, MAX_TAIL_READS);
			const settled = await Promise.allSettled(toRead.map(async (id): Promise<{ uri: vscode.Uri; title?: string } | undefined> => {
				if (token.isCancellationRequested) {
					return undefined;
				}
				const encoded = Buffer.from(id).toString('base64url');
				const uri = vscode.Uri.parse(`vscode-chat-session://local/${encoded}`);

				let title: string | undefined;
				let hasRealEvents = false;
				try {
					const entries = await this._fileLogger.readTailEntries(id, 50);
					const userMsg = entries.find(e => e.type === 'user_message');
					if (userMsg) {
						hasRealEvents = true;
						const content = userMsg.attrs.content as string | undefined;
						if (content) {
							title = content.length > 80 ? content.slice(0, 80) + '\u2026' : content;
						}
					}
					if (!hasRealEvents) {
						hasRealEvents = entries.some(e =>
							e.type === 'tool_call' || e.type === 'llm_request' ||
							e.type === 'agent_response' || e.type === 'subagent'
						);
					}
				} catch {
				}
				if (!hasRealEvents) {
					return undefined;
				}
				if (!title) {
					const shortId = id.length > 12 ? id.slice(0, 12) + '\u2026' : id;
					title = `Session ${shortId}`;
				}
				return { uri, title };
			}));

			const results: { uri: vscode.Uri; title?: string }[] = [];
			for (const entry of settled) {
				if (entry.status === 'fulfilled' && entry.value) {
					results.push(entry.value);
				}
			}
			return results;
		} catch (err) {
			this._logService.error(`[OTelDebug] Failed to list available sessions: ${err}`);
			return [];
		}
	}
}


import type { ICompletedSpanData } from '../../../platform/otel/common/otelService';

function entryToExportSpan(entry: IDebugLogEntry): ICompletedSpanData {
	const attributes: Record<string, string | number | boolean | string[]> = {};

	switch (entry.type) {
		case 'tool_call':
			attributes['gen_ai.operation.name'] = 'execute_tool';
			attributes['gen_ai.tool.name'] = entry.name;
			if (entry.attrs.args !== undefined) { attributes['gen_ai.tool.call.arguments'] = String(entry.attrs.args); }
			if (entry.attrs.result !== undefined) { attributes['gen_ai.tool.call.result'] = String(entry.attrs.result); }
			break;
		case 'llm_request':
			attributes['gen_ai.operation.name'] = 'chat';
			if (entry.attrs.model !== undefined) { attributes['gen_ai.request.model'] = String(entry.attrs.model); }
			if (entry.attrs.inputTokens !== undefined) { attributes['gen_ai.usage.input_tokens'] = entry.attrs.inputTokens as number; }
			if (entry.attrs.outputTokens !== undefined) { attributes['gen_ai.usage.output_tokens'] = entry.attrs.outputTokens as number; }
			break;
		case 'subagent':
			attributes['gen_ai.operation.name'] = 'invoke_agent';
			if (entry.attrs.agentName !== undefined) { attributes['gen_ai.agent.name'] = String(entry.attrs.agentName); }
			break;
		case 'hook':
			attributes['gen_ai.operation.name'] = 'execute_hook';
			break;
		case 'discovery':
		case 'generic':
			attributes['gen_ai.operation.name'] = 'core_event';
			if (entry.attrs.details !== undefined) { attributes['dardcor_chat.event_details'] = String(entry.attrs.details); }
			if (entry.attrs.category !== undefined) { attributes['dardcor_chat.event_category'] = String(entry.attrs.category); }
			break;
		default:
			attributes['gen_ai.operation.name'] = 'core_event';
			break;
	}

	return {
		name: entry.name,
		spanId: entry.spanId,
		traceId: 'exported-trace',
		parentSpanId: entry.parentSpanId,
		startTime: entry.ts,
		endTime: entry.ts + entry.dur,
		status: { code: entry.status === 'error' ? 2 : 0 },
		attributes,
		events: [],
	};
}

function deriveSessionTitleFromEntries(entries: readonly IDebugLogEntry[]): string | undefined {
	for (const entry of entries) {
		if (entry.type === 'user_message') {
			const content = entry.attrs.content;
			if (typeof content === 'string' && content.trim()) {
				const title = content.trim();
				return title.length > 80 ? title.slice(0, 80) + '...' : title;
			}
		}
	}
	return undefined;
}

function deriveSessionTitleFromSpans(spans: readonly ICompletedSpanData[]): string | undefined {
	for (const span of spans) {
		for (const event of span.events) {
			if (event.name === 'user_message') {
				const content = event.attributes?.content;
				if (typeof content === 'string' && content.trim()) {
					const title = content.trim();
					return title.length > 80 ? title.slice(0, 80) + '...' : title;
				}
			}
		}
	}
	return undefined;
}

function spanToImportEntry(span: ICompletedSpanData, sessionId: string): IDebugLogEntry {
	const opName = (span.attributes['gen_ai.operation.name'] as string) ?? '';
	const duration = span.endTime - span.startTime;
	const isError = span.status.code === 2;

	let type: IDebugLogEntry['type'] = 'generic';
	const attrs: Record<string, string | number | boolean | undefined> = {};

	switch (opName) {
		case 'execute_tool':
			type = 'tool_call';
			if (span.attributes['gen_ai.tool.call.arguments'] !== undefined) { attrs.args = String(span.attributes['gen_ai.tool.call.arguments']); }
			if (span.attributes['gen_ai.tool.call.result'] !== undefined) { attrs.result = String(span.attributes['gen_ai.tool.call.result']); }
			break;
		case 'chat':
			type = 'llm_request';
			if (span.attributes['gen_ai.request.model'] !== undefined) { attrs.model = String(span.attributes['gen_ai.request.model']); }
			if (span.attributes['gen_ai.usage.input_tokens'] !== undefined) { attrs.inputTokens = span.attributes['gen_ai.usage.input_tokens'] as number; }
			if (span.attributes['gen_ai.usage.output_tokens'] !== undefined) { attrs.outputTokens = span.attributes['gen_ai.usage.output_tokens'] as number; }
			break;
		case 'invoke_agent':
			type = 'subagent';
			if (span.attributes['gen_ai.agent.name'] !== undefined) { attrs.agentName = String(span.attributes['gen_ai.agent.name']); }
			break;
		case 'execute_hook':
			type = 'hook';
			break;
		case 'core_event':
			type = (span.attributes['dardcor_chat.event_category'] === 'discovery') ? 'discovery' : 'generic';
			if (span.attributes['dardcor_chat.event_details'] !== undefined) { attrs.details = String(span.attributes['dardcor_chat.event_details']); }
			if (span.attributes['dardcor_chat.event_category'] !== undefined) { attrs.category = String(span.attributes['dardcor_chat.event_category']); }
			break;
	}

	if (isError && span.status.message) { attrs.error = span.status.message; }

	return {
		ts: span.startTime,
		dur: duration,
		sid: sessionId,
		type,
		name: span.name,
		spanId: span.spanId,
		parentSpanId: span.parentSpanId,
		status: isError ? 'error' : 'ok',
		attrs,
	};
}
