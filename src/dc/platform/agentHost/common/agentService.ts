/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { VSBuffer } from '../../../base/common/buffer.js';
import { Event } from '../../../base/common/event.js';
import { IReference } from '../../../base/common/lifecycle.js';
import type { IObservable } from '../../../base/common/observable.js';
import { isWindows } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import type { IConfigurationChangeEvent, IConfigurationService } from '../../configuration/common/configuration.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { AgentSandboxSettingId } from '../../sandbox/common/settings.js';
import type { IActiveSubscriptionInfo, IAgentSubscription } from './state/agentSubscription.js';
import type { IRemoteWatchHandle } from './agentHostFileSystemProvider.js';
import type { IAgentHostResourceUriMapper } from './agentHostUri.js';
import type { IAgentHostClientTelemetryContext } from './agentHostTelemetry.js';
import type { CompletionsParams, CompletionsResult, CreateTerminalParams, ResolveSessionConfigResult, SessionConfigCompletionsResult } from './state/protocol/commands.js';
import type { AutomationCapabilities, InitializeResult } from './state/protocol/common/commands.js';
import type { InvokeChangesetOperationParams, InvokeChangesetOperationResult } from './state/protocol/channels-changeset/commands.js';
import type { FetchAutomationRunsParams, FetchAutomationRunsResult, ListAutomationTriggerDefinitionsParams, ListAutomationTriggerDefinitionsResult, RunAutomationParams, RunAutomationResult } from './state/protocol/channels-automation/commands.js';
import type { ActionEnvelope, ClientAutomationAction, ClientAutomationRunAction, INotification, IRootConfigChangedAction, SessionAction, ChatAction, TerminalAction, ClientAnnotationsAction, ClientChangesetAction } from './state/sessionActions.js';
import type { ContentEncoding, ResourceCopyParams, ResourceCopyResult, ResourceDeleteParams, ResourceDeleteResult, ResourceListResult, ResourceMkdirParams, ResourceMkdirResult, ResourceMoveParams, ResourceMoveResult, ResourceReadResult, ResourceResolveParams, ResourceResolveResult, ResourceWatchState, ResourceWriteParams, ResourceWriteResult, CreateResourceWatchParams, CreateResourceWatchResult, IStateSnapshot } from './state/sessionProtocol.js';
import { ComponentToState, StateComponents, type RootState } from './state/sessionState.js';
import { type AgentProvider, CLAUDE_AGENT_PROVIDER_ID, CODEX_AGENT_PROVIDER_ID, type AuthenticateParams, type AuthenticateResult, type IAgentCreateChatRequestOptions, type IAgentCreateSessionConfig, type IAgentSessionMetadata, type IAgentResolveSessionConfigParams, type IAgentSessionConfigCompletionsParams, type IMcpNotification, type IAgentHostNetworkEndpoint, type IAgentHostManagedSettingsSnapshot } from './agent.js';

export type {
	IAgent, IAgentChats, IAgentChatContext, IAgentCreateChatOptions, IAgentCreateChatRequestOptions, IAgentCreateChatForkSource,
	IAgentCreateChatSideChatSelection, IAgentCreateChatSideChatSource, IAgentCreateChatResult,
	IAgentCreateSessionConfig, IAgentCreateSessionResult, IAgentChatMetadata, IAgentSessionMetadata,
	IAgentSessionProjectInfo, IAgentLegacyChat, IAgentChatAdoptionResult, IAgentSpawnedChatParent,
	IAgentSpawnChatEvent, IAgentMaterializeChatEvent, IAgentChatDataChange, IAgentResolveChatConfigParams,
	IAgentChatConfigCompletionsParams, IAgentResolveSessionConfigParams, IAgentSessionConfigCompletionsParams,
	IAgentModelInfo, AgentSignal, IAgentActionSignal, IAgentToolPendingConfirmationSignal,
	IAgentSubagentStartedSignal, IAgentSubagentResumedSignal, IAgentSubagentCompletedSignal,
	IAgentSteeringConsumedSignal, IMcpNotification, IActiveClient, AgentProvider, IAgentCapabilities,
	IAgentDescriptor, AuthenticateParams, IAgentHostAuthTokenRequest, AuthenticateResult,
	IAgentHostNetworkEndpoint, IAgentHostManagedSettingsSnapshot,
} from './agent.js';
export {
	AgentSession, CLAUDE_AGENT_PROVIDER_ID, CODEX_AGENT_PROVIDER_ID, GITHUB_COPILOT_PROTECTED_RESOURCE,
	GITHUB_REPO_PROTECTED_RESOURCE, protectedResourcesRequireGitHubCopilotSignIn, resolveAgentChatContext,
	resolveAgentChatOrigin, resolveSubagentChatParent, resolveAgentHostCustomizations, subagentChatTitle,
	SubagentChatSignal,
} from './agent.js';


