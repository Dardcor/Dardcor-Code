/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { dirname, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IAgentHostService } from '../../../../../platform/agentHost/common/agentService.js';
import { agentHostAuthority } from '../../../../../platform/agentHost/common/agentHostUri.js';
import { IRemoteAgentHostService } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { buildDefaultChatUri, CustomizationType, readUsageInfoMeta, StateComponents, type ChatState, type ChildCustomization, type Customization, type UsageInfo } from '../../../../../platform/agentHost/common/state/sessionState.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { ChatDebugHookResult, ChatDebugLogLevel, IChatDebugCustomizationLogEntry, IChatDebugEvent, IChatDebugFileEntry, IChatDebugLogProvider, IChatDebugMessageSection, IChatDebugModelTurnEvent, IChatDebugResolvedEventContent, IChatDebugService } from '../../common/chatDebugService.js';

import { AgentHostAgentDebugLogEnabledSettingId, AgentHostAgentDebugLogMaxEventsSettingId } from '../../common/promptSyntax/promptTypes.js';
import { buildLocalSessionStateUri, COPILOT_CLI_EH_SCHEME, COPILOT_CLI_LOCAL_AH_SCHEME, getCopilotCliSessionRawId, resolveEventsUri } from '../dardcorCliEventsUri.js';
import { AgentHostCustomizationRecorder, AgentHostUsageRecorder, buildAgentHostCustomizationsUri, buildAgentHostUsageUri, readAgentHostCustomizationsSnapshot, readAgentHostUsageRecords, type IAgentHostUsageRecord } from './agentHostUsageSidecar.js';

interface IAgentHostEventRecord {
	readonly type: string;
	readonly id: string;
	readonly parentId: string | null;
	readonly agentId?: string;
	readonly timestamp: string;
	readonly data: Record<string, unknown>;
}

const MAX_DISCOVERED_SESSIONS = 30;
const TITLE_READ_BYTES = 64 * 1024;
const MAX_RESOLVED_DETAILS = 50_000;
const DEFAULT_MAX_EVENTS_IN_MEMORY = 10_000;
const MAX_EVENT_PAYLOAD = 4_000;
const MAX_DETAIL_PAYLOAD = 100_000;

