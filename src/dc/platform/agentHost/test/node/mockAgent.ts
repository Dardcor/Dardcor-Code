/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { observableValue } from '../../../../base/common/observable.js';
import type { IAuthorizationProtectedResourceMetadata } from '../../../../base/common/oauth.js';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { AgentHostClientType } from '../../common/agentHostClientInfo.js';
import { type ISyncedCustomization } from '../../common/agentPluginManager.js';
import { AgentSession, type AgentChatMigrationResult, type AgentProvider, type AgentSignal, type IActiveClient, type IAgent, type IAgentActionSignal, type IAgentCapabilities, type IAgentChatConfigCompletionsParams, type IAgentChatContext, type IAgentChatMetadata, type IAgentChats, type IAgentCreateChatOptions, type IAgentCreateChatResult, type IAgentCreateSessionConfig, type IAgentDescriptor, type IAgentDiscoveredChat, type IAgentModelInfo, type IAgentResolveChatConfigParams, type IAgentSessionMetadata, type IAgentToolPendingConfirmationSignal, resolveAgentChatContext } from '../../common/agent.js';
import { buildSubagentTurnsFromHistory, buildTurnsFromHistory, type IHistoryRecord } from './historyRecordFixtures.js';
import { ProtectedResourceMetadata, ToolCallContributorKind, type AgentSelection, type MessageAttachment, type ModelSelection, type ToolDefinition } from '../../common/state/protocol/state.js';
import type { ResolveSessionConfigResult, SessionConfigCompletionsResult } from '../../common/state/protocol/commands.js';
import { ActionType, type AuthRequiredParams } from '../../common/state/sessionActions.js';
import { ResponsePartKind, ToolCallConfirmationReason, ToolCallStatus, ToolResultContentType, CustomizationLoadStatus, buildDefaultChatUri, createErrorResponsePart, isAhpChatChannel, isDefaultChatUri, parseChatUri, parseSubagentSessionUri, type ClientPluginCustomization, type Customization, type PendingMessage, type StringOrMarkdown, type ToolCallResult, type Turn, type UsageInfo } from '../../common/state/sessionState.js';
import { hasKey } from '../../../../base/common/types.js';

export const MOCK_AUTO_TITLE = 'Automatically generated title';

function uriKey(session: URI): string {
	return `${session.scheme}://${session.authority}${session.path}${session.query ? '?' + session.query : ''}${session.fragment ? '#' + session.fragment : ''}`;
}

function mockProject(provider: AgentProvider) {
	return { uri: URI.from({ scheme: 'mock-project', path: `/${provider}` }), displayName: `Agent ${provider}` };
}

function mockWorkspacePath(relativePath: string): string {
	return join(process.env['VSCODE_AGENT_HOST_MOCK_WORKSPACE'] ?? process.cwd(), relativePath);
}

interface IMockSendMessageCall {
	readonly session: URI;
	readonly prompt: string;
	readonly attachments?: readonly MessageAttachment[];
	readonly chat?: URI;
	readonly senderClientId?: string;
	readonly clientType?: AgentHostClientType;
}

export class MockAgent implements IAgent {
	private readonly _discoveredChatsEmitter = new Emitter<readonly IAgentDiscoveredChat[]>();
	readonly onDidDiscoverChats = this._discoveredChatsEmitter.event;
	private readonly _onDidChatProgress = new Emitter<AgentSignal>();
	readonly onDidChatProgress = this._onDidChatProgress.event;
	readonly onDidMaterializeChat = Event.None;
	readonly onDidChangeChatData = Event.None;
	readonly onDidSpawnChat = Event.None;
	getTurnDiagnosticSnapshot?: IAgent['getTurnDiagnosticSnapshot'];

	recordModelCallTurnCorrelation(chat: URI, modelCallId: string, turnId: string): void {
		this.modelCallTurnCorrelationCalls.push({ chat, modelCallId, turnId });
	}
	private readonly _onDidSendMessage = new Emitter<IMockSendMessageCall>();
	readonly onDidSendMessage = this._onDidSendMessage.event;
	private readonly _models = observableValue<readonly IAgentModelInfo[]>(this, []);
	readonly models = this._models;
	private readonly _authenticationRequired = observableValue<Omit<AuthRequiredParams, 'channel'> | undefined>(this, undefined);
	readonly authenticationRequired = this._authenticationRequired;

	private readonly _sessions = new Map<string, URI>();
	private readonly _initialChats = new Set<string>();
	private readonly _activeTurnIds = new Map<string, string>();


	readonly sendMessageCalls: IMockSendMessageCall[] = [];
	readonly setPendingMessagesCalls: { chat: URI; steeringMessage: PendingMessage | undefined; queuedMessages: readonly PendingMessage[] }[] = [];
	readonly disposeSessionCalls: URI[] = [];
	readonly releaseSessionCalls: URI[] = [];
	readonly abortSessionCalls: URI[] = [];
	readonly respondToPermissionCalls: { requestId: string; approved: boolean }[] = [];
	readonly changeModelCalls: { session: URI; model: ModelSelection; chat?: URI }[] = [];
	readonly changeAgentCalls: { session: URI; agent: AgentSelection | undefined; chat?: URI }[] = [];
	readonly authenticateCalls: { resource: string; token: string }[] = [];
	readonly setClientCustomizationsCalls: { clientId: string; customizations: ClientPluginCustomization[] }[] = [];
	readonly setClientToolsCalls: { clientId: string; tools: readonly ToolDefinition[] }[] = [];
	readonly removeActiveClientCalls: { chat: URI; clientId: string }[] = [];
	readonly modelCallTurnCorrelationCalls: { chat: URI; modelCallId: string; turnId: string }[] = [];
	readonly chatContexts: { boundary: string; chat: URI; context: IAgentChatContext | URI | undefined }[] = [];
	readonly activeClientCalls: { chat: URI; context: URI | IAgentChatContext; clientId: string; hostCustomizations: readonly Customization[] | undefined }[] = [];
	readonly sessionCustomizationsCalls: { session: URI; hostCustomizations: readonly Customization[] | undefined }[] = [];
	readonly clientToolCallCompleteCalls: { chat: URI; toolCallId: string; result: ToolCallResult; context?: IAgentChatContext }[] = [];
	readonly truncateChatCalls: { chat: URI; turnId: string | undefined; context: URI | IAgentChatContext | undefined }[] = [];
	customizations: Customization[] = [];
	private readonly _onDidCustomizationsChange = new Emitter<void>();
	readonly onDidCustomizationsChange = this._onDidCustomizationsChange.event;
	getSessionCustomizations?: (session: URI, hostCustomizations?: readonly Customization[]) => Promise<readonly Customization[]>;
	getChatCustomizations = async (_chat: URI, context: URI | IAgentChatContext, hostCustomizations?: readonly Customization[]): Promise<readonly Customization[]> => {
		const configurationResource = URI.isUri(context) ? context : context.configurationResource;
		this.sessionCustomizationsCalls.push({ session: configurationResource, hostCustomizations });
		return this.getSessionCustomizations?.(configurationResource, hostCustomizations) ?? this.customizations;
	};

