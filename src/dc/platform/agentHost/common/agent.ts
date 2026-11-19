/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { IChannelClient } from '../../../base/parts/ipc/common/ipc.js';
import { truncate } from '../../../base/common/strings.js';
import type { IObservable } from '../../../base/common/observable.js';
import { isEqual } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import type { IAgentServerToolHost } from './agentServerTools.js';
import type { AgentHostClientType } from './agentHostClientInfo.js';
import type { IAgentHostClientTelemetryContext } from './agentHostTelemetry.js';
import type { ResolveSessionConfigResult, SessionConfigCompletionsResult } from './state/protocol/commands.js';
import { ProtectedResourceMetadata, type Changeset, type ChatOrigin, type ConfigSchema, type MessageAttachment, type ModelSelection, type AgentSelection, type SessionActiveClient, type ToolCallPendingConfirmationState, type ToolDefinition, ChangesSummary } from './state/protocol/state.js';
import type { AuthRequiredParams, SessionAction, ChatAction } from './state/sessionActions.js';
import { ChatInputResponseKind, ChatOriginKind, SessionStatus, buildSubagentChatUri, parseRequiredSessionUriFromChatUri, type AgentCapabilities, type ClientPluginCustomization, type Customization, type ISessionFolderPickerDecision, type Message, type PendingMessage, type ChatInputAnswer, type SessionMeta, type ToolCallResult, type Turn, type PolicyState } from './state/sessionState.js';

export class AgentHostStartError extends Error {
	constructor(message: string, readonly fatal = false) {
		super(message);
	}
}

export class AgentWorkingDirectoryChangedError extends Error {
	constructor(
		readonly workingDirectory: URI,
		message: string,
	) {
		super(message);
	}
}

export function isInvalidUtilityProcessConfigurationMessage(message: string): boolean {
	return /^Invalid value for (?:args|env|execArgv)$/.test(message);
}

export function isFatalAgentHostStartError(error: unknown): error is TypeError {
	return error instanceof TypeError && isInvalidUtilityProcessConfigurationMessage(error.message);
}

export function toFatalAgentHostStartError(error: Error): AgentHostStartError {
	const startError = new AgentHostStartError(error.message, true);
	startError.name = error.name;
	startError.stack = error.stack;
	return startError;
}

export interface IAgentHostConnection {
	readonly client: IChannelClient;
	readonly store: DisposableStore;
	readonly onDidProcessExit: Event<{ code: number; signal: string }>;
	shutdown(): Promise<void>;
}

export interface IAgentHostStartRequest {
	waitUntil(promise: Promise<void>): void;
}

export interface IAgentHostShutdownRequest {
	join(promise: Promise<void>): void;
}

export interface IAgentHostStarter extends IDisposable {
	readonly onRequestConnection?: Event<IAgentHostStartRequest>;
	readonly onRequestRestart?: Event<void>;
	readonly onWillShutdown?: Event<IAgentHostShutdownRequest>;

	start(): Promise<IAgentHostConnection>;
}



export interface IAgentHostNetworkEndpoint {
	readonly name: string;
	readonly url: string;
	readonly expectedContent?: string;
	readonly expectedStatus?: number;
}

export interface IAgentHostManagedSettingsSnapshot {
	readonly account?: string;
	readonly source: 'server' | 'device' | 'client' | 'policyHelper' | 'mixed' | 'none';
	readonly serverManaged: boolean;
	readonly deviceManaged: boolean;
	readonly clientManaged?: boolean;
	readonly policyHelperManaged?: boolean;
	readonly failClosed: boolean;
	readonly bypassPermissionsDisabled: boolean;
	readonly permissionsAllowIntersected?: boolean;
	readonly sandboxEnabledByUndeterminedPolicy?: boolean;
	readonly managedKeys: readonly string[];
	readonly settings?: unknown;
}


export interface IAgentChatMetadata {
	readonly chat: URI;
	readonly startTime: number;
	readonly modifiedTime: number;
	readonly project?: IAgentSessionProjectInfo;
	readonly summary?: string;
	readonly model?: ModelSelection;
	readonly status?: SessionStatus;
	readonly activity?: string;
	readonly workingDirectories?: readonly URI[];
	readonly changes?: ChangesSummary;
	readonly changesets?: readonly Changeset[];
	readonly _meta?: SessionMeta;
}