export class AgentHostChatDebugContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.agentHostChatDebug';

	private readonly _resolved = new Map<string, IChatDebugResolvedEventContent>();

	private _discovering = false;

	private _hasFetchedOnce = false;

	private readonly _liveRefresh = this._register(new MutableDisposable<DisposableStore>());
	private _watchedSessionKey: string | undefined;

	private _liveRead: { key: string; consumedBytes: number; pendingBytes: VSBuffer; records: IAgentHostEventRecord[] } | undefined;

	private _usageRead: { key: string; size: number; records: readonly IAgentHostUsageRecord[] } | undefined;

	constructor(
		@IChatDebugService private readonly _chatDebugService: IChatDebugService,
		@IFileService private readonly _fileService: IFileService,
		@IPathService private readonly _pathService: IPathService,
		@IRemoteAgentHostService private readonly _remoteAgentHostService: IRemoteAgentHostService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		
	) {
		super();

		const provider: IChatDebugLogProvider = {
			provideChatDebugLog: (sessionResource, token) => this._provideChatDebugLog(sessionResource, token),
			resolveChatDebugLogEvent: async eventId => this._resolved.get(eventId),
		};
		this._register(this._chatDebugService.registerProvider(provider));

		this._register(new AgentHostUsageRecorder(
			this._environmentService.userRoamingDataHome,
			() => this._configurationService.getValue<boolean>(AgentHostAgentDebugLogEnabledSettingId),
			this._fileService,
			this._logService,
			this._agentHostService,
			this._remoteAgentHostService,
		));

		this._register(new AgentHostCustomizationRecorder(
			this._environmentService.userRoamingDataHome,
			() => this._configurationService.getValue<boolean>(AgentHostAgentDebugLogEnabledSettingId),
			this._fileService,
			this._logService,
			this._agentHostService,
			this._remoteAgentHostService,
		));

		this._register(this._chatDebugService.onDidEndSession(sessionResource => {
			if (sessionResource.toString() === this._watchedSessionKey) {
				this._liveRefresh.clear();
				this._watchedSessionKey = undefined;
				this._liveRead = undefined;
				this._usageRead = undefined;
			}
		}));

		this._register(this._chatDebugService.registerAvailableSessionsFetcher(token => this._fetchLocalSessions(token)));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AgentHostAgentDebugLogEnabledSettingId) && this._hasFetchedOnce) {
				this._maybeDiscoverLocalSessions();
			}
		}));
	}

	private async _fetchLocalSessions(token: CancellationToken): Promise<{ uri: URI; title?: string }[]> {
		this._hasFetchedOnce = true;
		if (!this._configurationService.getValue<boolean>(AgentHostAgentDebugLogEnabledSettingId)) {
			return [];
		}
		try {
			return await this._discoverLocalSessions(token);
		} catch (err) {
			this._logService.warn(`[AgentHostChatDebug] session discovery failed: ${toErrorMessage(err)}`);
			return [];
		}
	}

	private async _maybeDiscoverLocalSessions(): Promise<void> {
		if (this._discovering || !this._configurationService.getValue<boolean>(AgentHostAgentDebugLogEnabledSettingId)) {
			return;
		}
		this._discovering = true;
		try {
			const sessions = await this._discoverLocalSessions(CancellationToken.None);
			if (sessions.length > 0) {
				this._chatDebugService.addAvailableSessionResources(sessions);
			}
		} catch (err) {
			this._logService.warn(`[AgentHostChatDebug] session discovery failed: ${toErrorMessage(err)}`);
		} finally {
			this._discovering = false;
		}
	}

	private _resolveEventsUri(sessionResource: URI): URI | undefined {
		const userHome = this._pathService.userHome({ preferLocal: true });
		const result = resolveEventsUri(
			sessionResource,
			userHome,
			authority => this._remoteAgentHostService.connections.find(c => agentHostAuthority(c.address) === authority),
		);
		return result.kind === 'ok' ? result.resource : undefined;
	}

	private _ensureLiveRefresh(sessionResource: URI, eventsUri: URI): void {
		const key = sessionResource.toString();
		if (this._watchedSessionKey === key) {
			return;
		}
		if (eventsUri.scheme !== Schemas.file) {
			this._liveRefresh.clear();
			this._watchedSessionKey = undefined;
			return;
		}

		this._watchedSessionKey = key;
		const store = new DisposableStore();
		const scheduler = store.add(new RunOnceScheduler(() => {
			this._chatDebugService.invokeProviders(sessionResource);
		}, 400));
		const watcher = store.add(this._fileService.createWatcher(dirname(eventsUri), { recursive: false, excludes: [] }));
		store.add(watcher.onDidChange(e => {
			const affects = e.affects(eventsUri);
			if (affects) {
				scheduler.schedule();
			}
		}));

		const liveSub = this._sessionChatSubscription(sessionResource);
		if (liveSub) {
			store.add(liveSub.onDidChange(() => scheduler.schedule()));
		}

		

		this._liveRefresh.value = store;
	}

	private _sessionChatSubscription(sessionResource: URI) {
		if (sessionResource.scheme !== COPILOT_CLI_LOCAL_AH_SCHEME) {
			return undefined;
		}
		const rawId = getCopilotCliSessionRawId(sessionResource);
		if (!rawId) {
			return undefined;
		}
		const backendSession = URI.from({ scheme: COPILOT_CLI_EH_SCHEME, path: `/${rawId}` });
		const chatUri = URI.parse(buildDefaultChatUri(backendSession.toString()));
		return this._agentHostService.getSubscriptionUnmanaged(StateComponents.Chat, chatUri);
	}

	private _getLiveUsageTotals(sessionResource: URI): ISessionUsageTotals | undefined {
		const chat = this._sessionChatSubscription(sessionResource)?.value;
		if (!chat || chat instanceof Error) {
			return undefined;
		}
		return sumChatStateUsage(chat);
	}

	private async _readUsageRecords(sessionResource: URI): Promise<readonly IAgentHostUsageRecord[] | undefined> {
		const rawId = getCopilotCliSessionRawId(sessionResource);
		if (!rawId) {
			return undefined;
		}
		const uri = buildAgentHostUsageUri(this._environmentService.userRoamingDataHome, rawId);
		const key = uri.toString();

		let size: number;
		try {
			const stat = await this._fileService.stat(uri);
			size = stat.size ?? 0;
		} catch {
			this._usageRead = undefined;
			return undefined;
		}

		if (this._usageRead?.key === key && this._usageRead.size === size) {
			return this._usageRead.records.length > 0 ? this._usageRead.records : undefined;
		}

		const records = await readAgentHostUsageRecords(this._fileService, uri);
		this._usageRead = { key, size, records };
		return records.length > 0 ? records : undefined;
	}

	private async _readCustomizationsSnapshot(sessionResource: URI): Promise<readonly Customization[] | undefined> {
		const rawId = getCopilotCliSessionRawId(sessionResource);
		if (!rawId) {
			return undefined;
		}
		const uri = buildAgentHostCustomizationsUri(this._environmentService.userRoamingDataHome, rawId);
		const snapshot = await readAgentHostCustomizationsSnapshot(this._fileService, uri);
		return snapshot && snapshot.length > 0 ? snapshot : undefined;
	}

	private async _provideChatDebugLog(sessionResource: URI, token: CancellationToken): Promise<IChatDebugEvent[] | undefined> {
		if (!this._configurationService.getValue<boolean>(AgentHostAgentDebugLogEnabledSettingId)) {
			return undefined;
		}
		const eventsUri = this._resolveEventsUri(sessionResource);
		if (!eventsUri) {
			return undefined;
		}

		this._ensureLiveRefresh(sessionResource, eventsUri);

		const records = await this._readEventRecords(eventsUri, token);
		if (records === undefined) {
			return undefined;
		}
		if (token.isCancellationRequested) {
			return undefined;
		}

		const liveUsageTotals = this._getLiveUsageTotals(sessionResource);

		const usageRecords = await this._readUsageRecords(sessionResource);
		if (token.isCancellationRequested) {
			return undefined;
		}

		let customizations: readonly Customization[] | undefined = await this._readCustomizationsSnapshot(sessionResource);
		if (token.isCancellationRequested) {
			return undefined;
		}

		const { events, resolved } = convertAgentHostEventsToDebugEvents(records, sessionResource, liveUsageTotals, usageRecords, customizations);

		for (const [id, detail] of resolved) {
			this._resolved.set(id, detail);
			if (this._resolved.size > MAX_RESOLVED_DETAILS) {
				const first = this._resolved.keys().next().value;
				if (first !== undefined) {
					this._resolved.delete(first);
				}
			}
		}

		return events;
	}

	private _maxRecordsInMemory(): number {
		const configured = this._configurationService.getValue<number>(AgentHostAgentDebugLogMaxEventsSettingId);
		if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 1) {
			return Math.floor(configured);
		}
		return DEFAULT_MAX_EVENTS_IN_MEMORY;
	}

	private _capRecordsInMemory(records: IAgentHostEventRecord[]): void {
		const max = this._maxRecordsInMemory();
		if (records.length > max) {
			records.splice(0, records.length - max);
		}
	}

	private async _readEventRecords(eventsUri: URI, token: CancellationToken): Promise<IAgentHostEventRecord[] | undefined> {
		const key = eventsUri.toString();
		let size: number;
		try {
			const stat = await this._fileService.stat(eventsUri);
			size = stat.size ?? 0;
		} catch {
			this._liveRead = undefined;
			return undefined;
		}
		if (token.isCancellationRequested) {
			return undefined;
		}

		const cache = this._liveRead?.key === key ? this._liveRead : undefined;

		if (cache && size >= cache.consumedBytes) {
			if (size === cache.consumedBytes) {
				return cache.records;
			}
			try {
				const content = await this._fileService.readFile(eventsUri, { position: cache.consumedBytes, length: size - cache.consumedBytes });
				if (token.isCancellationRequested) {
					return undefined;
				}
				const combined = cache.pendingBytes.byteLength ? VSBuffer.concat([cache.pendingBytes, content.value]) : content.value;
				const lastNewline = lastIndexOfNewline(combined);
				if (lastNewline >= 0) {
					appendJsonlRecords(combined.slice(0, lastNewline + 1).toString(), cache.records);
					cache.pendingBytes = combined.slice(lastNewline + 1);
				} else {
					cache.pendingBytes = combined;
				}
				cache.consumedBytes = size;
				this._capRecordsInMemory(cache.records);
				return cache.records;
			} catch {
			}
		}

		let buffer: VSBuffer;
		try {
			const content = await this._fileService.readFile(eventsUri);
			buffer = content.value;
		} catch {
			this._liveRead = undefined;
			return undefined;
		}
		if (token.isCancellationRequested) {
			return undefined;
		}
		const lastNewline = lastIndexOfNewline(buffer);
		const records: IAgentHostEventRecord[] = [];
		if (lastNewline >= 0) {
			appendJsonlRecords(buffer.slice(0, lastNewline + 1).toString(), records);
		}
		this._capRecordsInMemory(records);
		this._liveRead = {
			key,
			consumedBytes: buffer.byteLength,
			pendingBytes: lastNewline >= 0 ? buffer.slice(lastNewline + 1) : buffer,
			records,
		};
		return records;
	}

	private async _discoverLocalSessions(token: CancellationToken): Promise<{ uri: URI; title?: string }[]> {
		const userHome = this._pathService.userHome({ preferLocal: true });
		const sessionStateDir = buildLocalSessionStateUri(userHome);

		let stat;
		try {
			stat = await this._fileService.resolve(sessionStateDir, { resolveMetadata: true });
		} catch {
			return [];
		}
		if (token.isCancellationRequested) {
			return [];
		}

		const folders = (stat.children ?? [])
			.filter(child => child.isDirectory)
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, MAX_DISCOVERED_SESSIONS);

		const found = await Promise.all(folders.map(async folder => {
			const eventsUri = joinPath(folder.resource, 'events.jsonl');
			let title: string | undefined;
			try {
				const head = await this._fileService.readFile(eventsUri, { length: TITLE_READ_BYTES });
				title = extractSessionTitle(head.value.toString()) ?? fallbackSessionTitle(folder.name);
			} catch {
				return undefined;
			}
			return { uri: URI.from({ scheme: COPILOT_CLI_LOCAL_AH_SCHEME, path: `/${folder.name}` }), title };
		}));

		if (token.isCancellationRequested) {
			return [];
		}
		return found.filter((s): s is NonNullable<typeof s> => s !== undefined);
	}
}