	sessionMessages: IHistoryRecord[] = [];
	turnUsageOverride: UsageInfo | undefined = undefined;
	chatModel: ModelSelection | undefined;

	sessionMetadataOverrides: Partial<Omit<IAgentSessionMetadata, 'session'>> = {};

	constructor(
		readonly id: AgentProvider = 'mock',
		private readonly _capabilities: IAgentCapabilities = { multipleChats: { fork: true } },
		readonly agentHostCapabilities: IAgent['agentHostCapabilities'] = { workspaceConversion: false },
	) {
		queueMicrotask(() => {
			void this.listExternalChats().then(chats => {
				if (chats) {
					this.fireDiscoveredChats(chats.map(metadata => ({ ...metadata, external: true })));
				}
			}, () => { });
		});
	}

	setAuthenticationRequired(requirement: Omit<AuthRequiredParams, 'channel'> | undefined): void {
		this._authenticationRequired.set(requirement, undefined);
	}

	getDescriptor(): IAgentDescriptor {
		return { provider: this.id, displayName: `Agent ${this.id}`, description: `Test ${this.id} agent`, capabilities: this._capabilities };
	}

	async setWorkingDirectory(_chat: URI, _context: URI | IAgentChatContext, _workingDirectory: URI): Promise<void> {
		throw new Error(`Agent '${this.id}' does not support changing the working directory of an existing session.`);
	}

	getProtectedResources(): ProtectedResourceMetadata[] {
		if (this.id === 'copilot') {
			return [{ resource: 'https://api.github.com', authorization_servers: ['https://github.com/login/oauth'], required: true }];
		}
		return [];
	}

	setModels(models: readonly IAgentModelInfo[]): void {
		this._models.set(models, undefined);
	}

	async listExternalChats(): Promise<IAgentChatMetadata[]> {
		return [...this._sessions.values()].map(session => ({ chat: URI.parse(buildDefaultChatUri(session)), startTime: Date.now(), modifiedTime: Date.now(), project: mockProject(this.id), ...this.sessionMetadataOverrides }));
	}

	fireDiscoveredChats(chats: readonly IAgentDiscoveredChat[]): void {
		this._discoveredChatsEmitter.fire(chats);
	}

	async listChatsToMigrate(): Promise<AgentChatMigrationResult> {
		return [];
	}

	async listSessions(): Promise<IAgentSessionMetadata[]> {
		return [...this._sessions.values()].map(session => ({ session, startTime: Date.now(), modifiedTime: Date.now(), project: mockProject(this.id), ...this.sessionMetadataOverrides }));
	}

	async getChatMetadata(chat: URI, context: URI | IAgentChatContext): Promise<IAgentChatMetadata | undefined> {
		const session = resolveAgentChatContext(context, chat).configurationResource;
		if (!this._sessions.has(AgentSession.id(session))) {
			return undefined;
		}
		return { chat, startTime: Date.now(), modifiedTime: Date.now(), project: mockProject(this.id), ...this.sessionMetadataOverrides };
	}

	async getSessionMetadata(session: URI): Promise<IAgentSessionMetadata | undefined> {
		return this._sessions.has(AgentSession.id(session))
			? { session, startTime: Date.now(), modifiedTime: Date.now(), project: mockProject(this.id), ...this.sessionMetadataOverrides }
			: undefined;
	}

	resolvedWorkingDirectory: URI | undefined;

	sendMessageError: Error | undefined;
	lastCreateSessionConfig: IAgentCreateSessionConfig | undefined;

	private _createSessionRecord(session: URI, config: IAgentCreateSessionConfig | undefined): IAgentCreateChatResult {
		this.lastCreateSessionConfig = config;
		this._sessions.set(AgentSession.id(session), session);
		return { project: mockProject(this.id), resolvedWorkingDirectory: this.resolvedWorkingDirectory };
	}

	async resolveChatConfig(params: IAgentResolveChatConfigParams): Promise<ResolveSessionConfigResult> {
		return { schema: { type: 'object', properties: {} }, values: params.config ?? {} };
	}
	resolveSessionConfig(params: IAgentResolveChatConfigParams): Promise<ResolveSessionConfigResult> {
		return this.resolveChatConfig(params);
	}

	getInheritedChatConfig(): undefined {
		return undefined;
	}

	async chatConfigCompletions(_params: IAgentChatConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		return { items: [] };
	}
	sessionConfigCompletions(params: IAgentChatConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		return this.chatConfigCompletions(params);
	}

	async sendMessage(session: URI, chat: URI, prompt: string, attachments?: readonly MessageAttachment[], turnId?: string, senderClientId?: string, clientType = AgentHostClientType.Unknown): Promise<void> {
		const call = {
			session,
			prompt,
			attachments,
			chat,
			...(senderClientId ? { senderClientId } : {}),
			...(clientType !== AgentHostClientType.Unknown ? { clientType } : {}),
		};
		this.sendMessageCalls.push(call);
		this._onDidSendMessage.fire(call);
		if (turnId) {
			this._activeTurnIds.set(uriKey(session), turnId);
		}
		if (this.sendMessageError) {
			throw this.sendMessageError;
		}
	}

	setPendingMessages(chat: URI, steeringMessage: PendingMessage | undefined, queuedMessages: readonly PendingMessage[]): void {
		this.setPendingMessagesCalls.push({ chat, steeringMessage, queuedMessages });
	}

	async getSessionMessages(session: URI): Promise<readonly Turn[]> {
		const subagentInfo = parseSubagentSessionUri(session);
		if (subagentInfo) {
			return buildSubagentTurnsFromHistory(this.sessionMessages, subagentInfo.toolCallId, session.toString());
		}
		const turns = buildTurnsFromHistory(this.sessionMessages);
		if (this.turnUsageOverride) {
			return turns.map(turn => ({ ...turn, usage: this.turnUsageOverride }));
		}
		return turns;
	}

	private _releaseSessionRecord(session: URI): void {
		this.releaseSessionCalls.push(session);
	}

	async abortSession(session: URI): Promise<void> {
		this.abortSessionCalls.push(session);
	}