export interface IAgentChatMetadataOptions {
	readonly activation?: 'restore';
	readonly registryFallback?: Pick<IAgentChatMetadata, 'startTime' | 'modifiedTime'>;
}

export interface IAgentDiscoveredChat extends IAgentChatMetadata {
	readonly external: boolean;
}

export type IAgentKnownSessionsFilter = (sessions: readonly URI[]) => Promise<ReadonlySet<string>>;

export interface IAgentSessionMetadata extends Omit<IAgentChatMetadata, 'chat'> {
	readonly session: URI;
}

export interface IAgentSessionProjectInfo {
	readonly uri: URI;
	readonly displayName: string;
}

export interface IAgentCreateSessionResult extends IAgentCreateChatResult {
	readonly session: URI;
	readonly project?: IAgentSessionProjectInfo;
	readonly chat?: IAgentCreateChatResult;
	readonly resolvedWorkingDirectory?: URI;
	readonly provisional?: boolean;
}

export interface IAgentMaterializeChatEvent {
	readonly chat: URI;
	readonly result?: IAgentCreateChatResult;
	readonly workingDirectories: readonly URI[] | undefined;
	readonly project: IAgentSessionProjectInfo | undefined;
}

export type AgentProvider = string;
export type AgentTurnProviderCallState = 'notStarted' | 'pending' | 'resolved' | 'rejected';
export type AgentTurnProviderSessionState = 'active' | 'disconnecting' | 'disconnected' | 'shutdown';

export type IAgentTurnDiagnosticSnapshot = {
	readonly state: 'available';
	readonly providerCallState: AgentTurnProviderCallState;
	readonly providerTurnStarted: boolean;
	readonly providerSessionState: AgentTurnProviderSessionState;
} | {
	readonly state: 'missingChat' | 'missingTurn';
};

export const CLAUDE_AGENT_PROVIDER_ID = 'claude' as const;

export const CODEX_AGENT_PROVIDER_ID = 'codex' as const;

export type IAgentCapabilities = AgentCapabilities;

export interface IAgentHostCapabilities {
	readonly workspaceConversion: boolean;
}

export interface IAgentDescriptor {
	readonly provider: AgentProvider;
	readonly displayName: string;
	readonly description: string;
	readonly capabilities?: IAgentCapabilities;
}


export interface AuthenticateParams {
	readonly resource: string;
	readonly scopes?: readonly string[];

	readonly token: string;
}

export interface IAgentHostAuthTokenRequest {
	readonly resource: string;
	readonly scopes?: readonly string[];
}

export interface AuthenticateResult {
	readonly authenticated: boolean;
}

export const GITHUB_COPILOT_PROTECTED_RESOURCE: ProtectedResourceMetadata = {
	resource: 'https://api.github.com',
	resource_name: 'GitHub',
	authorization_servers: ['https://github.com/login/oauth'],
	scopes_supported: ['read:user', 'user:email'],
	required: true,
};

export const GITHUB_REPO_PROTECTED_RESOURCE: ProtectedResourceMetadata = {
	resource: 'https://api.github.com/repos',
	resource_name: 'GitHub Repository',
	authorization_servers: ['https://github.com/login/oauth'],
	scopes_supported: ['repo'],
	required: false,
};

export function protectedResourcesRequireGitHubCopilotSignIn(resources: readonly ProtectedResourceMetadata[]): boolean {
	return resources.some(resource =>
		resource.resource === GITHUB_COPILOT_PROTECTED_RESOURCE.resource && resource.required !== false);
}

export interface IAgentCreateSessionConfig {
	readonly provider?: AgentProvider;
	readonly model?: ModelSelection;
	readonly _meta?: Record<string, unknown>;
	readonly agent?: AgentSelection;
	readonly session?: URI;
	readonly workingDirectories?: readonly URI[];
	readonly config?: Record<string, unknown>;
	readonly activeClient?: SessionActiveClient;
	readonly importConversation?: {
		readonly turns: readonly Turn[];
		readonly model?: ModelSelection;
	};
	readonly progressToken?: string;
}