export function convertAgentHostEventsToDebugEvents(
	records: readonly IAgentHostEventRecord[],
	sessionResource: URI,
	fallbackUsageTotals?: ISessionUsageTotals,
	usageRecords?: readonly IAgentHostUsageRecord[],
	customizations?: readonly Customization[],
): { readonly events: IChatDebugEvent[]; readonly resolved: Map<string, IChatDebugResolvedEventContent> } {
	const completeByToolCallId = new Map<string, IAgentHostEventRecord>();
	const turnStartByTurnId = new Map<string, IAgentHostEventRecord>();
	const hookEndByInvocationId = new Map<string, IAgentHostEventRecord>();
	const permissionCompleteByRequestId = new Map<string, IAgentHostEventRecord>();
	const subagentCompleteByToolCallId = new Map<string, IAgentHostEventRecord>();
	for (const record of records) {
		if (record.type === 'tool.execution_complete') {
			const toolCallId = asString(record.data.toolCallId);
			if (toolCallId) {
				completeByToolCallId.set(toolCallId, record);
			}
		} else if (record.type === 'assistant.turn_start') {
			const turnId = asString(record.data.turnId);
			if (turnId) {
				turnStartByTurnId.set(turnId, record);
			}
		} else if (record.type === 'hook.end') {
			const invocationId = asString(record.data.hookInvocationId);
			if (invocationId) {
				hookEndByInvocationId.set(invocationId, record);
			}
		} else if (record.type === 'permission.completed') {
			const requestId = asString(record.data.requestId);
			if (requestId) {
				permissionCompleteByRequestId.set(requestId, record);
			}
		} else if (record.type === 'subagent.completed') {
			const toolCallId = asString(record.data.toolCallId);
			if (toolCallId) {
				subagentCompleteByToolCallId.set(toolCallId, record);
			}
		}
	}

	const events: IChatDebugEvent[] = [];
	const resolved = new Map<string, IChatDebugResolvedEventContent>();
	const modelTurnRefs: IModelTurnRef[] = [];

	let rootEventId: string | undefined;
	let rootCreated: Date | undefined;
	const currentUserMessageByAgent = new Map<string, string>();
	const currentAssistantMessageByAgent = new Map<string, string>();
	const toolEventByToolCallId = new Map<string, string>();

	const hasConfiguredHooks = !!customizations
		&& flattenCustomizations(customizations).some(c => c.type === CustomizationType.Hook && c.enabled);

	for (const record of records) {
		const created = new Date(record.timestamp);
		const agentKey = record.agentId ?? '';
		const turnParent = currentAssistantMessageByAgent.get(agentKey) ?? currentUserMessageByAgent.get(agentKey) ?? rootEventId;

		switch (record.type) {
			case 'session.start': {
				rootEventId = record.id;
				rootCreated = created;
				const model = asString(record.data.selectedModel);
				const effort = asString(record.data.reasoningEffort);
				const version = asString(record.data.copilotVersion);
				const context = asRecord(record.data.context);
				const repository = asString(context?.repository);
				const branch = asString(context?.branch);
				const parts: string[] = [];
				if (model) {
					parts.push(effort
						? localize('agentHost.debug.sessionStartedDetails', "model={0}, reasoningEffort={1}", model, effort)
						: localize('agentHost.debug.sessionStartedModel', "model={0}", model));
				}
				if (version) {
					parts.push(localize('agentHost.debug.sessionCliVersion', "CLI {0}", version));
				}
				if (repository) {
					parts.push(branch
						? localize('agentHost.debug.sessionRepoBranch', "{0}@{1}", repository, branch)
						: repository);
				}
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId: undefined,
					name: localize('agentHost.debug.sessionStarted', "Session Started"),
					details: parts.length ? parts.join(', ') : undefined, level: ChatDebugLogLevel.Info, category: 'session',
				});
				break;
			}
			case 'user.message': {
				const content = asString(record.data.content) ?? '';
				const transformed = asString(record.data.transformedContent);
				const sections: IChatDebugMessageSection[] = [
					{ name: localize('agentHost.debug.userRequest', "User Request"), content },
				];
				if (transformed && transformed !== content) {
					sections.push({ name: localize('agentHost.debug.fullPrompt', "Full Prompt"), content: transformed });
				}
				const message = summarize(content);
				currentUserMessageByAgent.set(agentKey, record.id);
				currentAssistantMessageByAgent.delete(agentKey);
				events.push({ kind: 'userMessage', id: record.id, sessionResource, created, parentEventId: rootEventId, message, sections });
				resolved.set(record.id, { kind: 'message', type: 'user', message, sections });
				break;
			}
			case 'assistant.message': {
				const model = asString(record.data.model);
				const outputTokens = asNumber(record.data.outputTokens);
				const content = asString(record.data.content) ?? '';
				const reasoning = asString(record.data.reasoningText);
				const parentToolCallId = asString(record.data.parentToolCallId);
				const spawningTool = parentToolCallId ? toolEventByToolCallId.get(parentToolCallId) : undefined;
				const parentEventId = spawningTool ?? currentUserMessageByAgent.get(agentKey) ?? rootEventId;
				const turnId = asString(record.data.turnId);
				const turnStart = turnId ? turnStartByTurnId.get(turnId) : undefined;
				const durationInMillis = turnStart ? diffMillis(turnStart.timestamp, record.timestamp) : undefined;

				currentAssistantMessageByAgent.set(agentKey, record.id);
				modelTurnRefs.push({ index: events.length, id: record.id, turnId, outputTokens });
				events.push({
					kind: 'modelTurn', id: record.id, sessionResource, created, parentEventId,
					model, requestName: 'copilotcli', outputTokens, durationInMillis,
				});

				const sections: IChatDebugMessageSection[] = [];
				if (content) {
					sections.push({ name: localize('agentHost.debug.response', "Response"), content });
				}
				if (reasoning) {
					sections.push({ name: localize('agentHost.debug.reasoning', "Reasoning"), content: reasoning });
				}
				resolved.set(record.id, { kind: 'modelTurn', requestName: 'copilotcli', model, outputTokens, durationInMillis, sections });
				break;
			}
			case 'tool.execution_start': {
				const toolName = asString(record.data.toolName) ?? 'tool';
				const toolCallId = asString(record.data.toolCallId);
				const complete = toolCallId ? completeByToolCallId.get(toolCallId) : undefined;
				const success = complete ? asBoolean(complete.data.success) : undefined;
				const result = success === undefined ? undefined : (success ? 'success' : 'error');
				const durationInMillis = complete ? diffMillis(record.timestamp, complete.timestamp) : undefined;
				const fullInput = stringifyPayload(record.data.arguments);
				const fullOutput = complete ? stringifyPayload(complete.data.result) : undefined;
				const parentToolCallId = asString(record.data.parentToolCallId);
				const parentTool = parentToolCallId ? toolEventByToolCallId.get(parentToolCallId) : undefined;
				const parentEventId = parentTool ?? currentAssistantMessageByAgent.get(agentKey) ?? currentUserMessageByAgent.get(agentKey) ?? rootEventId;
				if (toolCallId) {
					toolEventByToolCallId.set(toolCallId, record.id);
				}

				events.push({
					kind: 'toolCall', id: record.id, sessionResource, created, parentEventId,
					toolName, toolCallId, result, durationInMillis,
					input: truncate(fullInput, MAX_EVENT_PAYLOAD),
					output: truncate(fullOutput, MAX_EVENT_PAYLOAD),
				});
				resolved.set(record.id, {
					kind: 'toolCall', toolName, result, durationInMillis,
					input: truncate(fullInput, MAX_DETAIL_PAYLOAD),
					output: truncate(fullOutput, MAX_DETAIL_PAYLOAD),
				});
				break;
			}
			case 'session.error': {
				const message = asString(record.data.message) ?? localize('agentHost.debug.unknownError', "Unknown error");
				const errorType = asString(record.data.errorType);
				const stack = asString(record.data.stack);
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId: turnParent,
					name: errorType
						? localize('agentHost.debug.sessionErrorTyped', "Error ({0})", errorType)
						: localize('agentHost.debug.sessionError', "Error"),
					details: truncate(message, MAX_EVENT_PAYLOAD),
					level: ChatDebugLogLevel.Error, category: 'session',
				});
				const detailText = stack ? `${message}\n\n${stack}` : message;
				resolved.set(record.id, { kind: 'text', value: truncate(detailText, MAX_DETAIL_PAYLOAD) ?? detailText });
				break;
			}
			case 'session.warning': {
				const message = asString(record.data.message) ?? '';
				const warningType = asString(record.data.warningType);
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId: turnParent,
					name: warningType
						? localize('agentHost.debug.sessionWarningTyped', "Warning ({0})", warningType)
						: localize('agentHost.debug.sessionWarning', "Warning"),
					details: truncate(message, MAX_EVENT_PAYLOAD),
					level: ChatDebugLogLevel.Warning, category: 'session',
				});
				if (message) {
					resolved.set(record.id, { kind: 'text', value: truncate(message, MAX_DETAIL_PAYLOAD) ?? message });
				}
				break;
			}
			case 'session.model_change': {
				const previousModel = asString(record.data.previousModel);
				const newModel = asString(record.data.newModel);
				const effort = asString(record.data.reasoningEffort);
				const change = previousModel && newModel
					? localize('agentHost.debug.modelChangeFromTo', "{0} → {1}", previousModel, newModel)
					: newModel;
				const details = change && effort
					? localize('agentHost.debug.modelChangeEffort', "{0} (reasoningEffort={1})", change, effort)
					: change;
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId: turnParent,
					name: localize('agentHost.debug.modelChanged', "Model Changed"),
					details, level: ChatDebugLogLevel.Info, category: 'session',
				});
				break;
			}
			case 'hook.start': {
				const hookType = asString(record.data.hookType) ?? 'hook';
				const invocationId = asString(record.data.hookInvocationId);
				const end = invocationId ? hookEndByInvocationId.get(invocationId) : undefined;
				const success = end ? asBoolean(end.data.success) : undefined;
				const isError = hookType === 'errorOccurred';
				if ((hookType === 'preToolUse' || hookType === 'postToolUse') && !hasConfiguredHooks) {
					break;
				}
				const hookParent = hookType === 'preToolUse'
					? (currentUserMessageByAgent.get(agentKey) ?? rootEventId)
					: turnParent;
				if (!isError && success !== false) {
					events.push({
						kind: 'generic', id: record.id, sessionResource, created, parentEventId: hookParent,
						name: localize('agentHost.debug.hookRan', "Hook: {0}", hookType),
						level: ChatDebugLogLevel.Info, category: 'hook',
					});
					const routineInput = stringifyPayload(record.data.input);
					resolved.set(record.id, {
						kind: 'hook', hookType,
						result: success === undefined ? undefined : (success ? ChatDebugHookResult.Success : ChatDebugHookResult.Error),
						input: truncate(routineInput, MAX_DETAIL_PAYLOAD),
					});
					break;
				}
				const input = asRecord(record.data.input);
				const errorContext = asString(input?.errorContext);
				const recoverable = asBoolean(input?.recoverable);
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId: hookParent,
					name: isError
						? (errorContext
							? localize('agentHost.debug.hookErrorContext', "Error During {0}", errorContext)
							: localize('agentHost.debug.hookError', "Error Occurred"))
						: localize('agentHost.debug.hookFailed', "Hook Failed: {0}", hookType),
					details: isError && recoverable !== undefined
						? (recoverable
							? localize('agentHost.debug.hookRecoverable', "Recoverable; retrying")
							: localize('agentHost.debug.hookUnrecoverable', "Unrecoverable"))
						: undefined,
					level: isError
						? (recoverable === false ? ChatDebugLogLevel.Error : ChatDebugLogLevel.Warning)
						: ChatDebugLogLevel.Error,
					category: 'hook',
				});
				const inputText = stringifyPayload(record.data.input);
				const endError = asRecord(end?.data.error);
				const errorParts = endError
					? [asString(endError.message), asString(endError.source)].filter((s): s is string => !!s)
					: [];
				const outputText = end && end.data.output !== undefined ? stringifyPayload(end.data.output) : undefined;
				resolved.set(record.id, {
					kind: 'hook', hookType,
					result: success === undefined ? undefined : (success ? ChatDebugHookResult.Success : ChatDebugHookResult.Error),
					input: truncate(inputText, MAX_DETAIL_PAYLOAD),
					output: outputText ? truncate(outputText, MAX_DETAIL_PAYLOAD) : undefined,
					errorMessage: errorParts.length > 0 ? truncate(errorParts.join('\n'), MAX_DETAIL_PAYLOAD) : undefined,
				});
				break;
			}
			case 'permission.requested': {
				const requestId = asString(record.data.requestId);
				const permissionRequest = asRecord(record.data.permissionRequest);
				const kind = asString(permissionRequest?.kind) ?? 'permission';
				const intention = asString(permissionRequest?.intention);
				const toolCallId = asString(permissionRequest?.toolCallId);
				const completed = requestId ? permissionCompleteByRequestId.get(requestId) : undefined;
				const resultKind = completed ? asString(asRecord(completed.data.result)?.kind) : undefined;
				if (resultKind === 'approved') {
					break;
				}
				const parentEventId = (toolCallId ? toolEventByToolCallId.get(toolCallId) : undefined) ?? turnParent;
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId,
					name: resultKind
						? localize('agentHost.debug.permissionResolved', "Permission {0}: {1}", resultKind, kind)
						: localize('agentHost.debug.permissionPending', "Awaiting Permission: {0}", kind),
					details: intention,
					level: ChatDebugLogLevel.Warning, category: 'permission',
				});
				const path = asString(permissionRequest?.path);
				const lines = [
					localize('agentHost.debug.permissionKind', "kind: {0}", kind),
					intention ? localize('agentHost.debug.permissionIntention', "intention: {0}", intention) : undefined,
					path ? localize('agentHost.debug.permissionPath', "path: {0}", path) : undefined,
					localize('agentHost.debug.permissionResult', "result: {0}", resultKind ?? localize('agentHost.debug.permissionPendingValue', "pending")),
				].filter((l): l is string => !!l);
				resolved.set(record.id, { kind: 'text', value: lines.join('\n') });
				break;
			}
			case 'subagent.started': {
				const toolCallId = asString(record.data.toolCallId);
				const agentName = asString(record.data.agentDisplayName) ?? asString(record.data.agentName) ?? 'subagent';
				const description = asString(record.data.agentDescription);
				const model = asString(record.data.model);
				const complete = toolCallId ? subagentCompleteByToolCallId.get(toolCallId) : undefined;
				const toolCallCount = complete ? asNumber(complete.data.totalToolCalls) : undefined;
				const totalTokens = complete ? asNumber(complete.data.totalTokens) : undefined;
				const durationInMillis = complete ? asNumber(complete.data.durationMs) : undefined;
				const parentEventId = (toolCallId ? toolEventByToolCallId.get(toolCallId) : undefined) ?? turnParent;
				events.push({
					kind: 'subagentInvocation', id: record.id, sessionResource, created, parentEventId,
					agentName, description, status: complete ? 'completed' : 'running', toolCallCount, durationInMillis,
				});
				const lines = [
					localize('agentHost.debug.subagentName', "agent: {0}", agentName),
					model ? localize('agentHost.debug.subagentModel', "model: {0}", model) : undefined,
					toolCallCount !== undefined ? localize('agentHost.debug.subagentToolCalls', "tool calls: {0}", toolCallCount) : undefined,
					totalTokens !== undefined ? localize('agentHost.debug.subagentTokens', "tokens: {0}", totalTokens) : undefined,
					description ? `\n${description}` : undefined,
				].filter((l): l is string => !!l);
				resolved.set(record.id, { kind: 'text', value: lines.join('\n') });
				break;
			}
			case 'session.compaction_start': {
				const systemTokens = asNumber(record.data.systemTokens) ?? 0;
				const conversationTokens = asNumber(record.data.conversationTokens) ?? 0;
				const toolTokens = asNumber(record.data.toolDefinitionsTokens) ?? 0;
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId: turnParent,
					name: localize('agentHost.debug.compaction', "Context Compaction"),
					details: localize('agentHost.debug.compactionTokens', "system={0}, conversation={1}, tools={2} tokens", systemTokens, conversationTokens, toolTokens),
					level: ChatDebugLogLevel.Info, category: 'session',
				});
				break;
			}
			case 'session.compaction_complete': {
				if (asBoolean(record.data.success) !== false) {
					break;
				}
				const error = asString(record.data.error);
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId: turnParent,
					name: localize('agentHost.debug.compactionFailed', "Context Compaction Failed"),
					details: truncate(error, MAX_EVENT_PAYLOAD),
					level: ChatDebugLogLevel.Error, category: 'session',
				});
				if (error) {
					resolved.set(record.id, { kind: 'text', value: truncate(error, MAX_DETAIL_PAYLOAD) ?? error });
				}
				break;
			}
			case 'abort': {
				const reason = asString(record.data.reason);
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId: turnParent,
					name: localize('agentHost.debug.aborted', "Aborted"),
					details: reason, level: ChatDebugLogLevel.Warning, category: 'session',
				});
				break;
			}
			case 'skill.invoked': {
				const name = asString(record.data.name) ?? 'skill';
				const trigger = asString(record.data.trigger);
				const source = asString(record.data.pluginName) ?? asString(record.data.source);
				const content = asString(record.data.content);
				events.push({
					kind: 'generic', id: record.id, sessionResource, created, parentEventId: turnParent,
					name: localize('agentHost.debug.skillInvoked', "Skill Invoked: {0}", name),
					details: [trigger, source].filter(Boolean).join(' \u00b7 ') || undefined,
					level: ChatDebugLogLevel.Info, category: 'customization',
				});
				if (content) {
					resolved.set(record.id, { kind: 'text', value: truncate(content, MAX_DETAIL_PAYLOAD) ?? content });
				}
				break;
			}
		}
	}


	const fillTurnsWithTotals = (targets: readonly IModelTurnRef[], totals: ISessionUsageTotals) => {
		const n = targets.length;
		if (n === 0) {
			return;
		}
		const inputs = totals.inputTokens !== undefined ? distributeEvenly(totals.inputTokens, n) : undefined;
		const cached = totals.cacheReadTokens !== undefined ? distributeEvenly(totals.cacheReadTokens, n) : undefined;
		const aiu = distributeEvenly(totals.totalNanoAiu, n);
		for (let i = 0; i < n; i++) {
			const ref = targets[i];
			const turn = events[ref.index] as IChatDebugModelTurnEvent;
			const inputTokens = inputs?.[i];
			const cachedTokens = cached?.[i];
			const totalTokens = inputTokens !== undefined ? inputTokens + (ref.outputTokens ?? 0) : undefined;
			const copilotUsageNanoAiu = aiu[i] > 0 ? aiu[i] : undefined;
			events[ref.index] = { ...turn, inputTokens, cachedTokens, totalTokens, copilotUsageNanoAiu };
			const detail = resolved.get(ref.id);
			if (detail?.kind === 'modelTurn') {
				resolved.set(ref.id, { ...detail, inputTokens, cachedTokens, totalTokens });
			}
		}
	};

	if (usageRecords && usageRecords.length > 0 && modelTurnRefs.length > 0) {
		const coverage = applyPerTurnUsage(events, resolved, modelTurnRefs, usageRecords);
		const uncovered = modelTurnRefs.filter((_ref, i) => !coverage.covered.has(i));
		if (uncovered.length > 0) {
			const totals = extractSessionUsageTotals(records) ?? fallbackUsageTotals;
			if (totals) {
				fillTurnsWithTotals(uncovered, {
					inputTokens: totals.inputTokens !== undefined ? Math.max(0, totals.inputTokens - coverage.assignedInput) : undefined,
					cacheReadTokens: totals.cacheReadTokens !== undefined ? Math.max(0, totals.cacheReadTokens - coverage.assignedCache) : undefined,
					totalNanoAiu: Math.max(0, totals.totalNanoAiu - coverage.assignedAiu),
				});
			}
		}
	} else if (modelTurnRefs.length > 0) {
		const totals = extractSessionUsageTotals(records) ?? fallbackUsageTotals;
		if (totals) {
			fillTurnsWithTotals(modelTurnRefs, totals);
		}
	}

	if (customizations && customizations.length > 0) {
		const created = rootCreated ?? (records.length > 0 ? new Date(records[0].timestamp) : new Date());
		const { events: customEvents, resolved: customResolved } = buildCustomizationDebugEvents(customizations, sessionResource, rootEventId, created);
		events.push(...customEvents);
		for (const [id, detail] of customResolved) {
			resolved.set(id, detail);
		}
	}

	return { events, resolved };
}