export const enum AgentHostIpcChannels {
	AgentHost = 'agentHost',
	Logger = 'agentHostLogger',
	ConnectionTracker = 'agentHostConnectionTracker',
	Protocol = 'agentHostProtocol',
	Management = 'agentHostManagement',
	RemoteProxy = 'agentHostProxy',
}

export const AgentHostAhpJsonlLoggingSettingId = 'chat.agentHost.ahpJsonlLoggingEnabled';

export type AgentHostDebugLogsArtifactKind = 'archive' | 'directory';
export const AGENT_HOST_DEBUG_LOGS_MAX_ENTRIES = 1000;
export const AGENT_HOST_DEBUG_LOGS_CHUNK_BYTES = 1024 * 1024;

export interface IAgentHostDebugLogsArtifactEntry {
	readonly path: string;
	readonly size: number;
}

export interface IAgentHostDebugLogsArtifact {
	readonly kind: AgentHostDebugLogsArtifactKind;
	readonly resource: URI;
	readonly providerLogsIncluded: boolean;
	readonly size: number;
	readonly uncompressedSize: number;
	readonly entries: readonly IAgentHostDebugLogsArtifactEntry[];
}

export interface IAgentHostDebugLogsChunk {
	readonly data: VSBuffer;
	readonly eof: boolean;
}

export const AgentHostSystemProxyEnabledSettingId = 'chat.agentHost.systemProxy.enabled';

export const AgentHostActiveAgentTitleGenerationSettingId = 'chat.agentHost.experimental.activeAgentTitleGeneration';

export const AgentHostMarkdownPlanRichLinksEnabledSettingId = 'chat.agentHost.experimental.markdownPlanRichLinks';

export const ArtifactToolsSettingId = 'chat.artifactTools.enabled';

export const AgentHostAutoAttachPullRequestsSettingId = 'chat.agentHost.experimental.autoAttachPullRequests';

export const AgentHostCopilotMultiRootEnabledSettingId = 'chat.agentHost.copilotAgent.multiRootEnabled';

export const AgentHostClaudeMultiRootEnabledSettingId = 'chat.agentHost.claudeAgent.multiRootEnabled';

export const AgentHostCodexMultiRootEnabledSettingId = 'chat.agentHost.codexAgent.multiRootEnabled';

export const AgentHostAllowSignedOutWhenUsableSettingId = 'chat.agentHost.allowSignedOutWhenUsable';


export const AgentHostClaudeAgentEnabledSettingId = 'chat.agentHost.claudeAgent.enabled';

export const AgentHostCodexAgentEnabledSettingId = 'chat.agentHost.codexAgent.enabled';

export const AgentHostByokModelsEnabledSettingId = 'chat.agentHost.byokModels.enabled';

export const AgentHostClaudeSdkRootEnvVar = 'VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT';

export const AgentHostClaudeAgentEnabledEnvVar = 'VSCODE_AGENT_HOST_CLAUDE_AGENT_ENABLED';

export const AgentHostCodexAgentEnabledEnvVar = 'VSCODE_AGENT_HOST_CODEX_AGENT_ENABLED';

export const AgentHostSessionResidencyLimitEnvVar = 'VSCODE_AGENT_HOST_SESSION_RESIDENCY_LIMIT';

export const AgentHostSessionReleaseRetryMsEnvVar = 'VSCODE_AGENT_HOST_SESSION_RELEASE_RETRY_MS';

export function isAgentEnabled(envValue: string | undefined, defaultEnabled: boolean): boolean {
	if (envValue === undefined || envValue === '') {
		return defaultEnabled;
	}
	const normalized = envValue.trim().toLowerCase();
	if (normalized === 'false' || normalized === '0') {
		return false;
	}
	if (normalized === 'true' || normalized === '1') {
		return true;
	}
	return defaultEnabled;
}