export interface IAgentChatContext {
	readonly resource: URI;
	readonly configurationResource: URI;
	readonly clientTelemetryContext?: IAgentHostClientTelemetryContext;
	readonly origin?: ChatOrigin;
	readonly customizations?: readonly Customization[];
	readonly hostInstructions?: readonly string[];
	readonly agentMergeTurn?: boolean;
}

export type AgentChatOperationContext = URI | IAgentChatContext;

export function resolveAgentChatContext(configurationResourceOrContext: AgentChatOperationContext, resource: URI): IAgentChatContext {
	const context = URI.isUri(configurationResourceOrContext)
		? { configurationResource: configurationResourceOrContext, resource }
		: configurationResourceOrContext;
	if (!isEqual(context.resource, context.configurationResource) && !isEqual(context.resource, resource)) {
		throw new Error(`Chat context resource must be the configuration resource or addressed chat: ${context.resource.toString()}`);
	}
	return context;
}

export function resolveAgentChatOrigin(context?: URI | IAgentChatContext): ChatOrigin | undefined {
	return context && !URI.isUri(context) ? context.origin : undefined;
}

export function resolveSubagentChatParent(context?: URI | IAgentChatContext): IAgentSpawnedChatParent | undefined {
	const origin = resolveAgentChatOrigin(context);
	return origin?.kind === ChatOriginKind.Tool ? { chat: URI.parse(origin.chat), toolCallId: origin.toolCallId } : undefined;
}

export function resolveAgentHostCustomizations(context?: URI | IAgentChatContext): readonly Customization[] | undefined {
	return context && !URI.isUri(context) ? context.customizations : undefined;
}

export function resolveAgentHostInstructions(context?: URI | IAgentChatContext): readonly string[] | undefined {
	return context && !URI.isUri(context) ? context.hostInstructions : undefined;
}

export interface IAgentCreateChatOptions {
	readonly isEphemeral?: boolean;
	readonly hasScopedEditSurface?: boolean;
	readonly title?: string;
	readonly model?: ModelSelection;
	readonly agent?: AgentSelection;
	readonly workingDirectories?: readonly URI[];
	readonly project?: IAgentSessionProjectInfo;
	readonly config?: Record<string, unknown>;
	readonly activeClient?: SessionActiveClient;
	readonly deferBacking?: boolean;
	readonly importConversation?: IAgentCreateSessionConfig['importConversation'];
	readonly fork?: IAgentCreateChatForkSource;
}

export interface IAgentCreateChatRequestOptions extends IAgentCreateChatOptions {
	readonly sideChat?: IAgentCreateChatSideChatSource;
}

export interface IAgentCreateChatForkSource {
	readonly source: URI;
	readonly turnId: string;
	readonly independentQueue?: boolean;
	readonly turnIndex?: number;
	readonly turnIdMapping?: ReadonlyMap<string, string>;
}

export interface IAgentCreateChatSideChatSelection {
	readonly text: string;
	readonly responsePartId?: string;
}

export interface IAgentCreateChatSideChatSource {
	readonly source: URI;
	readonly turnId: string;
	readonly selection?: IAgentCreateChatSideChatSelection;
}

export interface IAgentCreateChatResult {
	readonly project?: IAgentSessionProjectInfo;
	readonly resolvedWorkingDirectory?: URI;
	readonly provisional?: boolean;
	readonly inheritedTurnId?: string;
	readonly providerData?: string;
	readonly backingSession?: URI;
}

export interface IAgentChatDataChange {
	readonly chat: URI;
	readonly providerData: string;
}

export interface IAgentLegacyChat {
	readonly uri: URI;
	readonly providerData?: string;
}

export const AgentChatMigrationDeferred = Symbol('AgentChatMigrationDeferred');

export type AgentChatMigrationResult = readonly IAgentChatMetadata[] | undefined | typeof AgentChatMigrationDeferred;

export interface IAgentSpawnedChatParent {
	readonly chat: URI;
	readonly toolCallId: string;
}

export interface IAgentSpawnChatEvent {
	readonly session: URI;
	readonly chat: URI;
	readonly parent?: IAgentSpawnedChatParent;
	readonly title?: string;
}