const CUSTOMIZATION_TYPE_ORDER: readonly CustomizationType[] = [
	CustomizationType.Skill, CustomizationType.Hook, CustomizationType.Agent,
	CustomizationType.McpServer, CustomizationType.Rule, CustomizationType.Prompt,
];

interface IFlatCustomization {
	readonly type: CustomizationType;
	readonly name: string;
	readonly uri: string;
	readonly enabled: boolean;
	readonly description?: string;
}

function flattenCustomizations(customizations: readonly Customization[]): IFlatCustomization[] {
	const out: IFlatCustomization[] = [];
	const visit = (c: Customization | ChildCustomization): void => {
		if (c.type === CustomizationType.Plugin || c.type === CustomizationType.Directory) {
			for (const child of c.children ?? []) {
				visit(child);
			}
			return;
		}
		out.push({
			type: c.type,
			name: c.name,
			uri: c.uri,
			enabled: (c as { enabled?: boolean }).enabled !== false,
			description: (c as { description?: string }).description,
		});
	};
	for (const c of customizations) {
		visit(c);
	}
	return out;
}

function customizationDiscoveryName(type: CustomizationType): string {
	switch (type) {
		case CustomizationType.Skill: return localize('agentHost.debug.skillDiscovery', "Skill Discovery");
		case CustomizationType.Hook: return localize('agentHost.debug.hookDiscovery', "Hook Discovery");
		case CustomizationType.Agent: return localize('agentHost.debug.agentDiscovery', "Agent Discovery");
		case CustomizationType.McpServer: return localize('agentHost.debug.mcpDiscovery', "MCP Server Discovery");
		case CustomizationType.Rule: return localize('agentHost.debug.ruleDiscovery', "Instructions Discovery");
		case CustomizationType.Prompt: return localize('agentHost.debug.promptDiscovery', "Prompt Discovery");
		default: return localize('agentHost.debug.customizationDiscovery', "Customization Discovery");
	}
}