export const AgentHostSdkSandboxEnabledSettingId = 'chat.agentHost.sdkSandbox.enabled';

export const AgentHostSdkSandboxWindowsEnabledSettingId = 'chat.agentHost.sdkSandbox.enabledWindows';

export type AgentHostCopilotSandboxSettingId =
	| AgentSandboxSettingId.AgentSandboxEnabled
	| AgentSandboxSettingId.AgentSandboxWindowsEnabled
	| typeof AgentHostSdkSandboxEnabledSettingId
	| typeof AgentHostSdkSandboxWindowsEnabledSettingId;

export function getAgentHostCopilotSandboxSettingId(customTerminalToolEnabled: boolean, windows = isWindows): AgentHostCopilotSandboxSettingId {
	if (customTerminalToolEnabled) {
		return windows ? AgentSandboxSettingId.AgentSandboxWindowsEnabled : AgentSandboxSettingId.AgentSandboxEnabled;
	}
	return windows ? AgentHostSdkSandboxWindowsEnabledSettingId : AgentHostSdkSandboxEnabledSettingId;
}

export const CodexPreferAgentHostEditorSettingId = 'chat.editor.codex.preferAgentHost';

export function affectsAgentHostProviderPreference(event: IConfigurationChangeEvent): boolean {
	return event.affectsConfiguration(AgentHostClaudeAgentEnabledSettingId)
		|| event.affectsConfiguration(CodexPreferAgentHostEditorSettingId);
}

export function shouldSurfaceLocalAgentHostProvider(provider: AgentProvider, configurationService: IConfigurationService): boolean {
	switch (provider) {
		case CLAUDE_AGENT_PROVIDER_ID:
			return configurationService.getValue<boolean>(AgentHostClaudeAgentEnabledSettingId) !== false;
		case CODEX_AGENT_PROVIDER_ID:
			return configurationService.getValue<boolean>(CodexPreferAgentHostEditorSettingId) === true;
		default:
			return true;
	}
}


export const AgentHostCodexAgentSdkRootSettingId = 'chat.agentHost.codexAgent.sdkRoot';

export const AgentHostCodexAgentCodexHomeSettingId = 'chat.agentHost.codexAgent.codexHome';

export const AgentHostCodexAgentBinaryArgsSettingId = 'chat.agentHost.codexAgent.binaryArgs';

export const AgentHostCodexAgentSdkRootEnvVar = 'VSCODE_AGENT_HOST_CODEX_SDK_ROOT';

export const AgentHostCodexAgentCodexHomeEnvVar = 'CODEX_HOME';

export const AgentHostCodexAgentBinaryArgsEnvVar = 'VSCODE_AGENT_HOST_CODEX_APP_SERVER_ARGS';


export const AgentHostOTelEnabledSettingId = 'chat.agentHost.otel.enabled';
export const AgentHostOTelExporterTypeSettingId = 'chat.agentHost.otel.exporterType';
export const AgentHostOTelOtlpProtocolSettingId = 'chat.agentHost.otel.otlpProtocol';
export const AgentHostOTelOtlpEndpointSettingId = 'chat.agentHost.otel.otlpEndpoint';
export const AgentHostOTelCaptureContentSettingId = 'chat.agentHost.otel.captureContent';
export const AgentHostOTelOutfileSettingId = 'chat.agentHost.otel.outfile';
export const AgentHostOTelServiceNameSettingId = 'chat.agentHost.otel.serviceName';
export const AgentHostOTelResourceAttributesSettingId = 'chat.agentHost.otel.resourceAttributes';
export const AgentHostOTelDbSpanExporterEnabledSettingId = 'chat.agentHost.otel.dbSpanExporter.enabled';

export const AgentHostOTelSpansDbSubPath = 'agent-host/otel/agent-host-traces.db';