const SUBAGENT_CHAT_TITLE_MAX_LENGTH = 60;

export function subagentChatTitle(taskDescription: string | undefined, agentDisplayName: string | undefined): string {
	const task = taskDescription?.trim();
	if (task) {
		return truncate(task, SUBAGENT_CHAT_TITLE_MAX_LENGTH);
	}
	return agentDisplayName?.trim() || 'Subagent';
}

export namespace SubagentChatSignal {

	export function toSpawnEvent(signal: AgentSignal): IAgentSpawnChatEvent | undefined {
		if (signal.kind !== 'subagent_started') {
			return undefined;
		}
		let session: string;
		try {
			session = parseRequiredSessionUriFromChatUri(signal.chat);
		} catch {
			return undefined;
		}
		return {
			session: URI.parse(session),
			chat: URI.parse(buildSubagentChatUri(session, signal.toolCallId)),
			parent: { chat: signal.chat, toolCallId: signal.toolCallId },
			title: subagentChatTitle(signal.taskDescription, signal.agentDisplayName),
		};
	}
}


export interface IAgentChats {
	createChat(chat: URI, context: AgentChatOperationContext, options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult | void>;

	disposeChat(chat: URI, context: AgentChatOperationContext): Promise<void>;

	canReleaseChat?(chat: URI, context: AgentChatOperationContext): Promise<boolean>;

	releaseChat(chat: URI, context: AgentChatOperationContext): Promise<void>;

	sendMessage(chat: URI, prompt: string, workingDirectoriesOrDirectory: readonly URI[] | URI | undefined, attachments?: readonly MessageAttachment[], turnId?: string, senderClientId?: string, clientTypeOrContext?: AgentHostClientType | URI | IAgentChatContext, context?: URI | IAgentChatContext): Promise<void>;

	resumeTurn?(chat: URI, turnId: string, context: AgentChatOperationContext, senderClientId?: string, clientType?: AgentHostClientType): Promise<void>;

	abort(chat: URI, context: AgentChatOperationContext): Promise<void>;

	getModel?(chat: URI, context: AgentChatOperationContext): ModelSelection | undefined;

	changeModel(chat: URI, model: ModelSelection, context: AgentChatOperationContext): Promise<void>;

	changeAgent(chat: URI, agent: AgentSelection | undefined, context: AgentChatOperationContext): Promise<void>;

	getMessages(chat: URI, context: AgentChatOperationContext): Promise<readonly Turn[]>;
}

export interface IAgentResolveChatConfigParams {
	readonly provider?: AgentProvider;
	readonly workingDirectory?: URI;
	readonly config?: Record<string, unknown>;
}

export interface IAgentChatConfigCompletionsParams extends IAgentResolveChatConfigParams {
	readonly property: string;
	readonly query?: string;
}

export type IAgentResolveSessionConfigParams = IAgentResolveChatConfigParams;
export type IAgentSessionConfigCompletionsParams = IAgentChatConfigCompletionsParams;

export interface IAgentModelInfo {
	readonly provider: AgentProvider;
	readonly id: string;
	readonly name: string;
	readonly maxContextWindow?: number;
	readonly maxOutputTokens?: number;
	readonly maxPromptTokens?: number;
	readonly supportsVision: boolean;
	readonly configSchema?: ConfigSchema;
	readonly policyState?: PolicyState;
	readonly _meta?: Record<string, unknown>;
}


export type AgentSignal =
	| IAgentActionSignal
	| IAgentModelCallCompletedSignal
	| IAgentToolPendingConfirmationSignal
	| IAgentSubagentStartedSignal
	| IAgentSubagentResumedSignal
	| IAgentSubagentCompletedSignal
	| IAgentSteeringConsumedSignal;

export interface IAgentActionSignal {
	readonly kind: 'action';
	readonly resource: URI;
	readonly action: SessionAction | ChatAction;
	readonly parentToolCallId?: string;
}

export interface IAgentModelCallCompletedSignal {
	readonly kind: 'model_call_completed';
	readonly resource: URI;
	readonly turnId: string;
	readonly modelCallId: string;
	readonly parentToolCallId?: string;
}

export interface IAgentToolPendingConfirmationSignal {
	readonly kind: 'pending_confirmation';
	readonly chat: URI;
	readonly state: ToolCallPendingConfirmationState;
	readonly permissionKind?: 'shell' | 'write' | 'mcp' | 'read' | 'url' | 'skill' | 'custom-tool' | 'hook' | 'memory' | 'factory' | 'extension-management' | 'extension-permission-access' | 'extension-env-access';
	readonly permissionPath?: string;
	readonly managedApprovalRequired?: boolean;
	readonly requestSandboxBypass?: boolean;
	readonly shellLanguage?: 'bash' | 'powershell';
	readonly parentToolCallId?: string;
}

export type AgentSubagentTaskModelSource = 'task_argument' | 'subagent_configuration' | 'custom_agent_definition' | 'unset';

export interface IAgentSubagentStartedSignal {
	readonly kind: 'subagent_started';
	readonly chat: URI;
	readonly toolCallId: string;
	readonly agentName: string;
	readonly agentDisplayName: string;
	readonly agentDescription?: string;
	readonly taskModelSource?: AgentSubagentTaskModelSource;
	readonly taskDescription?: string;
	readonly taskPrompt?: string;
	readonly parentToolCallId?: string;
}

export interface IAgentSubagentResumedSignal {
	readonly kind: 'subagent_resumed';
	readonly chat: URI;
	readonly toolCallId: string;
	readonly message?: Message;
}

export interface IAgentSubagentCompletedSignal {
	readonly kind: 'subagent_completed';
	readonly chat: URI;
	readonly toolCallId: string;
}

export interface IAgentSteeringConsumedSignal {
	readonly kind: 'steering_consumed';
	readonly chat: URI;
	readonly id: string;
}


export namespace AgentSession {