function customizationSummaryCategory(c: IFlatCustomization): IChatDebugCustomizationLogEntry['category'] | undefined {
	if (!c.enabled) {
		return 'skipped';
	}
	switch (c.type) {
		case CustomizationType.Skill: return 'skill';
		case CustomizationType.Agent: return 'custom-agent';
		case CustomizationType.Hook: return 'hook';
		case CustomizationType.Rule: return 'applying';
		default: return undefined;
	}
}

export function buildCustomizationDebugEvents(
	customizations: readonly Customization[],
	sessionResource: URI,
	parentEventId: string | undefined,
	created: Date,
): { readonly events: IChatDebugEvent[]; readonly resolved: Map<string, IChatDebugResolvedEventContent> } {
	const events: IChatDebugEvent[] = [];
	const resolved = new Map<string, IChatDebugResolvedEventContent>();
	const flat = flattenCustomizations(customizations);
	if (flat.length === 0) {
		return { events, resolved };
	}

	const byType = new Map<CustomizationType, IFlatCustomization[]>();
	for (const c of flat) {
		const list = byType.get(c.type);
		if (list) {
			list.push(c);
		} else {
			byType.set(c.type, [c]);
		}
	}

	const key = sessionResource.toString();

	for (const type of CUSTOMIZATION_TYPE_ORDER) {
		const list = byType.get(type);
		if (!list || list.length === 0) {
			continue;
		}
		const id = `agentHostCustomization:${key}:${type}`;
		const loadedCount = list.filter(c => c.enabled).length;
		const skippedCount = list.length - loadedCount;
		events.push({
			kind: 'generic', id, sessionResource, created, parentEventId,
			name: customizationDiscoveryName(type),
			details: skippedCount > 0
				? localize('agentHost.debug.customizationLoadedSkipped', "{0} loaded, {1} disabled", loadedCount, skippedCount)
				: localize('agentHost.debug.customizationLoaded', "{0} loaded", loadedCount),
			level: ChatDebugLogLevel.Info, category: 'discovery',
		});
		const files: IChatDebugFileEntry[] = list.map(c => ({
			uri: URI.parse(c.uri),
			name: c.name,
			status: c.enabled ? 'loaded' : 'skipped',
			skipReason: c.enabled ? undefined : localize('agentHost.debug.customizationDisabled', "disabled"),
		}));
		resolved.set(id, { kind: 'fileList', discoveryType: type, durationInMillis: 0, files });
	}

	const logs: IChatDebugCustomizationLogEntry[] = [];
	for (const c of flat) {
		const category = customizationSummaryCategory(c);
		if (!category) {
			continue;
		}
		logs.push({ category, name: c.name, uri: URI.parse(c.uri), reason: c.description });
	}
	if (logs.length > 0) {
		const id = `agentHostCustomization:${key}:summary`;
		const counts = {
			instructions: logs.filter(e => e.category === 'applying' || e.category === 'referenced').length,
			skills: logs.filter(e => e.category === 'skill').length,
			agents: logs.filter(e => e.category === 'custom-agent').length,
			hooks: logs.filter(e => e.category === 'hook').length,
			skipped: logs.filter(e => e.category === 'skipped').length,
		};
		events.push({
			kind: 'generic', id, sessionResource, created, parentEventId,
			name: localize('agentHost.debug.customizationsResolved', "Resolve Customizations"),
			details: localize('agentHost.debug.customizationsResolvedDetails', "{0} skills, {1} agents, {2} hooks, {3} instructions", counts.skills, counts.agents, counts.hooks, counts.instructions),
			level: ChatDebugLogLevel.Info, category: 'customization',
		});
		resolved.set(id, { kind: 'customizationSummary', resolutionLogs: logs, durationInMillis: 0, counts });
	}

	return { events, resolved };
}