export const AgentHostOTelEnvVars = Object.freeze({
	Enabled: 'DARDCOR_OTEL_ENABLED',
	ExporterType: 'DARDCOR_OTEL_EXPORTER_TYPE',
	OtlpEndpoint: 'OTEL_EXPORTER_OTLP_ENDPOINT',
	OtlpEndpointAlt: 'DARDCOR_OTEL_ENDPOINT',
	OtlpProtocol: 'OTEL_EXPORTER_OTLP_PROTOCOL',
	OtlpTracesProtocol: 'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL',
	OtlpMetricsProtocol: 'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
	OtlpHeaders: 'OTEL_EXPORTER_OTLP_HEADERS',
	CaptureContent: 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT',
	FilePath: 'DARDCOR_OTEL_FILE_EXPORTER_PATH',
	SourceName: 'DARDCOR_OTEL_SOURCE_NAME',
	ServiceName: 'OTEL_SERVICE_NAME',
	ResourceAttributes: 'OTEL_RESOURCE_ATTRIBUTES',
	DbSpanExporterEnabled: 'DARDCOR_OTEL_DB_SPAN_EXPORTER_ENABLED',
} as const);

export interface IAgentHostOTelSettings {
	readonly enabled?: boolean;
	readonly exporterType?: string;
	readonly otlpProtocol?: string;
	readonly otlpEndpoint?: string;
	readonly captureContent?: boolean;
	readonly outfile?: string;
	readonly serviceName?: string;
	readonly resourceAttributes?: Record<string, string>;
	readonly dbSpanExporterEnabled?: boolean;
}

export const AgentHostOTelPolicyIpcChannel = 'vscode:agentHostOTelPolicy';

export const AgentHostRestartIpcChannel = 'vscode:restartAgentHost';

export const AgentHostWillRestartIpcChannel = 'vscode:agentHostWillRestart';

export function readAgentHostOTelPolicySettings(configurationService: IConfigurationService): IAgentHostOTelSettings {
	const policyValue = <T>(key: string): T | undefined => configurationService.inspect<T>(key).policyValue;
	return {
		enabled: policyValue<boolean>(AgentHostOTelEnabledSettingId),
		exporterType: policyValue<string>(AgentHostOTelExporterTypeSettingId),
		otlpProtocol: policyValue<string>(AgentHostOTelOtlpProtocolSettingId),
		otlpEndpoint: policyValue<string>(AgentHostOTelOtlpEndpointSettingId),
		captureContent: policyValue<boolean>(AgentHostOTelCaptureContentSettingId),
		outfile: policyValue<string>(AgentHostOTelOutfileSettingId),
		serviceName: policyValue<string>(AgentHostOTelServiceNameSettingId),
		resourceAttributes: policyValue<Record<string, string>>(AgentHostOTelResourceAttributesSettingId),
	};
}

export function sanitizeAgentHostOTelPolicySettings(raw: unknown): IAgentHostOTelSettings {
	if (!raw || typeof raw !== 'object') {
		return {};
	}
	const record = raw as Record<string, unknown>;
	const asString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
	const asBoolean = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
	const asStringRecord = (value: unknown): Record<string, string> | undefined => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return undefined;
		}
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
				continue;
			}
			if (typeof v === 'string') {
				out[k] = v;
			}
		}
		return out;
	};
	return {
		enabled: asBoolean(record.enabled),
		exporterType: asString(record.exporterType),
		otlpProtocol: asString(record.otlpProtocol),
		otlpEndpoint: asString(record.otlpEndpoint),
		captureContent: asBoolean(record.captureContent),
		outfile: asString(record.outfile),
		serviceName: asString(record.serviceName),
		resourceAttributes: asStringRecord(record.resourceAttributes),
	};
}

function serializeResourceAttributes(attributes: Record<string, string> | undefined): string | undefined {
	if (!attributes) {
		return undefined;
	}
	const parts = Object.entries(attributes)
		.filter(([key, value]) => key !== '' && typeof value === 'string')
		.map(([key, value]) => `${key}=${value}`);
	return parts.length > 0 ? parts.join(',') : undefined;
}