	export function uri(provider: AgentProvider, rawSessionId: string): URI {
		return URI.from({ scheme: provider, path: `/${rawSessionId}` });
	}

	export function id(session: URI | string): string {
		const parsed = typeof session === 'string' ? URI.parse(session) : session;
		return parsed.path.substring(1);
	}

	export function provider(session: URI | string): AgentProvider | undefined {
		const parsed = typeof session === 'string' ? URI.parse(session) : session;
		return parsed.scheme || undefined;
	}
}


export interface IMcpNotification {
	readonly channel: string;
	readonly method: string;
	readonly params?: Record<string, unknown>;
}

export interface IActiveClient {
	readonly clientId: string;
	readonly displayName: string | undefined;
	tools: readonly ToolDefinition[];
	customizations: readonly ClientPluginCustomization[];
}

export interface IAgentAdoptedWorktree {
	readonly branchName: string;
	readonly baseBranch: string | undefined;
	readonly worktreePath: URI;
	readonly repositoryRoot: URI;
}

export type AgentChatAdoptionReason =
	| 'alreadyNative'
	| 'notLegacyChat'
	| 'workingDirectoryMissing'
	| 'markerUnavailable'
	| 'adopted';

export interface IAgentChatAdoptionResult {
	readonly adopted: boolean;
	readonly eligible: boolean;
	readonly native?: boolean;
	readonly worktree?: IAgentAdoptedWorktree;
	readonly reason?: AgentChatAdoptionReason;
}

export interface IAgent {

	readonly id: AgentProvider;

	readonly agentHostCapabilities: IAgentHostCapabilities;

	getDescriptor(): IAgentDescriptor;

	readonly models: IObservable<readonly IAgentModelInfo[]>;

	refreshModels?(): Promise<void>;


	readonly onDidChatProgress: Event<AgentSignal>;

	readonly onDidMaterializeChat: Event<IAgentMaterializeChatEvent>;

	readonly onDidChangeChatData: Event<IAgentChatDataChange>;

	readonly onDidSpawnChat: Event<IAgentSpawnChatEvent>;

	readonly chats: IAgentChats;

	materializeChat(chat: URI, context: URI | IAgentChatContext, providerData: string | undefined): Promise<IAgentCreateChatResult | void>;

	setPendingMessages?(chat: URI, steeringMessage: PendingMessage | undefined, queuedMessages: readonly PendingMessage[]): void;

	truncateChat?(chat: URI, turnId: string | undefined, context?: URI | IAgentChatContext): Promise<void>;