interface IModelTurnRef {
	readonly index: number;
	readonly id: string;
	readonly turnId?: string;
	readonly outputTokens?: number;
}

interface IPerTurnUsageCoverage {
	readonly covered: ReadonlySet<number>;
	readonly assignedInput: number;
	readonly assignedCache: number;
	readonly assignedAiu: number;
}

function applyPerTurnUsage(
	events: IChatDebugEvent[],
	resolved: Map<string, IChatDebugResolvedEventContent>,
	modelTurnRefs: readonly IModelTurnRef[],
	usageRecords: readonly IAgentHostUsageRecord[],
): IPerTurnUsageCoverage {
	const assign = (ref: typeof modelTurnRefs[number], inputTokens: number | undefined, cachedTokens: number | undefined, copilotUsageNanoAiu: number | undefined) => {
		const turn = events[ref.index] as IChatDebugModelTurnEvent;
		const totalTokens = inputTokens !== undefined ? inputTokens + (ref.outputTokens ?? 0) : undefined;
		events[ref.index] = { ...turn, inputTokens, cachedTokens, totalTokens, copilotUsageNanoAiu };
		const detail = resolved.get(ref.id);
		if (detail?.kind === 'modelTurn') {
			resolved.set(ref.id, { ...detail, inputTokens, cachedTokens, totalTokens });
		}
	};


	const aiuByRecordIndex = new Array<number | undefined>(usageRecords.length).fill(undefined);
	for (let start = 0; start < usageRecords.length;) {
		let end = start;
		while (end + 1 < usageRecords.length && usageRecords[end + 1].turnId === usageRecords[start].turnId) {
			end++;
		}
		let maxAiu = 0;
		for (let i = start; i <= end; i++) {
			maxAiu = Math.max(maxAiu, usageRecords[i].totalNanoAiu ?? 0);
		}
		if (maxAiu > 0) {
			aiuByRecordIndex[end] = maxAiu;
		}
		start = end + 1;
	}

	let recordIndex = 0;
	let assignedInput = 0;
	let assignedCache = 0;
	let assignedAiu = 0;
	const covered = new Set<number>();
	for (let refIdx = 0; refIdx < modelTurnRefs.length; refIdx++) {
		if (recordIndex >= usageRecords.length) {
			break;
		}
		const ref = modelTurnRefs[refIdx];
		const record = usageRecords[recordIndex];
		if (ref.outputTokens !== undefined && record.outputTokens !== undefined && ref.outputTokens !== record.outputTokens) {
			continue;
		}
		const aiu = aiuByRecordIndex[recordIndex];
		assign(ref, record.inputTokens, record.cacheReadTokens, aiu);
		assignedInput += record.inputTokens ?? 0;
		assignedCache += record.cacheReadTokens ?? 0;
		assignedAiu += aiu ?? 0;
		covered.add(refIdx);
		recordIndex++;
	}
	return { covered, assignedInput, assignedCache, assignedAiu };
}