export function buildAgentHostOTelEnv(
	settings: IAgentHostOTelSettings,
	inheritedEnv: Readonly<Record<string, string | undefined>>,
	policySettings: IAgentHostOTelSettings = {},
): Record<string, string> {
	const out: Record<string, string> = {};
	const setIfMissing = (key: string, value: string | undefined): void => {
		if (value === undefined || value === '' || inheritedEnv[key] !== undefined) {
			return;
		}
		out[key] = value;
	};
	const setPolicy = (key: string, value: string | undefined): void => {
		if (value !== undefined) {
			out[key] = value;
		}
	};
	if (settings.enabled) {
		setIfMissing(AgentHostOTelEnvVars.Enabled, 'true');
	}
	setIfMissing(AgentHostOTelEnvVars.ExporterType, settings.exporterType);
	setIfMissing(AgentHostOTelEnvVars.OtlpEndpoint, settings.otlpEndpoint);
	setIfMissing(AgentHostOTelEnvVars.ServiceName, settings.serviceName);
	setIfMissing(AgentHostOTelEnvVars.ResourceAttributes, serializeResourceAttributes(settings.resourceAttributes));
	setIfMissing(AgentHostOTelEnvVars.FilePath, settings.outfile);
	if (settings.captureContent !== undefined) {
		setIfMissing(AgentHostOTelEnvVars.CaptureContent, settings.captureContent ? 'true' : 'false');
	}
	if (settings.dbSpanExporterEnabled) {
		setIfMissing(AgentHostOTelEnvVars.DbSpanExporterEnabled, 'true');
	}

	if (policySettings.enabled !== undefined) {
		setPolicy(AgentHostOTelEnvVars.Enabled, policySettings.enabled ? 'true' : 'false');
		if (!policySettings.enabled) {
			setPolicy(AgentHostOTelEnvVars.OtlpEndpoint, '');
			setPolicy(AgentHostOTelEnvVars.OtlpEndpointAlt, '');
			setPolicy(AgentHostOTelEnvVars.FilePath, '');
		}
	}
	if (policySettings.exporterType !== undefined) {
		setPolicy(AgentHostOTelEnvVars.ExporterType, policySettings.exporterType);
		setPolicy(AgentHostOTelEnvVars.FilePath, '');
	}
	if (policySettings.otlpProtocol !== undefined && policySettings.otlpProtocol !== '') {
		setPolicy(AgentHostOTelEnvVars.OtlpProtocol, policySettings.otlpProtocol);
		setPolicy(AgentHostOTelEnvVars.OtlpTracesProtocol, policySettings.otlpProtocol);
		setPolicy(AgentHostOTelEnvVars.OtlpMetricsProtocol, policySettings.otlpProtocol);
	}
	if (policySettings.otlpEndpoint !== undefined) {
		setPolicy(AgentHostOTelEnvVars.OtlpEndpoint, policySettings.otlpEndpoint);
		setPolicy(AgentHostOTelEnvVars.FilePath, '');
	}
	if (policySettings.outfile !== undefined) {
		setPolicy(AgentHostOTelEnvVars.FilePath, policySettings.outfile);
	}
	if (policySettings.captureContent !== undefined) {
		setPolicy(AgentHostOTelEnvVars.CaptureContent, policySettings.captureContent ? 'true' : 'false');
	}
	if (policySettings.serviceName !== undefined && policySettings.serviceName !== '') {
		setPolicy(AgentHostOTelEnvVars.ServiceName, policySettings.serviceName);
	}
	const policyResourceAttributes = serializeResourceAttributes(policySettings.resourceAttributes);
	if (policyResourceAttributes !== undefined) {
		setPolicy(AgentHostOTelEnvVars.ResourceAttributes, policyResourceAttributes);
	}
	return out;
}

export interface IAgentSdkStarterSettings {
	readonly codexSdkRoot?: string;
	readonly codexHome?: string;
	readonly codexBinaryArgs?: readonly string[];
	readonly claudeAgentEnabled?: boolean;
	readonly codexAgentEnabled?: boolean;
}

export function buildAgentSdkEnv(
	settings: IAgentSdkStarterSettings,
	inheritedEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
	const out: Record<string, string> = {};
	const setIfMissing = (key: string, value: string | undefined): void => {
		if (value === undefined || value === '' || inheritedEnv[key] !== undefined) {
			return;
		}
		out[key] = value;
	};
	setIfMissing(AgentHostCodexAgentSdkRootEnvVar, settings.codexSdkRoot);
	setIfMissing(AgentHostCodexAgentCodexHomeEnvVar, settings.codexHome);
	if (Array.isArray(settings.codexBinaryArgs) && settings.codexBinaryArgs.length > 0) {
		setIfMissing(AgentHostCodexAgentBinaryArgsEnvVar, JSON.stringify(settings.codexBinaryArgs));
	}
	if (settings.claudeAgentEnabled !== undefined) {
		setIfMissing(AgentHostClaudeAgentEnabledEnvVar, settings.claudeAgentEnabled ? 'true' : 'false');
	}
	if (settings.codexAgentEnabled !== undefined) {
		setIfMissing(AgentHostCodexAgentEnabledEnvVar, settings.codexAgentEnabled ? 'true' : 'false');
	}
	return out;
}