	setWorkingDirectory(chat: URI, context: URI | IAgentChatContext, workingDirectory: URI): Promise<void>;

	getTurnDiagnosticSnapshot?(chat: URI, turnId: string): IAgentTurnDiagnosticSnapshot | undefined;

	recordModelCallTurnCorrelation?(chat: URI, modelCallId: string, turnId: string): void;


	getOrCreateActiveClient(chat: URI, context: URI | IAgentChatContext, client: { readonly clientId: string; readonly displayName?: string }, hostCustomizations?: readonly Customization[]): IActiveClient;

	removeActiveClient(chat: URI, context: URI | IAgentChatContext, clientId: string): void;

	onClientToolCallComplete(chat: URI, toolCallId: string, result: ToolCallResult, context?: IAgentChatContext): void;

	respondToPermissionRequest(requestId: string, approved: boolean): void;

	respondToUserInputRequest(requestId: string, response: ChatInputResponseKind, answers?: Record<string, ChatInputAnswer>): void;


	resolveChatConfig(params: IAgentResolveChatConfigParams): Promise<ResolveSessionConfigResult>;

	getInheritedChatConfig(config: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined;

	getAutonomousSessionConfig?(config: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined;

	chatConfigCompletions(params: IAgentChatConfigCompletionsParams): Promise<SessionConfigCompletionsResult>;

	readonly onDidCustomizationsChange?: Event<void>;

	getCustomizations?(): readonly Customization[];

	getChatCustomizations(chat: URI, context: URI | IAgentChatContext, hostCustomizations?: readonly Customization[]): Promise<readonly Customization[]>;

	getMcpServerOwners?(session: URI): ReadonlyMap<string, string> | undefined;

	computeFolderPickerDecision?(workingDirectories: readonly URI[], token?: CancellationToken): Promise<ISessionFolderPickerDecision | undefined>;


	readonly onDidDiscoverChats: Event<readonly IAgentDiscoveredChat[]>;

	startChatDiscovery?(): Promise<void>;

	setKnownSessionsFilter?(filter: IAgentKnownSessionsFilter): void;


	ensureChatAdopted?(chat: URI, context: URI | IAgentChatContext): Promise<IAgentChatAdoptionResult>;

	recoverLegacyChat?(chat: URI, context: URI | IAgentChatContext): Promise<IAgentCreateChatResult | void>;

	listChatsToMigrate(): Promise<AgentChatMigrationResult>;

	listLegacyChatBackings?(configurationResource: URI): Promise<readonly IAgentLegacyChat[]>;


	prewarmSessionMetadata?(): Promise<IDisposable>;

	getChatMetadata(chat: URI, context: URI | IAgentChatContext, providerData?: string, options?: IAgentChatMetadataOptions): Promise<IAgentChatMetadata | undefined>;


	getProtectedResources(): ProtectedResourceMetadata[];

	authenticate(resource: string, token: string): Promise<boolean>;

	handleAuthenticationToken?(params: AuthenticateParams): Promise<boolean>;

	readonly authenticationRequired?: IObservable<Omit<AuthRequiredParams, 'channel'> | undefined>;

	getNetworkDiagnosticsEndpoints?(): Promise<readonly IAgentHostNetworkEndpoint[]>;

	getNetworkDiagnosticsAccount?(): Promise<string | undefined>;

	getManagedSettingsDiagnostics?(): Promise<IAgentHostManagedSettingsSnapshot>;

	getSessionStateFile?(session: URI, chat?: URI): Promise<URI | undefined>;

	collectDebugLogs?(session: URI | undefined, outputDirectory: URI, chat?: URI): Promise<boolean>;


	setServerToolHost?(host: IAgentServerToolHost): void;

	startMcpServer?(session: URI, id: string): Promise<void>;

	stopMcpServer?(session: URI, id: string): Promise<void>;

	handleMcpRequest?(chat: URI, serverName: string, method: string, params: Record<string, unknown> | undefined): Promise<unknown>;

	readonly onMcpNotification?: Event<IMcpNotification>;


	onArchivedChanged?(session: URI, isArchived: boolean): Promise<void>;

	shutdown(): Promise<void>;

	dispose(): void;
}