interface ISessionUsageTotals {
	readonly inputTokens?: number;
	readonly cacheReadTokens?: number;
	readonly totalNanoAiu: number;
}

function extractSessionUsageTotals(records: readonly IAgentHostEventRecord[]): ISessionUsageTotals | undefined {
	let shutdown: IAgentHostEventRecord | undefined;
	for (const record of records) {
		if (record.type === 'session.shutdown') {
			shutdown = record;
		}
	}
	if (!shutdown) {
		return undefined;
	}

	let inputTokens = 0;
	let cacheReadTokens = 0;
	let perModelNanoAiu = 0;
	const modelMetrics = shutdown.data.modelMetrics;
	if (modelMetrics && typeof modelMetrics === 'object') {
		for (const metric of Object.values(modelMetrics as Record<string, unknown>)) {
			const entry = metric as Record<string, unknown> | undefined;
			const usage = entry?.usage as Record<string, unknown> | undefined;
			inputTokens += asNumber(usage?.inputTokens) ?? 0;
			cacheReadTokens += asNumber(usage?.cacheReadTokens) ?? 0;
			perModelNanoAiu += asNumber(entry?.totalNanoAiu) ?? 0;
		}
	}
	const totalNanoAiu = asNumber(shutdown.data.totalNanoAiu) ?? perModelNanoAiu;

	return { inputTokens, cacheReadTokens, totalNanoAiu };
}