export interface IAgentHostSocketInfo {
	readonly socketPath: string;
}

export interface IAgentHostInspectInfo {
	readonly host: string;
	readonly port: number;
	readonly devtoolsUrl: string;
}

export interface IAgentHostNetworkDiagnosticsInfo {
	readonly version: string;
	readonly os: string;
	readonly arch: string;
	readonly account?: string;
	readonly proxySettings: Readonly<Record<string, string>>;
	readonly proxyEnv: Readonly<Record<string, string>>;
	readonly endpoints: readonly IAgentHostNetworkEndpoint[];
}

export interface IAgentHostManagedSettingsDiagnostics {
	readonly provider: AgentProvider;
	readonly snapshot?: IAgentHostManagedSettingsSnapshot;
	readonly error?: string;
}

export interface IAgentHostDnsResult {
	readonly address?: string;
	readonly durationMs?: number;
	readonly error?: string;
}

export interface IAgentHostNetworkFetchResult {
	readonly url: string;
	readonly proxyUrl?: string;
	readonly dnsIpv4?: IAgentHostDnsResult;
	readonly dnsIpv6?: IAgentHostDnsResult;
	readonly statusCode?: number;
	readonly statusMessage?: string;
	readonly body?: string;
	readonly durationMs?: number;
	readonly error?: string;
}

export interface IConnectionTrackerService {
	readonly onDidChangeConnectionCount: Event<number>;

	waitForConfiguredWebSocketServer(): Promise<void>;

	startWebSocketServer(): Promise<IAgentHostSocketInfo>;

	getInspectInfo(tryEnable: boolean): Promise<IAgentHostInspectInfo | undefined>;
}

export interface IAgentHostManagementService {
	readonly _serviceBrand: undefined;

	createSessionWithExtensions(config: IAgentCreateSessionConfig): Promise<URI>;
	createChatWithExtensions(session: URI, chat: URI, options: IAgentCreateChatRequestOptions): Promise<void>;
	createDetachedWorktree(session: URI, prompt: string): Promise<{ handle: string; worktree: URI }>;
	setDetachedWorktreeArchived(handle: string, archived: boolean): Promise<void>;
	claimDetachedWorktree(handle: string): Promise<void>;
	deleteDetachedWorktree(handle: string): Promise<void>;
	reconcileDetachedWorktrees(scope: string, activeHandles: readonly string[]): Promise<void>;
	shutdown(): Promise<void>;
	getNetworkDiagnosticsInfo(): Promise<IAgentHostNetworkDiagnosticsInfo>;
	getManagedSettingsDiagnostics(): Promise<readonly IAgentHostManagedSettingsDiagnostics[]>;
	diagnosticsFetch(url: string): Promise<IAgentHostNetworkFetchResult>;
	getSessionStateFile(session: URI, chat?: URI): Promise<URI | undefined>;
	collectDebugLogs(session: URI | undefined, kind: AgentHostDebugLogsArtifactKind, chat?: URI): Promise<IAgentHostDebugLogsArtifact>;
	readDebugLogsChunk(resource: URI, position: number): Promise<IAgentHostDebugLogsChunk>;
	startWebSocketServer(): Promise<IAgentHostSocketInfo>;
	getInspectInfo(tryEnable: boolean): Promise<IAgentHostInspectInfo | undefined>;
}


export const IAgentService = createDecorator<IAgentService>('agentService');

export interface IAgentService {
	readonly _serviceBrand: undefined;

	authenticate(params: AuthenticateParams): Promise<AuthenticateResult>;

	listSessions(): Promise<IAgentSessionMetadata[]>;

	createSession(config?: IAgentCreateSessionConfig): Promise<URI>;
	createDetachedWorktree?(session: URI, prompt: string): Promise<{ handle: string; worktree: URI }>;
	claimDetachedWorktree?(handle: string): Promise<void>;
	setDetachedWorktreeArchived?(handle: string, archived: boolean): Promise<void>;
	deleteDetachedWorktree?(handle: string): Promise<void>;
	reconcileDetachedWorktrees?(scope: string, activeHandles: readonly string[]): Promise<void>;

	createChat(session: URI, chat: URI, options?: IAgentCreateChatRequestOptions): Promise<void>;