	async finalizeSession(session: URI, _context?: { readonly workspaceless?: boolean }): Promise<void> {
		this.disposeSessionCalls.push(session);
		this._sessions.delete(AgentSession.id(session));
	}

	async truncateChat(chat: URI, turnId?: string, context?: URI | IAgentChatContext): Promise<void> {
		this.truncateChatCalls.push({ chat, turnId, context });
	}

	respondToPermissionRequest(requestId: string, approved: boolean): void {
		this.respondToPermissionCalls.push({ requestId, approved });
	}

	respondToUserInputRequest(): void {
	}

	async changeModel(session: URI, model: ModelSelection, chat?: URI): Promise<void> {
		this.changeModelCalls.push({ session, model, chat });
	}

	async changeAgent(session: URI, agent: AgentSelection | undefined, chat?: URI): Promise<void> {
		this.changeAgentCalls.push({ session, agent, chat });
	}

	async createChat(_session: URI, _chat: URI, _options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult | void> {
		throw new Error(`Agent ${this.id} does not support multiple chats`);
	}

	async disposeChat(_session: URI, _chat: URI): Promise<void> { }

	private _resolveChatTarget(chat: URI, context?: URI | IAgentChatContext): { session: URI; chat: URI } {
		if (context) {
			return { session: resolveAgentChatContext(context, chat).configurationResource, chat };
		}
		const parsed = parseChatUri(chat);
		if (!parsed) {
			throw new Error(`Mock agent chat operation requires an AHP chat URI: ${chat.toString()}`);
		}
		return { session: URI.parse(parsed.session), chat: URI.parse(chat.toString()) };
	}

	private _recordContext(boundary: string, chat: URI, context: URI | IAgentChatContext | undefined): void {
		this.chatContexts.push({ boundary, chat, context });
	}

	readonly chats: IAgentChats = {
		createChat: (chatUri: URI, context: URI | IAgentChatContext, options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult | void> => {
			this._recordContext('createChat', chatUri, context);
			const session = resolveAgentChatContext(context, chatUri).configurationResource;
			if (!this._sessions.has(AgentSession.id(session)) || this._initialChats.has(chatUri.toString())) {
				this._initialChats.add(chatUri.toString());
				return Promise.resolve(this._createSessionRecord(session, {
					session,
					model: options?.model,
					agent: options?.agent,
					workingDirectories: options?.workingDirectories,
					config: options?.config,
					activeClient: options?.activeClient,
					importConversation: options?.importConversation,
				}));
			}
			return this.createChat(session, chatUri, options);
		},
		disposeChat: (chatUri: URI, context: URI | IAgentChatContext): Promise<void> => {
			this._recordContext('disposeChat', chatUri, context);
			const { session, chat } = this._resolveChatTarget(chatUri, context);
			return this.disposeChat(session, chat).then(() => {
				if (this._initialChats.delete(chatUri.toString())) {
					this.disposeSessionCalls.push(session);
					this._sessions.delete(AgentSession.id(session));
				}
			});
		},
		releaseChat: (chatUri: URI, context: URI | IAgentChatContext): Promise<void> => {
			this._recordContext('releaseChat', chatUri, context);
			const { session } = this._resolveChatTarget(chatUri, context);
			this._releaseSessionRecord(session);
			return Promise.resolve();
		},
		sendMessage: (chatUri: URI, prompt: string, _workingDirectoriesOrDirectory: readonly URI[] | URI | undefined, attachments?: readonly MessageAttachment[], turnId?: string, senderClientId?: string, clientTypeOrContext?: AgentHostClientType | URI | IAgentChatContext, context?: URI | IAgentChatContext): Promise<void> => {
			const clientType = typeof clientTypeOrContext === 'string' ? clientTypeOrContext : AgentHostClientType.Unknown;
			const operationContext = context ?? (typeof clientTypeOrContext === 'string' ? undefined : clientTypeOrContext);
			this._recordContext('sendMessage', chatUri, operationContext);
			const { session, chat } = this._resolveChatTarget(chatUri, operationContext);
			return this.sendMessage(session, chat, prompt, attachments, turnId, senderClientId, clientType);
		},
		abort: (chat: URI, context: URI | IAgentChatContext): Promise<void> => {
			this._recordContext('abort', chat, context);
			const { session } = this._resolveChatTarget(chat, context);
			return this.abortSession(session);
		},
		getModel: (): ModelSelection | undefined => this.chatModel,
		changeModel: (chatUri: URI, model: ModelSelection, context: URI | IAgentChatContext): Promise<void> => {
			this._recordContext('changeModel', chatUri, context);
			const { session, chat } = this._resolveChatTarget(chatUri, context);
			return this.changeModel(session, model, chat);
		},
		changeAgent: (chatUri: URI, agent: AgentSelection | undefined, context: URI | IAgentChatContext): Promise<void> => {
			this._recordContext('changeAgent', chatUri, context);
			const { session, chat } = this._resolveChatTarget(chatUri, context);
			return this.changeAgent(session, agent, chat);
		},
		getMessages: (chat: URI, context: URI | IAgentChatContext): Promise<readonly Turn[]> => {
			this._recordContext('getMessages', chat, context);
			return this.getSessionMessages(chat);
		},
	};

	async materializeChat(_chat: URI, _context: URI | IAgentChatContext, _providerData: string | undefined): Promise<IAgentCreateChatResult | void> { }

	async authenticate(resource: string, token: string): Promise<boolean> {
		this.authenticateCalls.push({ resource, token });
		return true;
	}

	getCustomizations(): Customization[] {
		return this.customizations;
	}

	syncClientCustomizations(session: URI, clientId: string, customizations: ClientPluginCustomization[]): ISyncedCustomization[] {
		this.setClientCustomizationsCalls.push({ clientId, customizations });
		const results: ISyncedCustomization[] = customizations.map(c => ({
			customization: {
				...c,
				load: { kind: CustomizationLoadStatus.Loaded },
			},
		}));
		this._onDidChatProgress.fire({
			kind: 'action',
			resource: session,
			action: {
				type: ActionType.SessionCustomizationsChanged,
				customizations: results.map(result => result.customization),
			},
		});
		return results;
	}

	getOrCreateActiveClient(chat: URI, context: URI | IAgentChatContext, client: { readonly clientId: string; readonly displayName?: string }, hostCustomizations?: readonly Customization[]): IActiveClient {
		const self = this;
		this.activeClientCalls.push({ chat, context, clientId: client.clientId, hostCustomizations });
		let tools: readonly ToolDefinition[] = [];
		let customizations: readonly ClientPluginCustomization[] = [];
		return {
			clientId: client.clientId,
			displayName: client.displayName,
			get tools() { return tools; },
			set tools(value: readonly ToolDefinition[]) {
				tools = value;
				self.setClientToolsCalls.push({ clientId: client.clientId, tools: value });
			},
			get customizations() { return customizations; },
			set customizations(value: readonly ClientPluginCustomization[]) {
				customizations = value;
				self.syncClientCustomizations(resolveAgentChatContext(context, chat).configurationResource, client.clientId, [...value]);
			},
		};
	}

	removeActiveClient(chat: URI, _context: URI | IAgentChatContext, clientId: string): void {
		this.removeActiveClientCalls.push({ chat, clientId });
	}

	onClientToolCallComplete(chat: URI, toolCallId: string, result: ToolCallResult, context?: IAgentChatContext): void {
		this.clientToolCallCompleteCalls.push({ chat, toolCallId, result, context });
	}

	async shutdown(): Promise<void> { }

	fireProgress(signal: AgentSignal): void {
		this._onDidChatProgress.fire(signal);
	}

	getActiveTurnId(session: URI): string | undefined {
		return this._activeTurnIds.get(uriKey(session));
	}

	fireCustomizationsChange(): void {
		this._onDidCustomizationsChange.fire();
	}

	dispose(): void {
		this._discoveredChatsEmitter.dispose();
		this._onDidChatProgress.dispose();
		this._onDidSendMessage.dispose();
		this._onDidCustomizationsChange.dispose();
	}
}

export const PRE_EXISTING_SESSION_URI = AgentSession.uri('mock', 'pre-existing-session');

export class ScriptedMockAgent implements IAgent {
	private readonly _discoveredChatsEmitter = new Emitter<readonly IAgentDiscoveredChat[]>();
	readonly onDidDiscoverChats = this._discoveredChatsEmitter.event;
	readonly id: AgentProvider = 'mock';
	readonly agentHostCapabilities = { workspaceConversion: false } as const;

	private readonly _onDidChatProgress = new Emitter<AgentSignal>();
	readonly onDidChatProgress = this._onDidChatProgress.event;
	readonly onDidMaterializeChat = Event.None;
	readonly onDidChangeChatData = Event.None;
	readonly onDidSpawnChat = Event.None;
	private readonly _models = observableValue<readonly IAgentModelInfo[]>(this, [{ provider: 'mock', id: 'mock-model', name: 'Mock Model', maxContextWindow: 128000, supportsVision: false }]);
	readonly models = this._models;

	private readonly _sessions = new Map<string, URI>();

	private readonly _preExistingMessages: IHistoryRecord[] = [
		{ type: 'message', role: 'user', session: PRE_EXISTING_SESSION_URI, messageId: 'h-msg-1', content: 'What files are here?' },
		{ type: 'tool_start', session: PRE_EXISTING_SESSION_URI, toolCallId: 'h-tc-1', toolName: 'list_files', displayName: 'List Files', invocationMessage: 'Listing files...' },
		{ type: 'tool_complete', session: PRE_EXISTING_SESSION_URI, toolCallId: 'h-tc-1', result: { pastTenseMessage: 'Listed files', content: [{ type: ToolResultContentType.Text, text: 'file1.ts\nfile2.ts' }], success: true } satisfies ToolCallResult },
		{ type: 'message', role: 'assistant', session: PRE_EXISTING_SESSION_URI, messageId: 'h-msg-2', content: 'Here are the files: file1.ts and file2.ts' },
	];

	private readonly _pendingPermissions = new Map<string, (approved: boolean) => void>();
	private readonly _activeTurnIds = new Map<string, string>();
	private readonly _pendingAborts = new Map<string, () => void>();

	constructor() {
		this._sessions.set(AgentSession.id(PRE_EXISTING_SESSION_URI), PRE_EXISTING_SESSION_URI);
		queueMicrotask(() => {
			void this.listExternalChats().then(chats => {
				if (chats) {
					this.fireDiscoveredChats(chats.map(metadata => ({ ...metadata, external: true })));
				}
			}, () => { });
		});

		const seeded = process.env['VSCODE_AGENT_HOST_MOCK_SEED_SESSIONS'];
		if (seeded) {
			for (const raw of seeded.split(',')) {
				const trimmed = raw.trim();
				if (!trimmed) {
					continue;
				}
				const uri = URI.parse(trimmed);
				this._sessions.set(AgentSession.id(uri), uri);
			}
		}
	}

	getDescriptor(): IAgentDescriptor {
		return { provider: 'mock', displayName: 'Mock Agent', description: 'Scripted test agent' };
	}

	async setWorkingDirectory(_chat: URI, _context: URI | IAgentChatContext, _workingDirectory: URI): Promise<void> {
		throw new Error('The scripted mock agent does not support changing the working directory of an existing session.');
	}

	getProtectedResources(): IAuthorizationProtectedResourceMetadata[] {
		return [];
	}

	async listExternalChats(): Promise<IAgentChatMetadata[]> {
		return [...this._sessions.values()].map(session => ({
			chat: URI.parse(buildDefaultChatUri(session)),
			startTime: Date.now(),
			modifiedTime: Date.now(),
			project: mockProject(this.id),
			summary: session.toString() === PRE_EXISTING_SESSION_URI.toString() ? 'Pre-existing session' : undefined,
		}));
	}

	fireDiscoveredChats(chats: readonly IAgentDiscoveredChat[]): void {
		this._discoveredChatsEmitter.fire(chats);
	}

	async listChatsToMigrate(): Promise<AgentChatMigrationResult> {
		return [];
	}

	async listSessions(): Promise<IAgentSessionMetadata[]> {
		return [...this._sessions.values()].map(session => ({
			session,
			startTime: Date.now(),
			modifiedTime: Date.now(),
			project: mockProject(this.id),
			summary: session.toString() === PRE_EXISTING_SESSION_URI.toString() ? 'Pre-existing session' : undefined,
		}));
	}

	async getChatMetadata(chat: URI, context: URI | IAgentChatContext): Promise<IAgentChatMetadata | undefined> {
		const session = resolveAgentChatContext(context, chat).configurationResource;
		if (!this._sessions.has(AgentSession.id(session))) {
			return undefined;
		}

		return {
			chat,
			startTime: Date.now(),
			modifiedTime: Date.now(),
			project: mockProject(this.id),
			summary: session.toString() === PRE_EXISTING_SESSION_URI.toString() ? 'Pre-existing session' : undefined,
		};
	}

	async getSessionMetadata(session: URI): Promise<IAgentSessionMetadata | undefined> {
		return this._sessions.has(AgentSession.id(session))
			? { session, startTime: Date.now(), modifiedTime: Date.now(), project: mockProject(this.id), summary: session.toString() === PRE_EXISTING_SESSION_URI.toString() ? 'Pre-existing session' : undefined }
			: undefined;
	}

	private _createSessionRecord(session: URI): IAgentCreateChatResult {
		this._sessions.set(AgentSession.id(session), session);
		return { project: mockProject(this.id) };
	}

	async resolveChatConfig(params: IAgentResolveChatConfigParams): Promise<ResolveSessionConfigResult> {
		const mode = params.config?.mockMode === 'direct' || params.config?.mockMode === 'managed' ? params.config.mockMode : 'managed';
		const branch = mode === 'managed' && typeof params.config?.mockBranch === 'string' ? params.config.mockBranch : 'main';
		return {
			schema: {
				type: 'object',
				properties: {
					mockMode: {
						type: 'string',
						title: 'Mock Mode',
						description: 'How the mock agent should operate',
						enum: ['direct', 'managed'],
						enumLabels: ['Direct', 'Managed'],
						default: 'managed',
					},
					mockBranch: {
						type: 'string',
						title: 'Mock Branch',
						description: 'Mock branch to work from',
						enum: ['main'],
						enumLabels: ['main'],
						default: 'main',
						enumDynamic: mode === 'managed',
						readOnly: mode === 'direct',
					},
				},
			},
			values: { mockMode: mode, mockBranch: branch },
		};
	}
	resolveSessionConfig(params: IAgentResolveChatConfigParams): Promise<ResolveSessionConfigResult> {
		return this.resolveChatConfig(params);
	}

	getInheritedChatConfig(): undefined {
		return undefined;
	}

	async chatConfigCompletions(params: IAgentChatConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		if (params.property !== 'mockBranch') {
			return { items: [] };
		}
		const query = params.query?.toLowerCase() ?? '';
		const branches = ['main', 'feature/config', 'release'].filter(branch => branch.toLowerCase().includes(query));
		return { items: branches.map(branch => ({ value: branch, label: branch })) };
	}
	sessionConfigCompletions(params: IAgentChatConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		return this.chatConfigCompletions(params);
	}

	async sendMessage(session: URI, chat: URI, prompt: string, _attachments?: readonly MessageAttachment[], turnId?: string): Promise<void> {
		if (turnId) {
			this._activeTurnIds.set(uriKey(session), turnId);
			this._activeTurnIds.set(uriKey(chat), turnId);
		}
		const { sessionStr, turnId: tid } = this._ctx(chat);
		switch (prompt) {
			case 'hello':
				this._fireSequence([
					_markdown(chat, sessionStr, tid, 'Hello, world!'),
					_idle(chat, sessionStr, tid),
				]);
				break;

			case 'use-tool':
				this._fireSequence([
					..._toolStart(chat, sessionStr, tid, 'tc-1', 'echo_tool', 'Echo Tool', 'Running echo tool...'),
					_toolComplete(chat, sessionStr, tid, 'tc-1', { pastTenseMessage: 'Ran echo tool', content: [{ type: ToolResultContentType.Text, text: 'echoed' }], success: true }),
					_markdown(chat, sessionStr, tid, 'Tool done.'),
					_idle(chat, sessionStr, tid),
				]);
				break;

			case 'error':
				this._fireSequence([
					_error(chat, sessionStr, tid, 'test_error', 'Something went wrong'),
				]);
				break;

			case 'permission': {
				(async () => {
					await timeout(10);
					for (const s of _toolStart(chat, sessionStr, tid, 'tc-perm-1', 'shell', 'Shell', 'Run a test command')) {
						this._onDidChatProgress.fire(s);
					}
					await timeout(5);
					this._onDidChatProgress.fire(_pendingConfirmation(chat, 'tc-perm-1', 'Run a test command', { toolInput: 'echo test', confirmationTitle: 'Run a test command' }));
				})();
				this._pendingPermissions.set('tc-perm-1', (approved) => {
					if (approved) {
						this._fireSequence([
							_markdown(chat, sessionStr, tid, 'Allowed.'),
							_idle(chat, sessionStr, tid),
						]);
					}
				});
				break;
			}

			case 'write-file': {
				(async () => {
					await timeout(10);
					for (const s of _toolStart(chat, sessionStr, tid, 'tc-write-1', 'create', 'Create File', 'Create file')) {
						this._onDidChatProgress.fire(s);
					}
					await timeout(5);
					this._onDidChatProgress.fire(_pendingConfirmation(chat, 'tc-write-1', 'Write src/app.ts', { permissionKind: 'write', permissionPath: mockWorkspacePath('src/app.ts') }));
					await timeout(10);
					this._fireSequence([
						_toolComplete(chat, sessionStr, tid, 'tc-write-1', { pastTenseMessage: 'Wrote file', content: [{ type: ToolResultContentType.Text, text: 'ok' }], success: true }),
						_idle(chat, sessionStr, tid),
					]);
				})();
				break;
			}

			case 'write-env': {
				(async () => {
					await timeout(10);
					for (const s of _toolStart(chat, sessionStr, tid, 'tc-write-env-1', 'create', 'Create File', 'Create file')) {
						this._onDidChatProgress.fire(s);
					}
					await timeout(5);
					this._onDidChatProgress.fire(_pendingConfirmation(chat, 'tc-write-env-1', 'Write .env', { permissionKind: 'write', permissionPath: mockWorkspacePath('.env'), confirmationTitle: 'Write .env' }));
				})();
				this._pendingPermissions.set('tc-write-env-1', (approved) => {
					if (approved) {
						this._fireSequence([
							_toolComplete(chat, sessionStr, tid, 'tc-write-env-1', { pastTenseMessage: 'Wrote .env', content: [{ type: ToolResultContentType.Text, text: 'ok' }], success: true }),
							_idle(chat, sessionStr, tid),
						]);
					}
				});
				break;
			}

			case 'run-safe-command': {
				(async () => {
					await timeout(10);
					for (const s of _toolStart(chat, sessionStr, tid, 'tc-shell-1', 'bash', 'Run Command', 'Run command')) {
						this._onDidChatProgress.fire(s);
					}
					await timeout(5);
					this._onDidChatProgress.fire(_pendingConfirmation(chat, 'tc-shell-1', 'ls -la', { permissionKind: 'shell', toolInput: 'ls -la' }));
					await timeout(10);
					this._fireSequence([
						_toolComplete(chat, sessionStr, tid, 'tc-shell-1', { pastTenseMessage: 'Ran command', content: [{ type: ToolResultContentType.Text, text: 'file1.ts\nfile2.ts' }], success: true }),
						_idle(chat, sessionStr, tid),
					]);
				})();
				break;
			}

			case 'run-dangerous-command': {
				(async () => {
					await timeout(10);
					for (const s of _toolStart(chat, sessionStr, tid, 'tc-shell-deny-1', 'bash', 'Run Command', 'Run command')) {
						this._onDidChatProgress.fire(s);
					}
					await timeout(5);
					this._onDidChatProgress.fire(_pendingConfirmation(chat, 'tc-shell-deny-1', 'rm -rf /', { permissionKind: 'shell', toolInput: 'rm -rf /', confirmationTitle: 'Run in terminal' }));
				})();
				this._pendingPermissions.set('tc-shell-deny-1', (approved) => {
					if (approved) {
						this._fireSequence([
							_toolComplete(chat, sessionStr, tid, 'tc-shell-deny-1', { pastTenseMessage: 'Ran command', content: [{ type: ToolResultContentType.Text, text: '' }], success: true }),
							_idle(chat, sessionStr, tid),
						]);
					}
				});
				break;
			}

			case 'orphan-confirmation': {
				(async () => {
					await timeout(10);
					for (const s of _toolStart(chat, sessionStr, tid, 'tc-orphan-initial', 'bash', 'Run Command', 'Run command')) {
						this._onDidChatProgress.fire(s);
					}
					await timeout(5);
					this._onDidChatProgress.fire(_toolComplete(chat, sessionStr, tid, 'tc-orphan-initial', { pastTenseMessage: 'Ran command', content: [{ type: ToolResultContentType.Text, text: 'ok' }], success: true }));
					await timeout(5);
					this._onDidChatProgress.fire(_idle(chat, sessionStr, tid));

					await timeout(10);
					for (const s of _toolStart(chat, sessionStr, '', 'tc-orphan', 'view', 'Read', 'Read file')) {
						this._onDidChatProgress.fire(s);
					}
					await timeout(5);
					this._onDidChatProgress.fire(_pendingConfirmation(chat, 'tc-orphan', 'Read file', { permissionKind: 'read', permissionPath: mockWorkspacePath('file.ts') }));
				})();
				this._pendingPermissions.set('tc-orphan', (approved) => {
					if (approved) {
						this._fireSequence([
							_toolComplete(chat, sessionStr, tid, 'tc-orphan', { pastTenseMessage: 'Read file', content: [{ type: ToolResultContentType.Text, text: 'contents' }], success: true }),
							_markdown(chat, sessionStr, tid, 'continued-after-hook'),
							_idle(chat, sessionStr, tid),
						]);
					}
				});
				break;
			}

			case 'with-usage':
				this._fireSequence([
					_markdown(chat, sessionStr, tid, 'Usage response.'),
					_usage(chat, sessionStr, tid, { inputTokens: 100, outputTokens: 50, model: 'mock-model', _meta: { cost: 0.5 } }),
					_idle(chat, sessionStr, tid),
				]);
				break;

			case 'with-reasoning': {
				const initialReasoning = _reasoning(chat, sessionStr, tid, 'Let me think');
				const partId = initialReasoning.action.type === ActionType.ChatResponsePart
					&& hasKey(initialReasoning.action.part, { id: true })
					? initialReasoning.action.part.id
					: '';
				this._fireSequence([
					initialReasoning,
					_action(chat, {
						type: ActionType.ChatReasoning,
						turnId: tid,
						partId,
						content: ' about this...',
					}),
					_markdown(chat, sessionStr, tid, 'Reasoned response.'),
					_idle(chat, sessionStr, tid),
				]);
				break;
			}

			case 'with-title':
				this._fireSequence([
					_markdown(chat, sessionStr, tid, 'Title response.'),
					_titleChanged(session, sessionStr, MOCK_AUTO_TITLE),
					_idle(chat, sessionStr, tid),
				]);
				break;

			case 'slow': {
				const timer = setTimeout(() => {
					const ctx = this._ctx(chat);
					this._fireSequence([
						_markdown(chat, ctx.sessionStr, ctx.turnId, 'Slow response.'),
						_idle(chat, ctx.sessionStr, ctx.turnId),
					]);
				}, 5000);
				this._pendingAborts.set(session.toString(), () => clearTimeout(timer));
				break;
			}

			case 'client-tool': {
				(async () => {
					await timeout(10);
					this._onDidChatProgress.fire(_action(chat, {
						type: ActionType.ChatToolCallStart,
						turnId: tid,
						toolCallId: 'tc-client-1',
						toolName: 'runTests',
						displayName: 'Run Tests',
						contributor: { kind: ToolCallContributorKind.Client, clientId: 'test-client-tool' },
					}));
					await timeout(5);
					this._onDidChatProgress.fire(_pendingConfirmation(chat, 'tc-client-1', 'Running tests...', { toolInput: '{}' }));
				})();
				this._pendingPermissions.set('tc-client-1', () => {
					this._fireSequence([
						_markdown(chat, sessionStr, tid, 'Client tool done.'),
						_idle(chat, sessionStr, tid),
					]);
				});
				break;
			}

			case 'client-tool-with-permission': {
				(async () => {
					await timeout(10);
					this._onDidChatProgress.fire(_action(chat, {
						type: ActionType.ChatToolCallStart,
						turnId: tid,
						toolCallId: 'tc-client-perm-1',
						toolName: 'runTests',
						displayName: 'Run Tests',
						contributor: { kind: ToolCallContributorKind.Client, clientId: 'test-client-tool' },
					}));
					await timeout(5);
					this._onDidChatProgress.fire(_pendingConfirmation(chat, 'tc-client-perm-1', 'Run tests on project', { confirmationTitle: 'Allow Run Tests?' }));
				})();
				this._pendingPermissions.set('tc-client-perm-1', (approved) => {
					if (approved) {
						this._fireSequence([
							_toolComplete(chat, sessionStr, tid, 'tc-client-perm-1', { pastTenseMessage: 'Ran tests', content: [{ type: ToolResultContentType.Text, text: 'all passed' }], success: true }),
							_markdown(chat, sessionStr, tid, 'Permission granted, tool done.'),
							_idle(chat, sessionStr, tid),
						]);
					}
				});
				break;
			}

			case 'subagent': {
				this._fireSequence([
					..._toolStart(chat, sessionStr, tid, 'tc-task-1', 'task', 'Task', 'Spawning subagent', { toolKind: 'subagent', subagentAgentName: 'explore', subagentDescription: 'Explore' }),
					{ kind: 'subagent_started', chat, toolCallId: 'tc-task-1', agentName: 'explore', agentDisplayName: 'Explore', agentDescription: 'Exploration helper' },
					..._toolStart(chat, sessionStr, tid, 'tc-inner-1', 'echo_tool', 'Echo Tool', 'Inner tool running...', { parentToolCallId: 'tc-task-1' }),
					_toolComplete(chat, sessionStr, tid, 'tc-inner-1', { pastTenseMessage: 'Ran inner tool', content: [{ type: ToolResultContentType.Text, text: 'inner-ok' }], success: true }, 'tc-task-1'),
					{ kind: 'subagent_completed', chat, toolCallId: 'tc-task-1' },
					_toolComplete(chat, sessionStr, tid, 'tc-task-1', { pastTenseMessage: 'Subagent done', content: [{ type: ToolResultContentType.Text, text: 'task-ok' }], success: true }),
					_markdown(chat, sessionStr, tid, 'Subagent finished.'),
					_idle(chat, sessionStr, tid),
				]);
				break;
			}

			default:
				if (prompt.startsWith('terminal-edit:')) {
					const filePath = prompt.slice('terminal-edit:'.length);
					void (async () => {
						for (const s of _toolStart(chat, sessionStr, tid, 'tc-term-edit-1', 'bash', 'Run Command', 'Edit file via shell')) {
							this._onDidChatProgress.fire(s);
						}
						const fs = await import('fs/promises');
						await fs.writeFile(filePath, 'edited-from-terminal\n');
						this._fireSequence([
							_toolComplete(chat, sessionStr, tid, 'tc-term-edit-1', { pastTenseMessage: 'Edited file', content: [{ type: ToolResultContentType.Text, text: 'ok' }], success: true }),
							_idle(chat, sessionStr, tid),
						]);
					})().catch(err => {
						this._fireSequence([
							_markdown(chat, sessionStr, tid, 'terminal-edit failed: ' + (err instanceof Error ? err.message : String(err))),
							_idle(chat, sessionStr, tid),
						]);
					});
					break;
				}
				this._fireSequence([
					_markdown(chat, sessionStr, tid, 'Unknown prompt: ' + prompt),
					_idle(chat, sessionStr, tid),
				]);
				break;
		}
	}

	setPendingMessages(chat: URI, steeringMessage: PendingMessage | undefined, _queuedMessages: readonly PendingMessage[]): void {
		if (steeringMessage) {
			timeout(20).then(() => {
				this._onDidChatProgress.fire({ kind: 'steering_consumed', chat: isAhpChatChannel(chat.toString()) ? chat : URI.parse(buildDefaultChatUri(chat)), id: steeringMessage.id });
			});
		}
	}

	getOrCreateActiveClient(_chat: URI, _context: URI | IAgentChatContext, client: { readonly clientId: string; readonly displayName?: string }, _hostCustomizations?: readonly Customization[]): IActiveClient {
		let tools: readonly ToolDefinition[] = [];
		let customizations: readonly ClientPluginCustomization[] = [];
		return {
			clientId: client.clientId,
			displayName: client.displayName,
			get tools() { return tools; },
			set tools(value: readonly ToolDefinition[]) { tools = value; },
			get customizations() { return customizations; },
			set customizations(value: readonly ClientPluginCustomization[]) { customizations = value; },
		};
	}

	removeActiveClient(): void { }

	private didCompleteToolCalls = new Set<string>();

	onClientToolCallComplete(chat: URI, toolCallId: string, result: ToolCallResult): void {
		const key = `${chat.toString()}:${toolCallId}`;
		if (this.didCompleteToolCalls.has(key)) {
			return;
		}
		this.didCompleteToolCalls.add(key);
		const { sessionStr, turnId } = this._ctx(chat);
		this._onDidChatProgress.fire(_toolComplete(chat, sessionStr, turnId, toolCallId, result));
		const callback = this._pendingPermissions.get(toolCallId);
		if (callback) {
			this._pendingPermissions.delete(toolCallId);
			callback(true);
		}
	}

	async getSessionMessages(session: URI): Promise<readonly Turn[]> {
		const subagentInfo = parseSubagentSessionUri(session);
		if (subagentInfo) {
			return buildSubagentTurnsFromHistory(this._preExistingMessages, subagentInfo.toolCallId, session.toString());
		}
		const parsed = parseChatUri(session);
		const normalized = parsed && isDefaultChatUri(session) ? URI.parse(parsed.session) : session;
		if (normalized.toString() === PRE_EXISTING_SESSION_URI.toString()) {
			return buildTurnsFromHistory(this._preExistingMessages);
		}
		return [];
	}

	async abortSession(session: URI): Promise<void> {
		const callback = this._pendingAborts.get(session.toString());
		if (callback) {
			this._pendingAborts.delete(session.toString());
			callback();
		}
	}

	async changeModel(_session: URI, _model: ModelSelection): Promise<void> {
	}

	private _resolveChatTarget(chat: URI, context?: URI | IAgentChatContext): { session: URI; chat: URI } {
		if (context) {
			return { session: resolveAgentChatContext(context, chat).configurationResource, chat };
		}
		const parsed = parseChatUri(chat);
		if (!parsed) {
			throw new Error(`Scripted mock chat operation requires an AHP chat URI: ${chat.toString()}`);
		}
		return { session: URI.parse(parsed.session), chat: URI.parse(chat.toString()) };
	}

	readonly chats: IAgentChats = {
		createChat: (chatUri: URI, context: URI | IAgentChatContext): Promise<IAgentCreateChatResult | void> => {
			const session = resolveAgentChatContext(context, chatUri).configurationResource;
			if (!this._sessions.has(AgentSession.id(session))) {
				return Promise.resolve(this._createSessionRecord(session));
			}
			throw new Error('Scripted mock agent does not support multiple chats');
		},
		disposeChat: (chat: URI, context: URI | IAgentChatContext): Promise<void> => {
			const { session } = this._resolveChatTarget(chat, context);
			this._sessions.delete(AgentSession.id(session));
			return Promise.resolve();
		},
		releaseChat: async (chat: URI, context: URI | IAgentChatContext): Promise<void> => {
			this._resolveChatTarget(chat, context);
		},
		sendMessage: (chatUri: URI, prompt: string, _workingDirectoriesOrDirectory: readonly URI[] | URI | undefined, attachments?: readonly MessageAttachment[], turnId?: string, _senderClientId?: string, clientTypeOrContext?: AgentHostClientType | URI | IAgentChatContext, context?: URI | IAgentChatContext): Promise<void> => {
			const operationContext = context ?? (typeof clientTypeOrContext === 'string' ? undefined : clientTypeOrContext);
			const { session, chat } = this._resolveChatTarget(chatUri, operationContext);
			return this.sendMessage(session, chat, prompt, attachments, turnId);
		},
		abort: (chat: URI, context: URI | IAgentChatContext): Promise<void> => {
			const { session } = this._resolveChatTarget(chat, context);
			return this.abortSession(session);
		},
		changeModel: (chat: URI, model: ModelSelection, context: URI | IAgentChatContext): Promise<void> => {
			const { session } = this._resolveChatTarget(chat, context);
			return this.changeModel(session, model);
		},
		changeAgent: (chat: URI, _agent: AgentSelection | undefined, context: URI | IAgentChatContext): Promise<void> => {
			resolveAgentChatContext(context, chat);
			return Promise.resolve();
		},
		getMessages: (chat: URI, context: URI | IAgentChatContext): Promise<readonly Turn[]> => {
			return this.getSessionMessages(this._resolveChatTarget(chat, context).session);
		},
	};

	async materializeChat(_chat: URI, _context: URI | IAgentChatContext, _providerData: string | undefined): Promise<IAgentCreateChatResult | void> { }

	async finalizeSession(session: URI, _context?: { readonly workspaceless?: boolean }): Promise<void> {
		this._sessions.delete(AgentSession.id(session));
	}

	async getChatCustomizations(): Promise<readonly Customization[]> {
		return [];
	}

	async truncateChat(_chat: URI, _turnId?: string, _context?: URI | IAgentChatContext): Promise<void> {
	}

	respondToPermissionRequest(toolCallId: string, approved: boolean): void {
		const callback = this._pendingPermissions.get(toolCallId);
		if (callback) {
			this._pendingPermissions.delete(toolCallId);
			callback(approved);
		}
	}

	respondToUserInputRequest(): void {
	}

	async authenticate(_resource: string, _token: string): Promise<boolean> {
		return true;
	}

	async shutdown(): Promise<void> { }

	dispose(): void {
		this._discoveredChatsEmitter.dispose();
		this._onDidChatProgress.dispose();
	}

	private _fireSequence(signals: AgentSignal[]): void {
		let delay = 0;
		for (const signal of signals) {
			delay += 10;
			setTimeout(() => this._onDidChatProgress.fire(signal), delay);
		}
	}

	private _ctx(session: URI): { sessionStr: string; turnId: string } {
		return {
			sessionStr: session.toString(),
			turnId: this._activeTurnIds.get(uriKey(session)) ?? 'mock-turn',
		};
	}
}



let _mockPartIdCounter = 0;

function _action(session: URI, action: import('../../common/state/sessionActions.js').SessionAction | import('../../common/state/sessionActions.js').ChatAction, parentToolCallId?: string): IAgentActionSignal {
	return { kind: 'action', resource: session, action, parentToolCallId };
}

function _markdown(session: URI, sessionStr: string, turnId: string, content: string, parentToolCallId?: string): IAgentActionSignal {
	return _action(session, {
		type: ActionType.ChatResponsePart,
		turnId,
		part: { kind: ResponsePartKind.Markdown, id: `mock-md-${++_mockPartIdCounter}`, content },
	}, parentToolCallId);
}

function _reasoning(session: URI, sessionStr: string, turnId: string, content: string): IAgentActionSignal {
	return _action(session, {
		type: ActionType.ChatResponsePart,
		turnId,
		part: { kind: ResponsePartKind.Reasoning, id: `mock-rs-${++_mockPartIdCounter}`, content },
	});
}

function _idle(session: URI, sessionStr: string, turnId: string): IAgentActionSignal {
	return _action(session, { type: ActionType.ChatTurnComplete, turnId, duration: 1 });
}

function _error(session: URI, sessionStr: string, turnId: string, errorType: string, message: string, stack?: string): IAgentActionSignal {
	return _action(session, { type: ActionType.ChatError, turnId, duration: 1, part: createErrorResponsePart({ errorType, message, stack }) });
}

function _titleChanged(session: URI, sessionStr: string, title: string): IAgentActionSignal {
	return _action(session, { type: ActionType.SessionTitleChanged, title });
}

function _usage(session: URI, sessionStr: string, turnId: string, usage: UsageInfo): IAgentActionSignal {
	return _action(session, { type: ActionType.ChatUsage, turnId, usage });
}

function _toolStart(session: URI, sessionStr: string, turnId: string, toolCallId: string, toolName: string, displayName: string, invocationMessage: StringOrMarkdown, opts?: {
	toolInput?: string;
	toolKind?: string;
	toolClientId?: string;
	subagentAgentName?: string;
	subagentDescription?: string;
	parentToolCallId?: string;
}): IAgentActionSignal[] {
	const meta: Record<string, unknown> = {};
	if (opts?.toolKind) {
		meta.toolKind = opts.toolKind;
	}
	if (opts?.subagentAgentName) {
		meta.subagentAgentName = opts.subagentAgentName;
	}
	if (opts?.subagentDescription) {
		meta.subagentDescription = opts.subagentDescription;
	}
	const signals: IAgentActionSignal[] = [_action(session, {
		type: ActionType.ChatToolCallStart,
		turnId,
		toolCallId,
		toolName,
		displayName,
		contributor: opts?.toolClientId ? { kind: ToolCallContributorKind.Client, clientId: opts.toolClientId } : undefined,
		_meta: Object.keys(meta).length ? meta : undefined,
	}, opts?.parentToolCallId)];
	if (!opts?.toolClientId) {
		signals.push(_action(session, {
			type: ActionType.ChatToolCallReady,
			turnId,
			toolCallId,
			invocationMessage,
			toolInput: opts?.toolInput,
			confirmed: ToolCallConfirmationReason.NotNeeded,
		}, opts?.parentToolCallId));
	}
	return signals;
}

function _toolComplete(session: URI, sessionStr: string, turnId: string, toolCallId: string, result: ToolCallResult, parentToolCallId?: string): IAgentActionSignal {
	return _action(session, { type: ActionType.ChatToolCallComplete, turnId, toolCallId, result }, parentToolCallId);
}

function _pendingConfirmation(session: URI, toolCallId: string, invocationMessage: StringOrMarkdown, opts?: {
	toolInput?: string;
	confirmationTitle?: StringOrMarkdown;
	permissionKind?: IAgentToolPendingConfirmationSignal['permissionKind'];
	permissionPath?: IAgentToolPendingConfirmationSignal['permissionPath'];
}): IAgentToolPendingConfirmationSignal {
	return {
		kind: 'pending_confirmation',
		chat: session,
		state: {
			status: ToolCallStatus.PendingConfirmation,
			toolCallId,
			toolName: '',
			displayName: '',
			invocationMessage,
			toolInput: opts?.toolInput,
			confirmationTitle: opts?.confirmationTitle,
		},
		permissionKind: opts?.permissionKind,
		permissionPath: opts?.permissionPath,
	};
}