function distributeEvenly(total: number, n: number): number[] {
	if (n <= 0) {
		return [];
	}
	const base = Math.floor(total / n);
	const parts = new Array<number>(n).fill(base);
	let remainder = total - base * n;
	for (let i = n - 1; remainder > 0; i--, remainder--) {
		parts[i] += 1;
	}
	return parts;
}

function sumChatStateUsage(chat: ChatState): ISessionUsageTotals | undefined {
	let totalNanoAiu = 0;
	let hasUsage = false;
	const add = (usage: UsageInfo | undefined) => {
		if (!usage) {
			return;
		}
		hasUsage = true;
		totalNanoAiu += readCopilotNanoAiu(usage);
	};
	for (const turn of chat.turns) {
		add(turn.usage);
	}
	add(chat.activeTurn?.usage);
	return hasUsage ? { totalNanoAiu } : undefined;
}

function readCopilotNanoAiu(usage: UsageInfo): number {
	return readUsageInfoMeta(usage).copilotUsage?.totalNanoAiu ?? 0;
}

export function parseJsonl(text: string): IAgentHostEventRecord[] {
	const records: IAgentHostEventRecord[] = [];
	appendJsonlRecords(text, records);
	return records;
}

function appendJsonlRecords(text: string, records: IAgentHostEventRecord[]): void {
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed && typeof parsed.type === 'string' && typeof parsed.id === 'string'
				&& typeof parsed.timestamp === 'string'
				&& (parsed.parentId === null || typeof parsed.parentId === 'string')
				&& parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
				records.push(parsed as IAgentHostEventRecord);
			}
		} catch {
		}
	}
}

function lastIndexOfNewline(buffer: VSBuffer): number {
	const bytes = buffer.buffer;
	for (let i = bytes.length - 1; i >= 0; i--) {
		if (bytes[i] === 0x0A ) {
			return i;
		}
	}
	return -1;
}

function fallbackSessionTitle(sessionId: string): string {
	return localize('agentHost.debug.untitledSession', "Dardcor CLI Session {0}", sessionId.slice(0, 8));
}

function extractSessionTitle(text: string): string | undefined {
	for (const record of parseJsonl(text)) {
		if (record.type === 'user.message') {
			const content = asString(record.data.content);
			if (content) {
				return summarize(content);
			}
		}
	}
	return undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function diffMillis(start: string, end: string): number | undefined {
	const a = new Date(start).getTime();
	const b = new Date(end).getTime();
	return isFinite(a) && isFinite(b) && b >= a ? b - a : undefined;
}

function stringifyPayload(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value === 'string') {
		return value;
	}
	try {
		return JSON.stringify(value, undefined, 2);
	} catch {
		return undefined;
	}
}

function truncate(value: string | undefined, max: number): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return value.length > max ? value.slice(0, max) + '…' : value;
}

function summarize(content: string): string {
	const firstLine = content.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
	return firstLine.length > 100 ? firstLine.slice(0, 100) + '…' : firstLine;
}

function toErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