	disposeChat(session: URI, chat: URI): Promise<void>;

	resolveSessionConfig(params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult>;

	sessionConfigCompletions(params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult>;

	completions(params: CompletionsParams): Promise<CompletionsResult>;

	getCompletionTriggerCharacters(): Promise<readonly string[]>;

	disposeSession(session: URI): Promise<void>;

	createTerminal(params: CreateTerminalParams): Promise<void>;

	disposeTerminal(terminal: URI): Promise<void>;

	invokeChangesetOperation(params: InvokeChangesetOperationParams): Promise<InvokeChangesetOperationResult>;

	handleMcpRequest(channel: string, method: string, params: Record<string, unknown> | undefined): Promise<unknown>;

	readonly onMcpNotification: Event<IMcpNotification>;

	shutdown(): Promise<void>;

	getNetworkDiagnosticsInfo(): Promise<IAgentHostNetworkDiagnosticsInfo>;

	getManagedSettingsDiagnostics(): Promise<readonly IAgentHostManagedSettingsDiagnostics[]>;

	diagnosticsFetch(url: string): Promise<IAgentHostNetworkFetchResult>;

	getSessionStateFile?(session: URI, chat?: URI): Promise<URI | undefined>;

	collectDebugLogs?(session: URI | undefined, kind: AgentHostDebugLogsArtifactKind, chat?: URI): Promise<IAgentHostDebugLogsArtifact>;

	readDebugLogsChunk?(resource: URI, position: number): Promise<IAgentHostDebugLogsChunk>;


	subscribe(resource: URI, clientId: string, isActive?: () => boolean): Promise<IStateSnapshot>;

	unsubscribe(resource: URI, clientId: string): void;

	addSubscriber(resource: URI, clientId: string): void;

	readonly onDidAction: Event<ActionEnvelope>;

	readonly onDidNotification: Event<INotification>;

	readonly automationCapabilities: AutomationCapabilities | undefined;
	listAutomationTriggerDefinitions(params: ListAutomationTriggerDefinitionsParams): Promise<ListAutomationTriggerDefinitionsResult>;
	runAutomation(params: RunAutomationParams): Promise<RunAutomationResult>;
	fetchAutomationRuns(params: FetchAutomationRunsParams): Promise<FetchAutomationRunsResult>;

	dispatchAction(channel: string, action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | IRootConfigChangedAction | ClientAutomationAction | ClientAutomationRunAction, clientId: string, clientSeq: number, clientContext?: IAgentHostClientTelemetryContext): void;

	resourceList(uri: URI): Promise<ResourceListResult>;

	resourceRead(uri: URI, encoding?: ContentEncoding): Promise<ResourceReadResult>;

	resourceWrite(params: ResourceWriteParams): Promise<ResourceWriteResult>;

	resourceCopy(params: ResourceCopyParams): Promise<ResourceCopyResult>;

	resourceDelete(params: ResourceDeleteParams): Promise<ResourceDeleteResult>;

	resourceMove(params: ResourceMoveParams): Promise<ResourceMoveResult>;

	resourceResolve(params: ResourceResolveParams): Promise<ResourceResolveResult>;

	resourceMkdir(params: ResourceMkdirParams): Promise<ResourceMkdirResult>;

	createResourceWatch(params: CreateResourceWatchParams): Promise<CreateResourceWatchResult>;

	onResourceWatchSubscribed(channel: string): ResourceWatchState | undefined;

	onResourceWatchUnsubscribed(channel: string): boolean;
}

export interface IAgentConnection {

	readonly clientId: string;
	readonly resourceUris: IAgentHostResourceUriMapper;

	readonly rootState: IAgentSubscription<RootState>;
	getSubscription<T extends StateComponents>(kind: T, resource: URI, owner: string): IReference<IAgentSubscription<ComponentToState[T]>>;
	getSubscriptionUnmanaged<T extends StateComponents>(kind: T, resource: URI): IAgentSubscription<ComponentToState[T]> | undefined;

	getInflightSessionCreate(resource: URI): Promise<unknown> | undefined;

	getActiveSubscriptions(): readonly IActiveSubscriptionInfo[];

	dispatch(channel: string, action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | ClientAutomationAction | ClientAutomationRunAction | IRootConfigChangedAction): void;

	readonly onDidNotification: Event<INotification>;
	readonly onDidAction: Event<ActionEnvelope>;
	readonly onMcpNotification: Event<IMcpNotification>;

	handleMcpRequest(channel: string, method: string, params: Record<string, unknown> | undefined): Promise<unknown>;

	authenticate(params: AuthenticateParams): Promise<AuthenticateResult>;
	listSessions(): Promise<IAgentSessionMetadata[]>;
	createSession(config?: IAgentCreateSessionConfig): Promise<URI>;
	createDetachedWorktree?(session: URI, prompt: string): Promise<{ handle: string; worktree: URI }>;
	claimDetachedWorktree?(handle: string): Promise<void>;
	setDetachedWorktreeArchived?(handle: string, archived: boolean): Promise<void>;
	deleteDetachedWorktree?(handle: string): Promise<void>;
	reconcileDetachedWorktrees?(scope: string, activeHandles: readonly string[]): Promise<void>;
	resolveSessionConfig(params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult>;
	sessionConfigCompletions(params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult>;
	completions(params: CompletionsParams): Promise<CompletionsResult>;
	listAutomationTriggerDefinitions(params: ListAutomationTriggerDefinitionsParams): Promise<ListAutomationTriggerDefinitionsResult>;
	runAutomation(params: RunAutomationParams): Promise<RunAutomationResult>;
	fetchAutomationRuns(params: FetchAutomationRunsParams): Promise<FetchAutomationRunsResult>;

	getCompletionTriggerCharacters(): Promise<readonly string[]>;

	readonly initializeResult: IObservable<InitializeResult | undefined>;
	disposeSession(session: URI): Promise<void>;

	getNetworkDiagnosticsInfo(): Promise<IAgentHostNetworkDiagnosticsInfo>;

	getManagedSettingsDiagnostics(): Promise<readonly IAgentHostManagedSettingsDiagnostics[]>;

	diagnosticsFetch(url: string): Promise<IAgentHostNetworkFetchResult>;

	getSessionStateFile(session: URI, chat?: URI): Promise<URI | undefined>;

	collectDebugLogs(session: URI | undefined, kind: AgentHostDebugLogsArtifactKind, chat?: URI): Promise<IAgentHostDebugLogsArtifact>;

	readDebugLogsChunk(resource: URI, position: number): Promise<IAgentHostDebugLogsChunk>;

	createChat(session: URI, chat: URI, options?: IAgentCreateChatRequestOptions): Promise<void>;
	disposeChat(chat: URI): Promise<void>;

	createTerminal(params: CreateTerminalParams): Promise<void>;
	disposeTerminal(terminal: URI): Promise<void>;

	invokeChangesetOperation(params: InvokeChangesetOperationParams): Promise<InvokeChangesetOperationResult>;

	resourceList(uri: URI): Promise<ResourceListResult>;
	resourceRead(uri: URI, encoding?: ContentEncoding): Promise<ResourceReadResult>;
	resourceWrite(params: ResourceWriteParams): Promise<ResourceWriteResult>;
	resourceCopy(params: ResourceCopyParams): Promise<ResourceCopyResult>;
	resourceDelete(params: ResourceDeleteParams): Promise<ResourceDeleteResult>;
	resourceMove(params: ResourceMoveParams): Promise<ResourceMoveResult>;
	resourceResolve(params: ResourceResolveParams): Promise<ResourceResolveResult>;
	resourceMkdir(params: ResourceMkdirParams): Promise<ResourceMkdirResult>;
	createResourceWatch(params: CreateResourceWatchParams): Promise<CreateResourceWatchResult>;
	watchResource(params: CreateResourceWatchParams): Promise<IRemoteWatchHandle>;
}

export const IAgentHostService = createDecorator<IAgentHostService>('agentHostService');

export interface IAgentHostService extends IAgentConnection {

	readonly _serviceBrand: undefined;

	readonly onAgentHostExit: Event<number>;
	readonly onAgentHostStart: Event<void>;

	readonly authenticationPending: IObservable<boolean>;

	setAuthenticationPending(pending: boolean): void;

	startAgentHost(): void;

	restartAgentHost(): Promise<void>;

	startWebSocketServer(): Promise<IAgentHostSocketInfo>;

	getInspectInfo(tryEnable: boolean): Promise<IAgentHostInspectInfo | undefined>;
}
