/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { open, unlink, type FileHandle } from 'fs/promises';
import { decodeBase64, encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { Barrier, DeferredPromise, disposableTimeout, Limiter, ResourceQueue } from '../../../base/common/async.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableResourceMap, DisposableStore, IDisposable, IReference, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { getExtensionForMimeType, getMediaMime, getMediaOrTextMime } from '../../../base/common/mime.js';
import { Schemas } from '../../../base/common/network.js';
import { dirname as resourcesDirname, extname as resourcesExtname, extUriBiasedIgnorePathCase, isEqual, isEqualOrParent, joinPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { hasKey } from '../../../base/common/types.js';
import { localize } from '../../../nls.js';
import { FileChangeType, FileOperationResult, IFileChange, IFileService, toFileOperationResult, type FileChangesEvent } from '../../files/common/files.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { AgentChatMigrationDeferred, AgentProvider, AgentSession, AgentSignal, IAgent, type IAgentAdoptedWorktree, IAgentChatContext, IAgentChatDataChange, IAgentChatMetadata, IAgentCreateChatOptions, IAgentCreateChatRequestOptions, IAgentCreateChatResult, IAgentCreateChatSideChatSelection, IAgentCreateChatSideChatSource, IAgentCreateSessionConfig, IAgentCreateSessionResult, IAgentDiscoveredChat, IAgentMaterializeChatEvent, IAgentModelInfo, IAgentResolveSessionConfigParams, IAgentChatAdoptionResult, type AgentChatAdoptionReason, IAgentSessionConfigCompletionsParams, IAgentSessionMetadata, IAgentSpawnChatEvent, AuthenticateParams, AuthenticateResult, SubagentChatSignal, subagentChatTitle } from '../common/agent.js';
import { type AgentHostDebugLogsArtifactKind, type IAgentHostDebugLogsArtifact, type IAgentHostDebugLogsChunk, IAgentHostManagedSettingsDiagnostics, IAgentHostNetworkDiagnosticsInfo, IAgentHostNetworkFetchResult, IAgentService } from '../common/agentService.js';
import { ISessionDatabase, ISessionDataService, SESSION_ATTACHMENTS_DIRNAME } from '../common/sessionDataService.js';
import { IAgentEditAttributionService, ICancelEditAttributionFlushParams, ICommitEditAttributionFlushParams, IEditAttributionFlushResult, IPrepareEditAttributionFlushParams, IPreparedEditAttributionFlush, parseEditAttributionResource } from '../common/fileEditAttribution.js';
import { omitTransientSessionConfigValues, SessionConfigKey } from '../common/sessionConfigKeys.js';
import type { IAgentCustomizationSettingsRegistration } from '../common/agentCustomizationSettings.js';
import { buildAnnotationsUri, parseAnnotationsUri } from '../common/annotationsUri.js';
import { AGENT_HOST_AUTOMATION_MIGRATION_CONFIG_KEY, isAgentHostAutomationMigrationCompletion } from '../common/automationMigration.js';
import { parseChangesetUri } from '../common/changesetUri.js';
import { ActionType, ActionEnvelope, AuthRequiredReason, INotification, isAnnotationsAction, isPassiveSessionMetadataAction, isSessionAction, type ChatAction, type ClientAutomationAction, type ClientAutomationRunAction, type IIsArchivedChangedAction, type IIsReadChangedAction, type IRootConfigChangedAction, type SessionAction, type SessionWorkingDirectoryAction, type TerminalAction, type ClientAnnotationsAction, type ClientChangesetAction } from '../common/state/sessionActions.js';
import { resolveSessionWorkingDirectoryAction } from '../common/state/sessionWorkingDirectories.js';
import type { CompletionsParams, CompletionsResult, CreateTerminalParams, ResolveSessionConfigResult, SessionConfigCompletionsResult, SessionConfigPropertySchema } from '../common/state/protocol/commands.js';
import type { AutomationCapabilities } from '../common/state/protocol/common/commands.js';
import type { FetchAutomationRunsParams, FetchAutomationRunsResult, ListAutomationTriggerDefinitionsParams, ListAutomationTriggerDefinitionsResult, RunAutomationParams, RunAutomationResult } from '../common/state/protocol/channels-automation/commands.js';
import type { InvokeChangesetOperationParams, InvokeChangesetOperationResult } from '../common/state/protocol/channels-changeset/commands.js';
import { AhpErrorCodes, AHP_SESSION_NOT_FOUND, ContentEncoding, JSON_RPC_INTERNAL_ERROR, ProtocolError, ResourceChangeType, ResourceType, ResourceWriteMode, type CreateResourceWatchParams, type CreateResourceWatchResult, type DirectoryEntry, type ResourceCopyParams, type ResourceCopyResult, type ResourceDeleteParams, type ResourceDeleteResult, type ResourceListResult, type ResourceMkdirParams, type ResourceMkdirResult, type ResourceMoveParams, type ResourceMoveResult, type ResourceReadResult, type ResourceResolveParams, type ResourceResolveResult, type ResourceWatchState, type ResourceWriteParams, type ResourceWriteResult, type IStateSnapshot } from '../common/state/sessionProtocol.js';
import { ChangesSummary, ChatInteractivity, ChatOriginKind, MessageAttachmentKind, type Annotation, type AnnotationEntry, type AnnotationOrigin, type AnnotationsState, type ChatOrigin, type Customization, type Message, type MessageAttachment, type MessageResourceAttachment, type TextRange } from '../common/state/protocol/state.js';
import type { ChatPendingMessageSetAction, ChatTurnStartedAction, SessionConfigChangedAction } from '../common/state/protocol/actions.js';
import { isAhpAutomationCatalogChannel, isAhpAutomationRunChannel, ISessionGitHubState, ISessionGitState, MessageKind, ResponsePartKind, SESSION_META_GITHUB_KEY, SESSION_META_GIT_KEY, SESSION_META_MULTI_ROOT_KEY, SESSION_META_SOURCE_CONTROL_KEY, AH_META_CREATED_BY_SESSION_DB_KEY, readSessionCreationReference, readSessionSpawnDepth, withSessionSpawnDepth, withSessionCreationReference, parseSessionCreationReference, SessionLifecycle, SessionStatus, ToolCallStatus, ToolResultContentType, TurnState, AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY, AH_META_WORKSPACE_CONVERSION_QUARANTINED_DB_KEY, AH_META_WORKSPACELESS_DB_KEY, AH_META_EHCLI_ADOPTED_DB_KEY, AH_META_IS_ARCHIVED_DB_KEY, AH_META_IS_DONE_DB_KEY, AH_META_IS_READ_DB_KEY, buildChatUri, buildDefaultChatUri, buildResourceWatchChannelUri, buildSubagentChatUri, buildSubagentSessionUriPrefix, chatStorageUri, getErrorResponsePart, isAhpChatChannel, isChatReadOnly, isDefaultChatUri, isSubagentChatUri, isSubagentSession, needsSessionGitStateRefresh, parseChatUri, parseDefaultChatUri, parseRequiredSessionUriFromChatUri, parseResourceWatchChannelUri, parseSessionMultiRootMetadata, parseSubagentSessionUri, readSessionExternal, readSessionGitHubState, readSessionGitState, readSessionMultiRootMetadata, readSessionSourceControlState, readSessionWorkspaceless, withMessageRequestHiddenFromTranscript, withSessionExternal, withSessionGitHubState, withSessionGitState, withSessionHasWorkspaceTransitions, withSessionMultiRootMetadata, withSessionSourceControlState, withSessionStatusFlag, withSessionWorkspaceless, withSessionEhcliAdopted, withSessionEhcliLastMigratedTurn, AH_META_EHCLI_LAST_TURN_DB_KEY, withSessionFolderPickerDecision, readSessionFolderPickerDecision, parseSessionFolderPickerDecision, SESSION_META_FOLDER_PICKER_KEY, readSessionEhcliAdoptable, type ISessionSourceControlState, type SessionConfigState, type SessionSummary, type ToolResultSubagentContent, type Turn } from '../common/state/sessionState.js';
import { readToolCallMeta } from '../common/meta/agentToolCallMeta.js';
import { isHostSnapshotAttachment, toHostSnapshotAttachmentMeta } from '../common/meta/agentSnapshotAttachmentMeta.js';
import { readEphemeralSessionMeta, withEphemeralSessionMeta } from '../common/meta/agentEphemeralSessionMeta.js';
import { IAgentMessageDelegationMeta, toAgentMessageDelegationMeta } from '../common/meta/agentMessageDelegationMeta.js';
import { toAgentMergeMessageMeta } from '../common/meta/agentMergeMessageMeta.js';
import { readChatSurfaceMeta, withChatSurfaceMeta } from '../common/meta/agentChatSurfaceMeta.js';
import { AH_META_DEV_CONTAINER_WORKTREE_DB_KEY, readAgentDevContainerWorktreeMetadata, withAgentDevContainerWorktreeMetadata } from '../common/meta/agentDevContainerWorktreeMeta.js';
import { AgentConfigurationService, getEffectiveWorkingDirectories } from './agentConfigurationService.js';
import { IAgentHostTerminalManager } from './agentHostTerminalManager.js';
import { ISessionDbUriFields, parseSessionDbUri } from '../common/sessionDbUri.js';
import { IGitBlobUriFields, parseGitBlobUri } from './gitDiffContent.js';
import { resolveSessionRepositories } from './agentHostSessionRepositories.js';
import { findDeepestContainingWorkingDirectory, isMultiRootSession } from '../common/agentHostWorkingDirectories.js';
import { AgentHostStateManager } from './agentHostStateManager.js';
import { AgentHostAutomationService } from './agentHostAutomationService.js';
import { createAgentChatContext } from './agentChatContext.js';
import { AgentHostDebugLogsCollector, type IAgentHostDebugLogsEnvironment } from './agentHostDebugLogs.js';
import { IAgentHostDatabase } from './agentHostDatabase.js';
import { AgentSessionRegistry, IRegisteredSession, IStoredRegisteredSession } from './agentSessionRegistry.js';
import { IAgentHostGitService } from '../common/agentHostGitService.js';
import { IAgentHostSubscriptionService, resolveAgentHostSession } from '../common/agentHostSubscriptionService.js';
import { AgentSideEffects, type IAgentSideEffectsOptions } from './agentSideEffects.js';
import { AgentHostLocalTurns } from './agentHostLocalTurns.js';
import { AgentSessionResidency } from './agentSessionResidency.js';
import { IAgentHostSessionOpenTelemetry, type IAgentHostSessionOpenTelemetryScope } from './agentHostSessionOpenTelemetry.js';
import { AgentServerToolHost } from './shared/agentServerToolHost.js';
import { type IAgentServiceSessionServerToolAccessor, type IChatContextSnapshot, type IRenameTitleResult, type ISessionCreationDefaults, validateRenameTitle } from './shared/sessionServerTools.js';
import { AGENT_HOST_TITLE_SOURCE_AGENT, customChatTitleMetadataKey, customChatTitleSourceMetadataKey, persistSessionMetadata, persistSessionMetadataValues, SESSION_ARTIFACTS_KEY, SESSION_CUSTOM_TITLE_KEY, SESSION_CUSTOM_TITLE_SOURCE_KEY } from './shared/persistSessionMetadata.js';
import { type IArtifactServerToolAccessor } from './shared/artifactServerTools.js';
import { parseSessionArtifacts, stringifySessionArtifacts, withSessionArtifacts, type ISessionArtifact } from '../common/sessionArtifacts.js';

import { buildWorktreeFailureNotification, IAgentHostWorktreeIsolation, WORKTREE_META_REPOSITORY_ROOT, worktreeProjectFromRepositoryRoot } from './shared/worktreeIsolation.js';
import { IAgentHostProviderService } from './agentHostProviderService.js';
import { IAgentHostCheckpointService } from '../common/agentHostCheckpointService.js';
import { IAgentHostReviewService } from '../common/agentHostReviewService.js';
import { AgentHostChangesetCoordinator } from './agentHostChangesetCoordinator.js';
import { IAgentHostCompletions } from './agentHostCompletions.js';
import { AgentHostSkillCompletionProvider } from './agentHostSkillCompletionProvider.js';
import { SessionServerToolName } from '../common/serverToolNames.js';
import { IDardcorRouterService } from './shared/dardcorRouterService.js';
import { INetworkDiagnosticsService } from './networkDiagnosticsService.js';
import { toAgentClientUri } from '../common/agentClientUri.js';
import { AgentHostClientType } from '../common/agentHostClientInfo.js';
import { resolveLastNonLocalTurnId } from '../common/agentHostConversationContext.js';
import { AgentHostLaunchKind, createUnknownAgentHostClientTelemetryContext, type IAgentHostClientTelemetryContext } from '../common/agentHostTelemetry.js';
import { IAgentHostGitHubEndpointService } from './agentHostGitHubEndpointService.js';
import { AgentMergeController, type IAgentMergeControllerOptions } from './agentMergeController.js';
import { AgentMergeConfigKey, agentMergeRootConfigSchema, getNonMergeSessionConfigValues, readAgentMergeSessionState } from '../common/agentMerge.js';
import { AgentSystemNotificationKind, toAgentSystemNotificationMeta } from '../common/meta/agentSystemNotificationMeta.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AgentHostAuthenticationService } from './agentHostAuthenticationService.js';
import { updateAgentHostTelemetryLevelFromConfig } from './agentHostTelemetryService.js';
import type { IAgentHostCopilotSkuClassification, IAgentHostCopilotSkuTelemetry } from './agentHostTelemetryReporter.js';
import { AgentHostActiveAgentTitleGenerationConfigKey, AgentHostArtifactToolsConfigKey, AgentHostEditTelemetryEnabledConfigKey, AgentHostExternalSessionsMode, AgentHostMigrateLegacyCopilotCliEnabledConfigKey, AgentHostShowExternalSessionsConfigKey, platformRootSchema } from '../common/agentHostSchema.js';
import { IAgentHostChangesetService, CHANGESET_DB_METADATA_KEYS, META_CHANGES_SUMMARY } from '../common/agentHostChangesetService.js';
import { GIT_DB_METADATA_KEYS, IAgentHostGitStateService, META_GIT_STATE, META_GITHUB_STATE, META_SOURCE_CONTROL_STATE } from '../common/agentHostGitStateService.js';
import { IAgentHostChangesetOperationService } from '../common/agentHostChangesetOperationService.js';
import { IAgentHostChatContributions } from '../common/agentHostChatContributionsService.js';
import { IAgentHostTurnService } from './agentHostTurnService.js';
import { IAgentHostStorageService } from './agentHostStorageService.js';

const SESSION_GC_GRACE_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXTERNAL_SESSION_MAX_AGE_MS = 30 * DAY_MS;
const RECENT_EXTERNAL_SESSION_LIMIT = 2;
const RECENT_LOCAL_SESSION_UPDATE_LIMIT = 2;
const RECENT_LOCAL_SESSION_UPDATES_STORAGE_KEY = 'recentLocalSessionUpdates';
const SLOW_LIST_SESSIONS_THRESHOLD_MS = 1_000;

interface IRecentLocalSessionUpdate {
	readonly session: string;
	readonly modifiedTime: number;
}

interface ISessionListComputation {
	readonly epoch: number;
	readonly promise: Promise<readonly IAgentSessionMetadata[]>;
	trailing?: Promise<readonly IAgentSessionMetadata[]>;
}

type AgentHostLegacyMigrationEvent = IAgentHostCopilotSkuTelemetry & {
	provider: string;
	outcome: 'migrated' | 'skipped' | 'failed';
	success: boolean;
	turnCount: number;
	durationMs: number;
	hasProject: boolean;
	hasWorktree: boolean;
	workingDirectoryCount: number;
	errorMessage: string | undefined;
	reason: string;
};

type AgentHostLegacyMigrationClassification = IAgentHostCopilotSkuClassification & {
	provider: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The agent provider id whose legacy session was migrated (e.g. copilotcli).' };
	outcome: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Migration outcome: migrated (adoption + restore completed), skipped (eligible legacy session not adopted this pass, e.g. migrate flag not yet applied), or failed (adoption or restore threw).' };
	success: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether the migration completed with at least one restored turn.' };
	turnCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Number of turns restored from the migrated session.' };
	durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Time in milliseconds to adopt and restore the legacy session.' };
	hasProject: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether the migrated session resolved to a project/repository.' };
	hasWorktree: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether the migrated session ran in a pre-existing git worktree that was bridged during adoption.' };
	workingDirectoryCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Number of working directories associated with the migrated session.' };
	errorMessage: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'Error message when the migration failed; absent for migrated/skipped outcomes.' };
	reason: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Why adoption ended as it did: adopted, alreadyNative, notLegacyChat, workingDirectoryMissing, or unknown. Separates a skipped session that was never ours from one whose working directory vanished, which need different fixes.' };
	owner: 'vijayupadya';
	comment: 'Tracks one-time adopt-on-open migration of legacy extension-host Copilot CLI sessions into the agent host to measure attempt, success, failure, and skipped rates.';
};

const HOST_OWNED_SESSION_CONFIG_KEYS = [
	SessionConfigKey.AgentMerge,
	SessionConfigKey.AgentMergeController,
	SessionConfigKey.Isolation,
	SessionConfigKey.Branch,
	SessionConfigKey.WorktreeBranchPrefix,
	SessionConfigKey.WorktreeIncludeFiles,
	SessionConfigKey.WorktreeBranchTrack,
	SessionConfigKey.WorktreeCreateNewBranch,
] as const;

const HOST_WRITTEN_SESSION_CONFIG_KEYS = [
	SessionConfigKey.AgentMergeController,
] as const;

function omitHostOwnedSessionConfig<T>(config: Record<string, T>): Record<string, T> {
	const result = { ...config };
	for (const key of HOST_OWNED_SESSION_CONFIG_KEYS) {
		delete result[key];
	}
	return result;
}

function parsePersistedSourceControlState(value: string): ISessionSourceControlState {
	const state = readSessionSourceControlState({
		[SESSION_META_SOURCE_CONTROL_KEY]: JSON.parse(value),
	});
	if (!state) {
		throw new Error('Invalid persisted source-control state');
	}
	return state;
}

const RESOURCE_WATCH_GRACE_MS = 30_000;

const SUBAGENT_CHAT_PENDING_TIMEOUT_MS = 15_000;

const PEER_CHATS_METADATA_KEY = 'peerChats';
const ANNOTATIONS_METADATA_KEY = 'annotations';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isRecentLocalSessionUpdate(value: unknown): value is IRecentLocalSessionUpdate {
	return isRecord(value)
		&& typeof value.session === 'string'
		&& Number.isFinite(value.modifiedTime);
}

function isPersistedAnnotationEntry(value: unknown): value is AnnotationEntry {
	if (!isRecord(value) || typeof value.id !== 'string') {
		return false;
	}
	return typeof value.text === 'string'
		|| (isRecord(value.text) && typeof value.text.markdown === 'string');
}

function isPersistedAnnotationOrigin(value: unknown): value is AnnotationOrigin {
	return isRecord(value)
		&& typeof value.session === 'string'
		&& (value.chat === undefined || typeof value.chat === 'string')
		&& (value.turnId === undefined || typeof value.turnId === 'string');
}

function isPersistedTextRange(value: unknown): value is TextRange {
	return isRecord(value)
		&& isRecord(value.start) && typeof value.start.line === 'number' && typeof value.start.character === 'number'
		&& isRecord(value.end) && typeof value.end.line === 'number' && typeof value.end.character === 'number';
}

function readPersistedAnnotation(value: unknown, session: string): Annotation | undefined {
	if (!isRecord(value)
		|| typeof value.id !== 'string'
		|| typeof value.resource !== 'string'
		|| typeof value.resolved !== 'boolean'
		|| !Array.isArray(value.entries)
		|| value.entries.length === 0
		|| !value.entries.every(isPersistedAnnotationEntry)) {
		return undefined;
	}
	let origin: AnnotationOrigin;
	if (isPersistedAnnotationOrigin(value.origin)) {
		origin = value.origin;
	} else if (value.origin === undefined) {
		origin = { session, ...(typeof value.turnId === 'string' && value.turnId ? { turnId: value.turnId } : {}) };
	} else {
		return undefined;
	}
	const annotation: Annotation = {
		id: value.id,
		origin,
		resource: value.resource,
		resolved: value.resolved,
		entries: value.entries,
	};
	if (isPersistedTextRange(value.range)) {
		annotation.range = value.range;
	}
	if (isRecord(value._meta)) {
		annotation._meta = value._meta;
	}
	return annotation;
}

function readPersistedAnnotationsState(value: unknown, session: string): AnnotationsState | undefined {
	if (!isRecord(value) || !Array.isArray(value.annotations)) {
		return undefined;
	}
	const annotations: Annotation[] = [];
	for (const entry of value.annotations) {
		const annotation = readPersistedAnnotation(entry, session);
		if (!annotation) {
			return undefined;
		}
		annotations.push(annotation);
	}
	return { annotations };
}

const DEFAULT_CHAT_PROVIDER_DATA_METADATA_KEY = 'defaultChatProviderData';

const CHAT_BACKING_METADATA_KEY = 'peerChatBacking';

interface IPersistedPeerChat {
	readonly uri: string;
	readonly providerData?: string;
	readonly origin?: ChatOrigin;
	readonly inheritedTurnId?: string;
}

interface IProviderDiscoveryState {
	promise: Promise<void>;
	forceQueued: boolean;
}

class ProviderCatalogUnavailableError extends Error {
	constructor(readonly provider: AgentProvider) {
		super(`Provider ${provider} cannot enumerate its native session catalog yet`);
		this.name = 'ProviderCatalogUnavailableError';
	}
}

class SubagentTranscriptUnavailableError extends Error {
	constructor(chat: string) {
		super(`Subagent transcript is not available yet: ${chat}`);
		this.name = 'SubagentTranscriptUnavailableError';
	}
}

function reconcileWorkingDirectories(requested: readonly URI[] | undefined, resolved: readonly URI[] | undefined): string[] | undefined {
	if (resolved === undefined) {
		return requested?.map(d => d.toString());
	}
	const tail = (requested ?? []).slice(resolved.length);
	return [...resolved, ...tail].map(d => d.toString());
}

export interface IAgentServiceOptions {
	readonly rootConfigResource?: URI;
	readonly dardcorRouterService?: IDardcorRouterService;
	readonly providerConfigurations?: readonly IAgentCustomizationSettingsRegistration[];
	readonly hostLaunchKind?: AgentHostLaunchKind;
	readonly storageResource?: URI;
	readonly orchestratorDatabase?: IAgentHostDatabase;
	readonly debugLogsEnvironment?: IAgentHostDebugLogsEnvironment;
	readonly sessionResidencyLimit?: number;
	readonly sessionReleaseRetryMs?: number;
}

export interface IAgentServiceCallbacks {
	readonly canEvictChangeset: (changeset: string) => boolean;
	readonly startAgentMergeTurn: IAgentMergeControllerOptions['startTurn'];
	readonly cancelAgentMergeTurn: IAgentMergeControllerOptions['cancelTurn'];
	readonly postAgentMergeNotice: IAgentMergeControllerOptions['postNotice'];
	readonly resolveWorkingDirectoryBeforeSend: NonNullable<IAgentSideEffectsOptions['resolveWorkingDirectoryBeforeSend']>;
	readonly resolveChatAttachmentTurns: NonNullable<IAgentSideEffectsOptions['resolveChatAttachmentTurns']>;
	readonly sessionServerToolAccessor: IAgentServiceSessionServerToolAccessor;
	readonly artifactServerToolAccessor: IArtifactServerToolAccessor;
}

export interface IAgentServiceCallbackBinder {
	bind(callbacks: IAgentServiceCallbacks): void;
}

export interface IAgentServiceCollaborators {
	readonly gitHubEndpointService: IAgentHostGitHubEndpointService;
	readonly gitStateService: IAgentHostGitStateService;
	readonly agentMergeController: AgentMergeController;
	readonly checkpointService: IAgentHostCheckpointService;
	readonly changesetOperationService: IAgentHostChangesetOperationService;
	readonly reviewService: IAgentHostReviewService;
	readonly changesets: IAgentHostChangesetService;
	readonly changesetCoordinator: AgentHostChangesetCoordinator;
	readonly completions: IAgentHostCompletions;
	readonly terminalManager: IAgentHostTerminalManager;
	readonly localTurns: AgentHostLocalTurns;
	readonly sideEffects: AgentSideEffects;
	readonly serverToolHost: AgentServerToolHost;
}

export interface IAgentServiceCore {
	readonly disposables: DisposableStore;
	readonly authenticationService: AgentHostAuthenticationService;
	readonly orchestratorDatabase: IAgentHostDatabase;
	readonly debugLogsCollector: AgentHostDebugLogsCollector | undefined;
	readonly sessionRegistry: AgentSessionRegistry;
	readonly stateManager: AgentHostStateManager;
	readonly configurationService: AgentConfigurationService;
	readonly callbackBinder: IAgentServiceCallbackBinder;
}

export class AgentService extends Disposable implements IAgentService {
	declare readonly _serviceBrand: undefined;

	private readonly _resourceWriteQueue = this._register(new ResourceQueue());

	private readonly _onDidAction = this._register(new Emitter<ActionEnvelope>());
	readonly onDidAction = this._onDidAction.event;

	private readonly _onDidNotification = this._register(new Emitter<INotification>());
	readonly onDidNotification = this._onDidNotification.event;

	readonly onMcpNotification: IAgentService['onMcpNotification'];

	private readonly _stateManager: AgentHostStateManager;

	private readonly _sessionRegistry: AgentSessionRegistry;
	private readonly _orchestratorDatabase: IAgentHostDatabase;
	private _sessionModifiedTimeWrites: Promise<void> = Promise.resolve();
	private readonly _recentLocalSessionUpdateSnapshot: readonly IRecentLocalSessionUpdate[];
	private _recentLocalSessionUpdates: readonly IRecentLocalSessionUpdate[];

	private readonly _providerMigrations = new Map<AgentProvider, IProviderDiscoveryState>();
	private readonly _initialProviderMigrations = new Map<AgentProvider, Promise<void>>();
	private readonly _deferredProviderMigrations = new Set<AgentProvider>();
	private readonly _readableProviderCatalogs = new Set<AgentProvider>();

	private readonly _unpersistedChatBackings = new Set<string>();

	private readonly _downloadProgressInterest = new Map<AgentProvider, Set<string>>();
	private readonly _providerSubscriptions = this._register(new DisposableMap<AgentProvider, DisposableStore>());
	private readonly _peerChatCatalogWrites = new Map<string, Promise<void>>();
	private readonly _disposingPeerChats = new Set<string>();
	private readonly _defaultChatBackingWrites = new Map<string, Promise<void>>();
	private readonly _sideEffects: AgentSideEffects;
	private readonly _agentMergeController: AgentMergeController;
	private readonly _changesets: IAgentHostChangesetService;
	private readonly _changesetOperationService: IAgentHostChangesetOperationService;
	private readonly _reviewService: IAgentHostReviewService;
	private readonly _changesetCoordinator: AgentHostChangesetCoordinator;
	private readonly _gitStateService: IAgentHostGitStateService;
	private readonly _terminalManager: IAgentHostTerminalManager;
	private readonly _localTurns: AgentHostLocalTurns;
	private readonly _serverToolHost: AgentServerToolHost;
	private readonly _debugLogsCollector: AgentHostDebugLogsCollector | undefined;
	private readonly _configurationService: AgentConfigurationService;
	private readonly _automationService: AgentHostAutomationService;
	private readonly _checkpointService: IAgentHostCheckpointService;
	private readonly _gitHubEndpointService: IAgentHostGitHubEndpointService;
	private readonly _completions: IAgentHostCompletions;
	private _skillCompletionProviderRegistered = false;
	private readonly _restoreSessionInFlight = new Map<string, Promise<void>>();
	private readonly _restoreSubagentInFlight = new Map<string, Promise<void>>();
	private readonly _sessionResidency: AgentSessionResidency;

	private readonly _restoreAnnotationsInFlight = new Map<string, Promise<void>>();

	private readonly _pendingSubagentChats = new Map<string , DeferredPromise<void>>();
	private readonly _pendingSubagentChatTimeouts = this._register(new DisposableMap<string , IDisposable>());
	private readonly _pendingSubagentToolCalls = new Map<string, string >();

	private readonly _pendingSessionGc = this._register(new DisposableResourceMap<IDisposable>());

	private readonly _resourceWatches = this._register(new DisposableMap<string, IActiveResourceWatch>());

	constructor(
		core: IAgentServiceCore,
		collaborators: IAgentServiceCollaborators,
		options: IAgentServiceOptions,
		@ILogService private readonly _logService: ILogService,
		@IFileService private readonly _fileService: IFileService,
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
		@IAgentHostGitService private readonly _gitService: IAgentHostGitService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IAgentHostSessionOpenTelemetry private readonly _sessionOpenTelemetry: IAgentHostSessionOpenTelemetry,
		@IAgentHostChatContributions private readonly _chatContributions: IAgentHostChatContributions,
		@IAgentHostSubscriptionService private readonly _subscriptions: IAgentHostSubscriptionService,
		@INetworkDiagnosticsService private readonly _networkDiagnostics: INetworkDiagnosticsService,
		@IAgentEditAttributionService private readonly _editAttributionService: IAgentEditAttributionService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAgentHostWorktreeIsolation private readonly _worktree: IAgentHostWorktreeIsolation,
		@IAgentHostProviderService private readonly _providerService: IAgentHostProviderService,
		@IAgentHostTurnService private readonly _turnService: IAgentHostTurnService,
		@IAgentHostStorageService private readonly _storageService: IAgentHostStorageService,
	) {
		super();
		this._orchestratorDatabase = core.orchestratorDatabase;
		this._debugLogsCollector = core.debugLogsCollector;
		this._sessionRegistry = core.sessionRegistry;
		this._stateManager = core.stateManager;
		this._configurationService = core.configurationService;
		this._recentLocalSessionUpdateSnapshot = this._readRecentLocalSessionUpdates();
		this._recentLocalSessionUpdates = this._recentLocalSessionUpdateSnapshot;
		this.onMcpNotification = this._providerService.onMcpNotification;
		this._gitHubEndpointService = collaborators.gitHubEndpointService;
		this._gitStateService = collaborators.gitStateService;
		this._agentMergeController = collaborators.agentMergeController;
		this._checkpointService = collaborators.checkpointService;
		this._changesetOperationService = collaborators.changesetOperationService;
		this._reviewService = collaborators.reviewService;
		this._changesets = collaborators.changesets;
		this._changesetCoordinator = collaborators.changesetCoordinator;
		this._completions = collaborators.completions;
		this._terminalManager = collaborators.terminalManager;
		this._localTurns = collaborators.localTurns;
		this._sideEffects = collaborators.sideEffects;
		this._serverToolHost = collaborators.serverToolHost;
		this._automationService = this._register(instantiationService.createInstance(AgentHostAutomationService, {
			isSessionTemplateAvailable: template => this._providerService.resolveProvider(template.provider) !== undefined,
			createSession: (template, run) => this.createSession({
				provider: template.provider,
				model: template.model,
				agent: template.agent,
				workingDirectories: template.workingDirectories?.map(resource => URI.parse(resource)),
				config: template.config,
				_meta: {
					automation: run.automation,
					automationRun: run.resource,
				},
			}),
			startSession: (session, message) => this._startAutomationMessage(session, message),
			cancelSession: session => this._cancelAutomationSession(session),
		}));
		this._register(this._providerService.registerProviderInitializer(provider => this._initializeProvider(provider)));
		this._register(this._providerService.onDidRegisterProvider(provider => this._onDidRegisterProvider(provider)));
		this._sessionResidency = this._register(instantiationService.createInstance(
			AgentSessionResidency,
			this._stateManager,
			{
				isReleaseBlocked: session => this._restoreSessionInFlight.has(session.toString()),
				whenSessionDataIdle: session => this._whenSessionDataIdle(session),
				getSessionChats: session => this._getSessionChatsInTeardownOrder(session),
				createRelease: session => {
					const provider = this._providerService.getProviderForSession(session);
					return provider ? {
						canRelease: chats => this._canReleaseSession(provider, session, chats),
						release: chats => this._releaseSession(provider, session, chats),
					} : undefined;
				},
				evictSessionState: (session, chats) => this._evictSessionState(session, session.toString(), session.toString(), chats.map(chat => chat.toString())),
			},
			{
				limit: options.sessionResidencyLimit,
				releaseRetryMs: options.sessionReleaseRetryMs,
				holdsSession: session => this._agentMergeController.holdsSession(session),
				onDidReleaseHold: this._agentMergeController.onDidReleaseHold,
			},
		));
		core.callbackBinder.bind({
			canEvictChangeset: changeset => this._canEvictChangeset(changeset),
			startAgentMergeTurn: (session, turnId, prompt) => this._startAgentMergePrompt(session, turnId, prompt),
			cancelAgentMergeTurn: (session, turnId) => this._cancelAgentMergePrompt(session, turnId),
			postAgentMergeNotice: (session, kind, content) => this._postAgentMergeNotice(session, kind, content),
			resolveWorkingDirectoryBeforeSend: params => this._resolveWorkingDirectoryBeforeSend(params),
			resolveChatAttachmentTurns: resource => this._resolveChatAttachmentTurns(resource),
			sessionServerToolAccessor: this._createSessionServerToolAccessor(),
			artifactServerToolAccessor: this._createArtifactServerToolAccessor(),
		});
		this._logService.info('AgentService initialized');
		this._register(this._stateManager.onDidEmitEnvelope(e => this._onDidAction.fire(e)));
		this._register(this._stateManager.onDidEmitEnvelope(e => this._trackPendingSubagentChatFromEnvelope(e)));
		this._register(this._stateManager.onDidEmitEnvelope(e => this._persistAnnotations(e)));
		this._register(this._stateManager.onDidEmitEnvelope(e => {
			if (e.action.type === ActionType.SessionIsArchivedChanged && e.action.isArchived && !isAhpChatChannel(e.channel)) {
				this._clearAgentMergeIndex(URI.parse(e.channel));
				void this._sessionResidency.reconcile();
			}
		}));
		this._register(this._stateManager.onDidEmitNotification(e => this._onDidNotification.fire(e)));
		this._register(this._stateManager.onDidChangeSessionActiveTurn(({ session, active }) => {
			if (!active) {
				this._flushAgentMergeNotices(session);
			}
		}));
		this._register(this._stateManager.onDidRemoveSession(session => this._pendingAgentMergeNotices.delete(session)));
		this._register(this._stateManager.onDidChangeSessionSummary(({ session, changes }) => {
			const meta = this._stateManager.getSessionSummary(session)?._meta;
			if (changes.modifiedAt !== undefined) {
				const modifiedTime = Date.parse(changes.modifiedAt);
				if (!readSessionExternal(meta)
					&& !isSubagentSession(session)
					&& !this._stateManager.isEphemeralSession(session)
					&& !this._stateManager.isIdleProvisionalSession(session)) {
					this._recordRecentLocalSessionUpdate(URI.parse(session), modifiedTime);
				}
				this._writeSessionModifiedTime(URI.parse(session), modifiedTime);
			}
			if (changes.modifiedAt !== undefined
				&& this._getExternalSessionsMode() === AgentHostExternalSessionsMode.Recent
				&& readSessionExternal(meta)
				&& !readSessionEhcliAdoptable(meta)) {
				this._queueSessionListReconciliation();
			}
		}));
		updateAgentHostTelemetryLevelFromConfig(this._telemetryService, this._stateManager.rootState.config?.values);
		this._register(this._stateManager.onDidChangeSessionConfig(({ session, previous, current }) => this._syncAgentMergeIndex(URI.parse(session), previous, current)));
		let externalSessionsMode = this._getExternalSessionsMode();
		let agentMergeEnabled = this._isAgentMergeEnabled();
		this._register(this._configurationService.onDidRootConfigChange(() => {
			const nextMode = this._getExternalSessionsMode();
			if (nextMode !== externalSessionsMode) {
				const previousMode = externalSessionsMode;
				externalSessionsMode = nextMode;
				this._logService.info(`[AgentService] ${AgentHostShowExternalSessionsConfigKey} changed '${previousMode}' -> '${nextMode}'; queueing session list reconciliation`);
				if (this._startupSettled.isOpen() && this._hidesAllExternalSessions(previousMode) && !this._hidesAllExternalSessions(nextMode)) {
					for (const provider of this._providerService.getProviders()) {
						this._startChatDiscovery(provider, 'external sessions were enabled');
					}
				}
				this._queueSessionListReconciliation(previousMode);
			}
			const nextAgentMergeEnabled = this._isAgentMergeEnabled();
			if (nextAgentMergeEnabled !== agentMergeEnabled) {
				agentMergeEnabled = nextAgentMergeEnabled;
				for (const session of this._stateManager.getSessionUris()) {
					this._serverToolHost.advertise(session);
				}
				if (nextAgentMergeEnabled) {
					this._agentMergeRestore = this._agentMergeRestore
						.then(() => this._restoreAgentMergeMonitoredSessions())
						.catch(err => this._logService.warn('[AgentService] Failed to restore Agent-Merge-enabled sessions', err));
				}
			}
		}));
		this._register(this._gitHubEndpointService.onDidChange(() => {
			this._stateManager.emitAuthRequired({
				resource: this._gitHubEndpointService.getCopilotResource(),
				reason: AuthRequiredReason.Required,
			});
		}));
		this._editAttributionService.setEnabled(this._stateManager.rootState.config?.values[AgentHostEditTelemetryEnabledConfigKey] !== false);
		this._runWhenStartupSettled('external session prune', () => this._pruneStaleExternalSessions());
		this._register(core.disposables);
	}

	private readonly _startupSettled = new Barrier();
	private _hostStartupComplete = false;
	private _firstListingServed = false;
	private _deferredWork = Promise.resolve();

	markStartupComplete(): void {
		if (this._hostStartupComplete) {
			return;
		}
		this._hostStartupComplete = true;
		this._openStartupSettled();
	}

	private _openStartupSettled(): void {
		if (this._hostStartupComplete && this._firstListingServed) {
			this._startupSettled.open();
		}
	}

	private _runWhenStartupSettled(name: string, work: () => void | Promise<void>): void {
		this._deferredWork = this._deferredWork
			.then(() => this._startupSettled.wait())
			.then(() => this._store.isDisposed ? undefined : work())
			.catch(error => this._logService.warn(`[AgentService] Deferred work '${name}' failed`, error));
	}

	async whenDeferredWorkSettled(): Promise<void> {
		await this._deferredWork;
	}

	private async _pruneStaleExternalSessions(): Promise<void> {
		const now = Date.now();
		const registered = await this._listRegisteredSessions();
		const staleExternalSessions: URI[] = [];
		for (const entry of registered) {
			if (!entry.external) {
				continue;
			}
			const provider = this._providerService.getProvider(entry.provider);
			if (!provider) {
				continue;
			}
			let metadata: IAgentSessionMetadata | undefined;
			try {
				metadata = await this._registeredSessionMetadata(provider, entry.session, true);
			} catch (error) {
				this._logService.warn(`[AgentService] Failed to load metadata while pruning stale external session ${entry.session.toString()}`, error);
				continue;
			}
			if (!metadata) {
				continue;
			}
			if (readSessionEhcliAdoptable(metadata._meta)) {
				continue;
			}
			if (this._isExternalSessionOlderThanMaxAge(metadata.modifiedTime, now)) {
				staleExternalSessions.push(entry.session);
			}
		}

		for (const session of staleExternalSessions) {
			await this._sessionRegistry.unregister(session);
		}
		if (staleExternalSessions.length > 0) {
			this._invalidateSessionList();
			this._queueSessionListReconciliation();
		}
		this._logService.info(`[AgentService] pruned ${staleExternalSessions.length} stale external session row(s) older than ${EXTERNAL_SESSION_MAX_AGE_MS / DAY_MS} days`);
	}

	private readonly _untitledExternalSessions = new Map<string, IAgentSessionMetadata>();
	private _externalSessionTitlingQueued = false;

	private _scheduleExternalSessionTitles(sessions: readonly IAgentSessionMetadata[]): void {
		for (const session of sessions) {
			this._untitledExternalSessions.set(session.session.toString(), session);
		}
		if (this._externalSessionTitlingQueued) {
			return;
		}
		this._externalSessionTitlingQueued = true;
		this._runWhenStartupSettled('external session titles', () => {
			this._externalSessionTitlingQueued = false;
			return this._titleUntitledExternalSessions();
		});
	}

	private async _titleUntitledExternalSessions(): Promise<void> {
		const candidates = [...this._untitledExternalSessions.values()]
			.sort((a, b) => b.modifiedTime - a.modifiedTime)
			.slice(0, RECENT_EXTERNAL_SESSION_LIMIT);
		this._untitledExternalSessions.clear();
		for (const candidate of candidates) {
			try {
				await this._generateExternalSessionTitle(candidate);
			} catch (error) {
				this._logService.warn(`[AgentService] Failed to title external session ${candidate.session.toString()}`, error);
			}
		}
	}

	private async _generateExternalSessionTitle(metadata: IAgentSessionMetadata): Promise<void> {
		const session = metadata.session;
		const agent = this._providerService.getProviderForSession(session);
		if (!agent) {
			return;
		}
		const chat = URI.parse(buildDefaultChatUri(session));
		const turns = await agent.chats.getMessages(chat, this._chatContext(session, chat));
		const prompt = turns[0]?.message.text.trim();
		if (prompt) {
			await this._sideEffects.generateExternalSessionTitle(session.toString(), prompt);
		}
	}


	private _toProviderConfig<T extends { readonly config?: Record<string, unknown> }>(request: T): T {
		if (!this._worktree.supported || !request.config) {
			return request;
		}
		return { ...request, config: omitHostOwnedSessionConfig(request.config) };
	}

	private async _resolveWorkingDirectoryBeforeSend(params: { session: string; chat: string; turnId: string; prompt: string }): Promise<readonly URI[] | undefined> {
		const sessionId = AgentSession.id(params.session);
		const pickedFolders = this._configurationService.getEffectiveWorkingDirectories(params.session);
		const pickedFolderUri = pickedFolders?.[0] ? URI.parse(pickedFolders[0]) : undefined;
		const tail = (pickedFolders ?? []).slice(1).map(d => URI.parse(d));

		if (!this._worktree.isWorkingDirectoryPending(sessionId)) {
			if (!pickedFolderUri) {
				return undefined;
			}
			const resolved = await this._worktree.resolveWorkingDirectoryForResume(URI.parse(params.session), sessionId, pickedFolderUri);
			return [resolved, ...tail];
		}

		const resolved = await this._resolveWorktreeBeforeSend({ ...params, sessionId, pickedFolderUri }) ?? pickedFolderUri;
		return resolved ? [resolved, ...tail] : undefined;
	}

	private async _resolveChatAttachmentTurns(resource: string): Promise<readonly Turn[]> {
		const readTurns = () => {
			const state = this._stateManager.getChatState(resource) ?? this._stateManager.getDefaultChatState(resource);
			return state?.turns;
		};
		const existing = readTurns();
		if (existing) {
			return existing;
		}

		const sessionUri = URI.parse(isAhpChatChannel(resource) ? parseRequiredSessionUriFromChatUri(resource) : resource);
		if (!this._stateManager.getSessionState(sessionUri.toString())) {
			await this.restoreSession(sessionUri);
		} else {
			const provider = this._providerService.getProviderForSession(sessionUri);
			if (provider) {
				await this._restorePeerChats(provider, sessionUri);
			}
		}
		if (isAhpChatChannel(resource)) {
			const state = await this._stateManager.resolveChatState(resource);
			if (state) {
				return state.turns;
			}
			throw new Error(`Cannot resolve peer chat attachment: ${resource}`);
		}
		const resolved = readTurns();
		if (resolved) {
			return resolved;
		}
		return [];
	}

	private async _resolveWorktreeBeforeSend(params: { session: string; chat: string; turnId: string; prompt: string; sessionId: string; pickedFolderUri: URI | undefined }): Promise<URI | undefined> {
		const { sessionId, pickedFolderUri } = params;
		const worktree = this._worktree;
		let reportedActivity = false;
		let failureDiagnostic: string | undefined;
		try {
			await worktree.resolveOnFirstSend({
				sessionUri: URI.parse(params.session),
				sessionId,
				workingDirectory: pickedFolderUri,
				config: this._configurationService.getSessionConfigValues(params.session),
				prompt: params.prompt,
				onProgress: activity => {
					reportedActivity = true;
					this._stateManager.dispatchServerAction(params.chat, { type: ActionType.ChatActivityChanged, activity });
				},
			});
		} catch (err) {
			failureDiagnostic = toErrorMessage(err);
			this._logService.warn(`[AgentService] worktree resolution failed for ${params.session}: ${failureDiagnostic}`);
		}
		if (reportedActivity) {
			this._stateManager.dispatchServerAction(params.chat, { type: ActionType.ChatActivityChanged, activity: undefined });
		}
		const resolvedWorktree = worktree.getResolvedWorktree(sessionId);
		if (!resolvedWorktree) {
			try {
				await worktree.persistCreationFailure(URI.parse(params.session), sessionId, failureDiagnostic);
			} catch (err) {
				this._logService.warn(`[AgentService] failed to persist worktree creation failure for ${params.session}: ${toErrorMessage(err)}`);
			}
			this._stateManager.dispatchServerAction(params.chat, {
				type: ActionType.ChatResponsePart,
				turnId: params.turnId,
				part: buildWorktreeFailureNotification(failureDiagnostic),
			});
			return undefined;
		}
		const announcement = worktree.takePendingAnnouncement(sessionId);
		if (announcement !== undefined) {
			this._stateManager.dispatchServerAction(params.chat, {
				type: ActionType.ChatResponsePart,
				turnId: params.turnId,
				part: { kind: ResponsePartKind.Markdown, id: generateUuid(), content: announcement },
			});
		}
		return resolvedWorktree;
	}

	private _initializeProvider(provider: IAgent): IDisposable {
		const subscriptions = new DisposableStore();
		try {
			this._invalidateSessionList();
			provider.setServerToolHost?.(this._serverToolHost);
			provider.setKnownSessionsFilter?.(sessions => this._filterKnownSessions(sessions));
			subscriptions.add(provider.onDidChatProgress(signal => this._sequenceSpawnedChat(signal)));
			subscriptions.add(this._sideEffects.registerProgressListener(provider));
			subscriptions.add(provider.onDidMaterializeChat(e => this._onDidMaterializeChat(e)));
			subscriptions.add(provider.onDidDiscoverChats(chats => {
				void this._migrateAndRegisterDiscoveredChats(provider, chats).catch(err =>
					this._logService.warn(`[AgentService] registering discovered chats for provider ${provider.id} failed`, err));
			}));
			this._setupChatDiscoveryForProvider(provider);
			subscriptions.add(provider.onDidChangeChatData(e => this._onChatDataChanged(e)));
			subscriptions.add(provider.onDidSpawnChat(e => this._onChatSpawned(e)));
			this._providerSubscriptions.set(provider.id, subscriptions);
			return toDisposable(() => {
				this._providerSubscriptions.deleteAndDispose(provider.id);
				this._deferredProviderMigrations.delete(provider.id);
				this._readableProviderCatalogs.delete(provider.id);
			});
		} catch (error) {
			subscriptions.dispose();
			throw error;
		}
	}

	private _setupChatDiscoveryForProvider(provider: IAgent): void {
		if (this._migrateLegacyEnabledSnapshot === true && provider.ensureChatAdopted) {
			this._startChatDiscovery(provider, 'legacy chat migration is enabled');
		} else {
			this._runWhenStartupSettled(`external session discovery for ${provider.id}`, () => {
				if (!this._hidesAllExternalSessions(this._getExternalSessionsMode())) {
					this._startChatDiscovery(provider, 'Agent Host startup settled with external sessions enabled');
				}
			});
		}
	}

	private _onDidRegisterProvider(provider: IAgent): void {
		this._registerSkillCompletionProvider();
		const initialMigration = this._ensureLegacyChatsMigrated(provider);
		this._trackInitialProviderMigration(provider, initialMigration);
		this._agentMergeRestore = this._agentMergeRestore
			.then(() => initialMigration)
			.then(() => this._restoreAgentMergeMonitoredSessions())
			.catch(err => this._logService.warn('[AgentService] Failed to restore Agent-Merge-enabled sessions', err));
	}

	private _trackInitialProviderMigration(provider: IAgent, migration: Promise<void>): Promise<void> {
		this._initialProviderMigrations.set(provider.id, migration);
		void migration
			.then(() => this._automationService.handleAgentsChanged())
			.catch(err => this._logService.warn(`[AgentService] provider initialization failed before Automations could refresh for ${provider.id}`, err));
		return migration;
	}

	private _registerSkillCompletionProvider(): void {
		if (this._skillCompletionProviderRegistered) {
			return;
		}
		this._skillCompletionProviderRegistered = true;
		const provider = this._register(new AgentHostSkillCompletionProvider(
			session => this._providerService.getProviderForSession(session),
			session => this._hostCustomizations(URI.isUri(session) ? session : URI.parse(session)),
		));
		this._register(this._completions.registerProvider(provider));
	}


	async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
		const result = await this._providerService.authenticate(params);
		if (result.authenticated) {
			this._agentMergeController.refresh();
		}
		return result;
	}


	async invokeChangesetOperation(params: InvokeChangesetOperationParams): Promise<InvokeChangesetOperationResult> {
		return this._changesetOperationService.invokeChangesetOperation(params);
	}


	async handleMcpRequest(channel: string, method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
		return this._providerService.handleMcpRequest(channel, method, params);
	}


	private _createSessionServerToolAccessor(): IAgentServiceSessionServerToolAccessor {
		return {
			isActiveAgentTitleGenerationEnabled: () => this._isActiveAgentTitleGenerationEnabled(),
			canConvertWorkspace: session => this._providerService.getProviderForSession(session)?.agentHostCapabilities.workspaceConversion === true
				&& readSessionWorkspaceless(this._stateManager.getSessionState(session.toString())?._meta),
			listSessions: () => this.listSessions(),
			getSession: session => this._getSessionMetadata(session),
			createSession: config => this.createSession(config),
			getModels: () => {
				const models: IAgentModelInfo[] = [];
				for (const provider of this._providerService.getProviders()) {
					models.push(...provider.models.get());
				}
				return models;
			},
			getCreationDefaults: source => this._getServerToolCreationDefaults(source),
			startPrompt: (session, chat, prompt, delegation) => this._startSessionPrompt(session, chat, prompt, delegation),
			createChat: (session, chat, options) => this.createChat(session, chat, (options?.title !== undefined || options?.model !== undefined)
				? { ...(options.title !== undefined ? { title: options.title } : {}), ...(options.model !== undefined ? { model: options.model } : {}) }
				: undefined),
			renameChat: (session, chat, title) => this._renameChatFromTool(session, chat, title),
			reportToolError: (toolName, error) => this._logService.error(`[AgentService] ${toolName} failed after the tool returned: ${toErrorMessage(error)}`),
			deleteSession: session => this.disposeSession(session),
			getChatContext: (session, chatId) => this._getChatContext(session, chatId),
			getSessionSpawnDepth: session => readSessionSpawnDepth(this._stateManager.getSessionSummary(session.toString())?._meta),
			setSessionSpawnDepth: (session, depth) => this._stateManager.dispatchServerAction(session.toString(), {
				type: ActionType.SessionMetaChanged,
				_meta: withSessionSpawnDepth(this._stateManager.getSessionSummary(session.toString())?._meta, depth),
			}),
		};
	}

	private _isActiveAgentTitleGenerationEnabled(): boolean {
		return this._configurationService.getRootValue(platformRootSchema, AgentHostActiveAgentTitleGenerationConfigKey) === true;
	}

	private _createArtifactServerToolAccessor(): IArtifactServerToolAccessor {
		return {
			isEnabled: () => this._isArtifactToolsEnabled(),
			persist: (session, artifacts) => persistSessionMetadata(this._sessionDataService, this._logService, session, SESSION_ARTIFACTS_KEY, stringifySessionArtifacts(artifacts)),
		};
	}

	private _isArtifactToolsEnabled(): boolean {
		return this._configurationService.getRootValue(platformRootSchema, AgentHostArtifactToolsConfigKey) === true;
	}

	private _readPersistedArtifacts(value: string | undefined, session: string, logPrefix: string): readonly ISessionArtifact[] {
		const { artifacts, error, dropped } = parseSessionArtifacts(value);
		if (error) {
			this._logService.warn(`${logPrefix} Failed to parse artifacts for ${session}: ${toErrorMessage(error)}`);
		} else if (dropped > 0) {
			this._logService.warn(`${logPrefix} Dropped ${dropped} malformed artifact(s) for ${session}`);
		}
		return artifacts;
	}

	private _getServerToolCreationDefaults(source: URI): ISessionCreationDefaults | undefined {
		const session = this._stateManager.getSessionState(source.toString());
		if (!session) {
			return undefined;
		}

		const model = session.activeTurn
			? session.activeTurn.message.model
			: session.draft
				? session.draft.model
				: session.turns.at(-1)?.message.model;
		const sourceConfig = getNonMergeSessionConfigValues(session.config?.values);
		const config = this._providerService.getProvider(session.provider)?.getInheritedChatConfig(sourceConfig);
		const isolation = sourceConfig[SessionConfigKey.Isolation];
		return {
			provider: session.provider,
			...(model !== undefined ? { model } : {}),
			...(config !== undefined ? { config } : {}),
			...(isolation === 'folder' || isolation === 'worktree' ? { isolation } : {}),
			...(session.project ? { project: URI.parse(session.project.uri) } : {}),
		};
	}

	private async _startSessionPrompt(session: URI, chat: URI, prompt: string, delegation?: IAgentMessageDelegationMeta): Promise<void> {
		const message: Message = {
			text: prompt,
			origin: { kind: MessageKind.Agent },
			...(delegation ? { _meta: toAgentMessageDelegationMeta(delegation) } : {}),
		};
		await this._startSessionMessage(chat, message);
	}

	private async _startAutomationMessage(session: URI, message: Message): Promise<void> {
		await this._startSessionMessage(URI.parse(buildDefaultChatUri(session)), message);
	}

	private async _startSessionMessage(chat: URI, message: Message): Promise<void> {
		this._turnService.startTurnMessage(chat, message);
	}

	private async _cancelAutomationSession(session: URI): Promise<boolean> {
		const chat = buildDefaultChatUri(session);
		const activeTurn = this._stateManager.getChatState(chat)?.activeTurn;
		if (!activeTurn) {
			return false;
		}
		const startedAt = Date.parse(activeTurn.startedAt);
		const duration = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
		const action = { type: ActionType.ChatTurnCancelled, turnId: activeTurn.id, duration } as const;
		this._stateManager.dispatchServerAction(chat, action);
		this._sideEffects.handleAction(chat, action);
		return true;
	}

	private _startAgentMergePrompt(session: string, turnId: string, prompt: string): boolean {
		if (this._stateManager.hasActiveTurn(session)) {
			return false;
		}
		const chat = buildDefaultChatUri(session).toString();
		const message: Message = {
			text: prompt,
			origin: { kind: MessageKind.SystemNotification },
			_meta: toAgentMergeMessageMeta(),
		};
		const action = { type: ActionType.ChatTurnStarted, turnId, startedAt: new Date().toISOString(), message } as const;
		this._stateManager.dispatchServerAction(chat, action);
		this._sideEffects.handleAction(chat, action);
		return true;
	}

	private _postAgentMergeNotice(session: string, kind: AgentSystemNotificationKind, content: string): void {
		if (this._stateManager.hasActiveTurn(session)) {
			const pending = this._pendingAgentMergeNotices.get(session);
			if (pending) {
				pending.push({ kind, content });
			} else {
				this._pendingAgentMergeNotices.set(session, [{ kind, content }]);
			}
			this._logService.debug(`[AgentService] Deferring an Agent Merge notice until the session is idle: session=${session}`);
			return;
		}
		this._writeAgentMergeNotice(session, kind, content);
	}

	private _flushAgentMergeNotices(session: string): void {
		const pending = this._pendingAgentMergeNotices.get(session);
		if (!pending) {
			return;
		}
		this._pendingAgentMergeNotices.delete(session);
		for (const { kind, content } of pending) {
			this._writeAgentMergeNotice(session, kind, content);
		}
	}

	private _writeAgentMergeNotice(session: string, kind: AgentSystemNotificationKind, content: string): void {
		const chat = buildDefaultChatUri(session);
		const channel = chat.toString();
		const turnId = generateUuid();
		this._stateManager.dispatchServerAction(channel, {
			type: ActionType.ChatTurnStarted,
			turnId,
			startedAt: new Date().toISOString(),
			message: withMessageRequestHiddenFromTranscript({ text: content, origin: { kind: MessageKind.SystemNotification } }, true),
		});
		this._stateManager.dispatchServerAction(channel, {
			type: ActionType.ChatResponsePart,
			turnId,
			part: {
				kind: ResponsePartKind.SystemNotification,
				content,
				_meta: toAgentSystemNotificationMeta({ kind }),
			},
		});
		this._stateManager.dispatchServerAction(channel, { type: ActionType.ChatTurnComplete, turnId, duration: 0 });
		const turns = this._stateManager.getSessionState(chat)?.turns;
		const recorded = turns?.find(turn => turn.id === turnId);
		if (turns && recorded) {
			this._localTurns.record(session, channel, recorded, this._localTurns.findAnchorTurnId(channel, turns, turnId));
		}
	}

	private _cancelAgentMergePrompt(session: string, turnId: string): void {
		const chat = buildDefaultChatUri(session).toString();
		const action = { type: ActionType.ChatTurnCancelled, turnId, duration: 0 } as const;
		this._stateManager.dispatchServerAction(chat, action);
		this._sideEffects.handleAction(chat, action);
	}

	private async _getChatContext(session: URI, chatId?: string): Promise<IChatContextSnapshot | undefined> {
		const chatState = chatId
			? await this._stateManager.resolveChatState(buildChatUri(session.toString(), chatId))
			: this._stateManager.getDefaultChatState(session.toString());
		if (!chatState) {
			return undefined;
		}
		return {
			turns: chatState.turns,
			...(chatState.activeTurn ? { activeTurn: { message: chatState.activeTurn.message, responseParts: chatState.activeTurn.responseParts } } : {}),
			hasMoreHistory: !!chatState.turnsNextCursor,
		};
	}

	private async _renameChatFromTool(session: URI, chat: URI, title: string): Promise<IRenameTitleResult> {
		validateRenameTitle(title, SessionServerToolName.RenameChat);
		const isDefaultChat = isDefaultChatUri(chat.toString());
		if (!isDefaultChat && !await this._peerChatExists(session, chat)) {
			throw new Error(`Invalid ${SessionServerToolName.RenameChat} input: chat must match a known non-default chat.`);
		}

		await persistSessionMetadataValues(this._sessionDataService, session.toString(), {
			[customChatTitleMetadataKey(chat.toString())]: title,
			[customChatTitleSourceMetadataKey(chat.toString())]: AGENT_HOST_TITLE_SOURCE_AGENT,
			...(isDefaultChat ? {
				[SESSION_CUSTOM_TITLE_KEY]: title,
				[SESSION_CUSTOM_TITLE_SOURCE_KEY]: AGENT_HOST_TITLE_SOURCE_AGENT,
			} : {}),
		});
		const state = this._stateManager.getSessionState(session.toString());
		if (state) {
			if (isDefaultChat && state.title !== title) {
				this._stateManager.dispatchServerAction(session.toString(), { type: ActionType.SessionTitleChanged, title });
			}
			this._stateManager.updateChatTitle(session.toString(), chat.toString(), title);
		}
		if (isDefaultChat) {
			this._sideEffects.markTitleRenamed(session.toString());
		}
		this._sideEffects.markTitleRenamed(session.toString(), chat.toString());
		return { title };
	}

	private async _peerChatExists(session: URI, chat: URI): Promise<boolean> {
		if (this._stateManager.getSessionState(session.toString())?.chats.some(candidate => candidate.resource === chat.toString())) {
			return true;
		}
		const persisted = await this._readPersistedPeerChatCatalog(session);
		return persisted?.some(candidate => candidate.uri === chat.toString()) === true;
	}

	private _toSessionMetadata(metadata: IAgentChatMetadata): IAgentSessionMetadata {
		const { chat, ...rest } = metadata;
		return {
			...rest,
			session: URI.parse(parseRequiredSessionUriFromChatUri(chat)),
		};
	}

	private async _enumerateLegacyProviderSessions(provider: IAgent): Promise<readonly IAgentSessionMetadata[] | undefined | typeof AgentChatMigrationDeferred> {
		const chats = await provider.listChatsToMigrate();
		return chats === AgentChatMigrationDeferred ? chats : chats?.map(metadata => this._toSessionMetadata(metadata));
	}

	private async _registeredSessionMetadata(agent: IAgent, session: URI, external: boolean, fallback?: Pick<IRegisteredSession, 'startTime' | 'modifiedTime'>): Promise<IAgentSessionMetadata | undefined> {
		const chat = URI.parse(buildDefaultChatUri(session));
		const metadata = await agent.getChatMetadata(
			chat,
			this._chatContext(session, chat),
			await this._readDefaultChatProviderData(session),
			fallback ? { registryFallback: { startTime: fallback.startTime, modifiedTime: fallback.modifiedTime } } : undefined,
		);
		if (!metadata) {
			return undefined;
		}
		if (fallback && metadata.modifiedTime > fallback.modifiedTime) {
			await this._advanceSessionModifiedTime(session, metadata.modifiedTime, false);
		}
		const sessionMetadata = this._toSessionMetadata(metadata);
		return {
			...sessionMetadata,
			_meta: withSessionExternal(sessionMetadata._meta, external),
		};
	}

	private async _getSessionMetadata(session: URI): Promise<IAgentSessionMetadata | undefined> {
		const registered = await this._sessionRegistry.get(session, entry => this._migrateRegisteredSession(entry));
		if (!registered) {
			return undefined;
		}
		const agent = this._providerService.getProvider(registered.provider);
		const liveSummary = this._stateManager.getSessionSummary(session.toString());
		if (liveSummary) {
			const metadata = (liveSummary.workingDirectories === undefined && agent
				? await this._registeredSessionMetadata(agent, session, registered.external, registered)
				: undefined) ?? {
				session,
				startTime: registered.startTime,
				modifiedTime: Date.parse(liveSummary.modifiedAt),
			};
			return this._withLiveSessionMetadata(metadata, liveSummary);
		}
		if (!agent) {
			return undefined;
		}
		return this._registeredSessionMetadata(agent, session, registered.external, registered);
	}

	private _withLiveSessionMetadata(metadata: IAgentSessionMetadata, liveSummary: SessionSummary): IAgentSessionMetadata {
		let _meta = liveSummary._meta !== undefined || metadata._meta !== undefined
			? { ...metadata._meta, ...liveSummary._meta }
			: undefined;
		_meta = withSessionMultiRootMetadata(_meta, readSessionMultiRootMetadata(liveSummary._meta) ?? readSessionMultiRootMetadata(metadata._meta));
		return {
			...metadata,
			summary: liveSummary.title || metadata.summary,
			status: liveSummary.status,
			activity: liveSummary.activity,
			modifiedTime: Date.parse(liveSummary.modifiedAt),
			project: liveSummary.project
				? { uri: URI.parse(liveSummary.project.uri), displayName: liveSummary.project.displayName }
				: metadata.project,
			workingDirectories: liveSummary.workingDirectories !== undefined
				? liveSummary.workingDirectories.map(directory => URI.parse(directory))
				: metadata.workingDirectories,
			changes: liveSummary.changes ?? metadata.changes,
			changesets: this._stateManager.getSessionState(metadata.session.toString())?.changesets ?? metadata.changesets,
			...(_meta !== undefined ? { _meta } : {}),
		};
	}

	private _agentMergeRestore: Promise<void> = Promise.resolve();
	private _agentMergeIndexWrites: Promise<void> = Promise.resolve();
	private readonly _pendingAgentMergeNotices = new Map<string, { readonly kind: AgentSystemNotificationKind; readonly content: string }[]>();

	async whenAgentMergeSessionsRestored(): Promise<void> {
		for (let i = 0; i < 3; i++) {
			await this._agentMergeIndexWrites;
			await this._agentMergeRestore;
		}
	}

	private async _restoreAgentMergeMonitoredSessions(): Promise<void> {
		if (!this._isAgentMergeEnabled()) {
			return;
		}
		await this._agentMergeIndexWrites;
		const enabled = await this._sessionRegistry.listAgentMergeEnabled();
		if (enabled.length === 0) {
			return;
		}
		const limiter = new Limiter<void>(4);
		await Promise.all(enabled.map(session => limiter.queue(async () => {
			const sessionStr = session.toString();
			if (this._stateManager.getSessionState(sessionStr)) {
				return;
			}
			try {
				const registered = await this._sessionRegistry.get(session, entry => this._migrateRegisteredSession(entry));
				if (!registered || await this._isPersistedSessionArchived(session)) {
					await this._sessionRegistry.setAgentMergeEnabled(session, false);
					return;
				}
				if (!this._providerService.getProvider(registered.provider)) {
					return;
				}
				this._logService.info(`[AgentService] Restoring Agent-Merge-enabled session for monitoring: ${sessionStr}`);
				await this.restoreSession(session);
			} catch (err) {
				this._logService.warn(`[AgentService] Failed to restore Agent-Merge-enabled session ${sessionStr}`, err);
			}
		})));
	}

	private async _isPersistedSessionArchived(session: URI): Promise<boolean> {
		const ref = await this._sessionDataService.tryOpenDatabase(session);
		if (!ref) {
			return false;
		}
		try {
			const metadata = await ref.object.getMetadataObject({
				[AH_META_IS_ARCHIVED_DB_KEY]: true,
				[AH_META_IS_DONE_DB_KEY]: true,
			});
			return (metadata[AH_META_IS_ARCHIVED_DB_KEY] ?? metadata[AH_META_IS_DONE_DB_KEY]) === 'true';
		} finally {
			ref.dispose();
		}
	}

	private _syncAgentMergeIndex(session: URI, previous: SessionConfigState | undefined, current: SessionConfigState | undefined): void {
		const wasEnabled = readAgentMergeSessionState(previous?.values)?.enabled === true;
		const isEnabled = readAgentMergeSessionState(current?.values)?.enabled === true;
		if (wasEnabled === isEnabled) {
			return;
		}
		this._writeAgentMergeIndex(session, isEnabled);
	}

	private _clearAgentMergeIndex(session: URI): void {
		this._writeAgentMergeIndex(session, false);
	}

	private _writeAgentMergeIndex(session: URI, enabled: boolean): void {
		this._agentMergeIndexWrites = this._agentMergeIndexWrites
			.then(() => this._retryRegistryMutation(
				() => this._sessionRegistry.setAgentMergeEnabled(session, enabled),
				`Agent Merge index write for ${session.toString()}`,
			))
			.catch(err => this._logService.warn(`[AgentService] Failed to update the Agent Merge index for ${session.toString()}`, err));
	}

	private async _awaitInitialProviderMigration(): Promise<void> {
		await Promise.all(this._providerService.getProviders().map(provider => this._awaitInitialProviderMigrationForProvider(provider)));
	}

	private async _awaitInitialProviderMigrationForProvider(provider: IAgent, requireReadableCatalog = false): Promise<boolean> {
		const migration = this._initialProviderMigrations.get(provider.id);
		if (!migration) {
			if (requireReadableCatalog || this._deferredProviderMigrations.has(provider.id)) {
				await this._ensureLegacyChatsMigrated(provider, requireReadableCatalog);
			}
			return this._readableProviderCatalogs.has(provider.id);
		}
		try {
			await migration;
		} catch (err) {
			this._logService.warn(`[AgentService] initial provider catalog for ${provider.id} was unavailable; retrying before accessing sessions`, err);
			await this._replaceFailedInitialProviderMigration(provider, migration);
		}
		if (requireReadableCatalog && !this._readableProviderCatalogs.has(provider.id)) {
			await this._ensureLegacyChatsMigrated(provider, true);
		} else if (this._firstListingServed && this._deferredProviderMigrations.has(provider.id)) {
			await this._ensureLegacyChatsMigrated(provider);
		}
		return this._readableProviderCatalogs.has(provider.id);
	}

	private async _migrateAndRegisterDiscoveredChats(provider: IAgent, chats: readonly IAgentDiscoveredChat[]): Promise<void> {
		if (this._deferredProviderMigrations.has(provider.id)) {
			try {
				await this._ensureLegacyChatsMigrated(provider, true);
			} catch (err) {
				this._logService.warn(`[AgentService] registry migration: failed for provider ${provider.id} after chat discovery`, err);
			}
		}
		await this._registerDiscoveredChats(provider, chats);
	}

	private _replaceFailedInitialProviderMigration(provider: IAgent, failed: Promise<void>): Promise<void> {
		const current = this._initialProviderMigrations.get(provider.id);
		if (current !== failed) {
			return current ?? Promise.resolve();
		}
		const retry = this._ensureLegacyChatsMigrated(provider, true);
		return this._trackInitialProviderMigration(provider, retry);
	}

	private _ensureLegacyChatsMigrated(provider: IAgent, force = false): Promise<void> {
		return this._ensureProviderCatalog(provider, this._providerMigrations, force, runForce => this._migrateLegacyProviderChats(provider, runForce));
	}

	private _ensureProviderCatalog(
		provider: IAgent,
		states: Map<AgentProvider, IProviderDiscoveryState>,
		force: boolean,
		run: (force: boolean) => Promise<void>,
	): Promise<void> {
		const existing = states.get(provider.id);
		if (existing) {
			if (force && !existing.forceQueued) {
				existing.forceQueued = true;
				const chained = existing.promise
					.catch(() => { })
					.then(() => {
						existing.forceQueued = false;
						return run(true);
					});
				existing.promise = chained;
				this._armProviderCatalogCleanup(provider, states, existing, chained);
			}
			return existing.promise;
		}
		const state: IProviderDiscoveryState = { promise: Promise.resolve(), forceQueued: false };
		const attempt = run(force);
		state.promise = attempt;
		states.set(provider.id, state);
		this._armProviderCatalogCleanup(provider, states, state, attempt);
		return attempt;
	}

	private _armProviderCatalogCleanup(provider: IAgent, states: Map<AgentProvider, IProviderDiscoveryState>, state: IProviderDiscoveryState, promise: Promise<void>): void {
		const clear = () => {
			if (state.promise === promise && states.get(provider.id) === state) {
				states.delete(provider.id);
			}
		};
		void promise.then(clear, clear);
	}


	private async _registerDiscoveredChats(provider: IAgent, chats: readonly IAgentDiscoveredChat[]): Promise<boolean> {
		const registeredRecency = await this._sessionRegistry.listSessionModifiedTimes();
		const registeredKeys = new Set(registeredRecency.keys());
		const discoveryLimiter = new Limiter<boolean>(4);
		let suppressed = 0;
		let skippedAsStale = 0;
		let registeredExternal = false;
		let alreadyRegistered = 0;
		let registryChanged = false;
		const untitledExternal: IAgentSessionMetadata[] = [];
		const modifiedTimeAdvances: { readonly session: URI; readonly modifiedTime: number }[] = [];
		const results = await Promise.all(chats.map(({ external: reportedExternal, ...metadata }) => discoveryLimiter.queue(async () => {
			const sessionMetadata = this._toSessionMetadata(metadata);
			const session = sessionMetadata.session;
			try {
				if (registeredKeys.has(session.toString())) {
					alreadyRegistered++;
					const stored = registeredRecency.get(session.toString());
					if (Number.isFinite(sessionMetadata.modifiedTime) && (stored === undefined || sessionMetadata.modifiedTime > stored)) {
						modifiedTimeAdvances.push({ session, modifiedTime: sessionMetadata.modifiedTime });
					}
					return false;
				}
				if (isSubagentSession(session.toString())) {
					suppressed++;
					return false;
				}
				const registrationFacts = await this._readSessionRegistrationFacts(session);
				if (registrationFacts.chatBacking) {
					suppressed++;
					return false;
				}
				const external = reportedExternal && !registrationFacts.hostCreated;
				if (external && !readSessionEhcliAdoptable(sessionMetadata._meta) && this._isExternalSessionOlderThanMaxAge(sessionMetadata.modifiedTime, Date.now())) {
					skippedAsStale++;
					return false;
				}
				const identity: IRegisteredSession = { session, provider: provider.id, startTime: metadata.startTime, modifiedTime: metadata.modifiedTime, external, source: external ? 'discovery' : 'restore' };
				const registered = await this._retryRegistryMutation(
					() => this._sessionRegistry.register(session, identity, { checkTombstone: true }),
					`discovery registration for ${session.toString()}`,
				);
				if (registered) {
					registryChanged = true;
					if (external) {
						await this._initializeExternalSessionReadState(session);
					}
					registeredKeys.add(session.toString());
					if (external && !sessionMetadata.summary) {
						untitledExternal.push(sessionMetadata);
					}
					if (external && !readSessionEhcliAdoptable(sessionMetadata._meta)) {
						registeredExternal = true;
					} else {
						await this._announceSurfacedSession({ ...sessionMetadata, _meta: withSessionExternal(sessionMetadata._meta, external) }, provider.id);
					}
				} else {
					this._logService.trace(`[AgentService] discovery: ${session.toString()} was not registered (tombstoned)`);
				}
				return registered;
			} catch (err) {
				this._logService.warn(`[AgentService] Failed to register discovered chat ${session.toString()} for provider ${provider.id}`, err);
				return false;
			}
		})));
		const registered = results.filter(changed => changed).length;
		if (modifiedTimeAdvances.length > 0) {
			await this._retryRegistryMutation(
				() => this._sessionRegistry.updateModifiedTimes(modifiedTimeAdvances),
				`batched modified-time update for ${modifiedTimeAdvances.length} session(s)`,
			);
			this._invalidateSessionList();
		}
		if (registryChanged) {
			this._invalidateSessionList();
		}
		if (registeredExternal) {
			this._queueSessionListReconciliation();
		}
		if (untitledExternal.length > 0) {
			this._scheduleExternalSessionTitles(untitledExternal);
		}
		this._logService.info(`[AgentService] discovery for provider ${provider.id}: ${chats.length} candidate(s) (${chats.filter(chat => chat.external).length} external), ${registered} registered, ${alreadyRegistered} already registered, ${suppressed} suppressed as subagent/chat backing, ${skippedAsStale} skipped as older than ${EXTERNAL_SESSION_MAX_AGE_MS / DAY_MS} days`);
		return registered > 0;
	}

	private async _migrateLegacyProviderChats(provider: IAgent, force = false): Promise<void> {
		if (!force) {
			if (await this._sessionRegistry.isProviderBackfilled(provider.id)) {
				return;
			}
			if (await this._sessionRegistry.isBackfilled()) {
				await this._sessionRegistry.markProviderBackfilled(provider.id);
				return;
			}
		}
		const sessions = await this._enumerateLegacyProviderSessions(provider);
		if (sessions === undefined) {
			this._readableProviderCatalogs.delete(provider.id);
			throw new ProviderCatalogUnavailableError(provider.id);
		}
		if (sessions === AgentChatMigrationDeferred) {
			this._deferredProviderMigrations.add(provider.id);
			this._readableProviderCatalogs.delete(provider.id);
			return;
		}
		const existing = new Map((await this._listRegisteredSessions()).map(session => [session.session.toString(), session.external]));
		const migrationLimiter = new Limiter<IRegisteredSession | undefined>(4);
		const identities = await Promise.all(sessions.map(s => migrationLimiter.queue(async (): Promise<IRegisteredSession | undefined> => {
			if (isSubagentSession(s.session.toString())) {
				return undefined;
			}
			const facts = await this._readSessionRegistrationFacts(s.session);
			if (facts.chatBacking) {
				return undefined;
			}
			const external = !facts.hostCreated;
			return { session: s.session, provider: provider.id, startTime: s.startTime, modifiedTime: s.modifiedTime, external, source: external ? 'discovery' : 'restore' };
		})));
		let registeredExternal = false;
		const untitledExternal: IAgentSessionMetadata[] = [];
		for (let index = 0; index < identities.length; index++) {
			const identity = identities[index];
			if (!identity) {
				continue;
			}
			const metadata = sessions[index];
			if (identity.external && !readSessionEhcliAdoptable(metadata._meta) && this._isExternalSessionOlderThanMaxAge(metadata.modifiedTime, Date.now())) {
				continue;
			}
			const registered = await this._sessionRegistry.register(identity.session, identity, { checkTombstone: true });
			if (registered) {
				this._invalidateSessionList();
				if (identity.external && existing.get(identity.session.toString()) !== true) {
					await this._initializeExternalSessionReadState(identity.session);
				}
				existing.set(identity.session.toString(), identity.external);
				if (identity.external && !metadata.summary) {
					untitledExternal.push(metadata);
				}
				if (identity.external && !readSessionEhcliAdoptable(metadata._meta)) {
					registeredExternal = true;
				} else {
					await this._announceSurfacedSession({ ...metadata, _meta: withSessionExternal(metadata._meta, identity.external) }, provider.id);
				}
			}
		}
		await this._sessionRegistry.markProviderBackfilled(provider.id);
		this._deferredProviderMigrations.delete(provider.id);
		this._readableProviderCatalogs.add(provider.id);
		this._startChatDiscovery(provider, 'legacy migration enumerated the provider catalog');
		if (registeredExternal) {
			this._queueSessionListReconciliation();
		}
		if (untitledExternal.length > 0) {
			this._scheduleExternalSessionTitles(untitledExternal);
		}
	}

	private async _initializeExternalSessionReadState(session: URI): Promise<void> {
		const ref = this._sessionDataService.openDatabase(session);
		try {
			await ref.object.setMetadata(AH_META_IS_READ_DB_KEY, 'true');
		} finally {
			ref.dispose();
		}
	}

	private async _isExternalProviderChat(session: URI): Promise<boolean> {
		const ref = await this._sessionDataService.tryOpenDatabase(session);
		if (!ref) {
			return true;
		}

		try {
			return await ref.object.getMetadata(AH_META_WORKSPACELESS_DB_KEY) === undefined;
		} finally {
			ref.dispose();
		}
	}

	private async _readSessionRegistrationFacts(session: URI): Promise<{ readonly chatBacking: boolean; readonly hostCreated: boolean }> {
		if (this._unpersistedChatBackings.has(session.toString())) {
			return { chatBacking: true, hostCreated: false };
		}
		const ref = await this._sessionDataService.tryOpenDatabase(session);
		if (!ref) {
			return { chatBacking: false, hostCreated: false };
		}
		try {
			const metadata = await ref.object.getMetadataObject({ [CHAT_BACKING_METADATA_KEY]: true, [AH_META_WORKSPACELESS_DB_KEY]: true });
			return { chatBacking: !!metadata[CHAT_BACKING_METADATA_KEY], hostCreated: metadata[AH_META_WORKSPACELESS_DB_KEY] !== undefined };
		} finally {
			ref.dispose();
		}
	}

	private async _migrateRegisteredSession(entry: IStoredRegisteredSession): Promise<IRegisteredSession | undefined> {
		if (entry.external !== undefined) {
			return undefined;
		}
		const external = await this._isExternalProviderChat(entry.session);
		return {
			...entry,
			external,
			source: external ? 'discovery' : entry.source,
		};
	}

	private _listRegisteredSessions(): Promise<readonly IRegisteredSession[]> {
		return this._sessionRegistry.list(entry => this._migrateRegisteredSession(entry));
	}

	private async _advanceSessionModifiedTime(session: URI, modifiedTime: number, invalidate = true): Promise<void> {
		if (!Number.isFinite(modifiedTime)) {
			return;
		}
		const changed = await this._retryRegistryMutation(
			() => this._sessionRegistry.updateModifiedTime(session, modifiedTime),
			`modified-time update for ${session.toString()}`,
		);
		if (changed && invalidate) {
			this._invalidateSessionList();
		}
	}

	private _writeSessionModifiedTime(session: URI, modifiedTime: number): void {
		this._sessionModifiedTimeWrites = this._sessionModifiedTimeWrites
			.then(() => this._advanceSessionModifiedTime(session, modifiedTime))
			.catch(err => this._logService.warn(`[AgentService] Failed to persist the modified time for ${session.toString()}`, err));
	}

	private async _retryRegistryMutation<T>(operation: () => Promise<T>, description: string): Promise<T> {
		try {
			return await operation();
		} catch (err) {
			this._logService.warn(`[AgentService] Retrying failed session registry ${description}`, err);
			return operation();
		}
	}

	private async _filterKnownSessions(sessions: readonly URI[]): Promise<ReadonlySet<string>> {
		const registered = await this._sessionRegistry.listSessionKeys();
		const known = new Set<string>();
		for (const session of sessions) {
			const key = session.toString();
			if (registered.has(key)) {
				known.add(key);
			}
		}
		return known;
	}

	private readonly _inFlightListSessions = new Map<AgentHostExternalSessionsMode, ISessionListComputation>();

	private _registryEpoch = 0;

	private _invalidateSessionList(): void {
		this._registryEpoch++;
	}

	async listSessions(mode = this._getExternalSessionsMode()): Promise<IAgentSessionMetadata[]> {
		const epoch = this._registryEpoch;
		const inFlight = this._inFlightListSessions.get(mode);
		if (!inFlight) {
			return [...await this._startSessionListComputation(mode).promise];
		}
		if (inFlight.epoch === epoch) {
			return [...await inFlight.promise];
		}
		if (!inFlight.trailing) {
			const startTrailing = () => this._startSessionListComputation(mode).promise;
			inFlight.trailing = inFlight.promise.then(startTrailing, startTrailing);
		}
		return [...await inFlight.trailing];
	}

	private _startSessionListComputation(mode: AgentHostExternalSessionsMode): ISessionListComputation {
		const entry: ISessionListComputation = {
			epoch: this._registryEpoch,
			promise: this._computeSessions(mode),
		};
		this._inFlightListSessions.set(mode, entry);
		const clear = () => {
			if (!entry.trailing && this._inFlightListSessions.get(mode) === entry) {
				this._inFlightListSessions.delete(mode);
			}
		};
		void entry.promise.then(
			() => {
				clear();
				this._firstListingServed = true;
				this._openStartupSettled();
			},
			clear,
		);
		return entry;
	}

	private async _computeSessions(mode: AgentHostExternalSessionsMode): Promise<readonly IAgentSessionMetadata[]> {
		this._logService.trace('[AgentService] listSessions computation started');
		const startedAt = Date.now();
		await this._awaitInitialProviderMigration();
		const allRegistered = await this._listRegisteredSessions();
		const hiddenExternal = this._hidesAllExternalSessions(mode)
			? new Set(allRegistered.filter(entry => entry.external).map(entry => entry.session.toString()))
			: new Set<string>();
		const registered = hiddenExternal.size > 0
			? allRegistered.filter(entry => !hiddenExternal.has(entry.session.toString()))
			: allRegistered;
		const prewarmStore = new DisposableStore();
		const involvedProviders = new Map<AgentProvider, IAgent>();
		for (const entry of registered) {
			if (!involvedProviders.has(entry.provider)) {
				const agent = this._providerService.getProvider(entry.provider);
				if (agent?.prewarmSessionMetadata) {
					involvedProviders.set(entry.provider, agent);
				}
			}
		}
		await Promise.all([...involvedProviders.values()].map(async agent => {
			try {
				prewarmStore.add(await agent.prewarmSessionMetadata!());
			} catch (err) {
				this._logService.warn(`[AgentService] listSessions: failed to prewarm metadata for provider ${agent.id}`, err);
			}
		}));
		const metadataLimiter = new Limiter<IAgentSessionMetadata | undefined>(4);
		const metadataPhaseStartedAt = Date.now();
		let results: readonly (IAgentSessionMetadata | undefined)[];
		try {
			results = await Promise.all(registered.map(registeredSession => metadataLimiter.queue(async (): Promise<IAgentSessionMetadata | undefined> => {
				const { session, provider, external } = registeredSession;
				if (this._stateManager.isIdleProvisionalSession(session.toString())) {
					return undefined;
				}

				const agent = this._providerService.getProvider(provider);
				if (!agent) {
					return undefined;
				}
				try {
					return await this._registeredSessionMetadata(agent, session, external, registeredSession);
				} catch (err) {
					this._logService.warn(`[AgentService] listSessions: failed to read metadata for ${session}`, err);
					return undefined;
				}
			})));
		} finally {
			prewarmStore.dispose();
		}
		const flat = results.filter((s): s is IAgentSessionMetadata => s !== undefined);
		const metadataPhaseMs = Date.now() - metadataPhaseStartedAt;

		const overlayLimiter = new Limiter<IAgentSessionMetadata | undefined>(4);
		const overlayPhaseStartedAt = Date.now();
		const overlaid = await Promise.all(flat.map(s => overlayLimiter.queue(async (): Promise<IAgentSessionMetadata | undefined> => {
			const sanitized = { ...s, _meta: withSessionMultiRootMetadata(s._meta, undefined) };
			if (this._unpersistedChatBackings.has(s.session.toString())) {
				return undefined;
			}
			try {
				const ref = await this._sessionDataService.tryOpenDatabase(s.session);
				if (!ref) {
					return sanitized;
				}
				try {
					const sessionStr = s.session.toString();
					const changesetKeys = this._changesetCoordinator.getListMetadataKeys(sessionStr);
					const metadataKeys: Record<string, true> = changesetKeys
						? { customTitle: true, [AH_META_IS_READ_DB_KEY]: true, [AH_META_IS_ARCHIVED_DB_KEY]: true, [AH_META_IS_DONE_DB_KEY]: true, [AH_META_CREATED_BY_SESSION_DB_KEY]: true, [AH_META_DEV_CONTAINER_WORKTREE_DB_KEY]: true, [AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY]: true, [AH_META_WORKSPACELESS_DB_KEY]: true, [AH_META_EHCLI_ADOPTED_DB_KEY]: true, [AH_META_EHCLI_LAST_TURN_DB_KEY]: true, [SESSION_META_MULTI_ROOT_KEY]: true, [SESSION_META_FOLDER_PICKER_KEY]: true, [SESSION_ARTIFACTS_KEY]: true, [CHAT_BACKING_METADATA_KEY]: true, [WORKTREE_META_REPOSITORY_ROOT]: true, ...GIT_DB_METADATA_KEYS, ...changesetKeys }
						: { customTitle: true, [AH_META_IS_READ_DB_KEY]: true, [AH_META_IS_ARCHIVED_DB_KEY]: true, [AH_META_IS_DONE_DB_KEY]: true, [AH_META_CREATED_BY_SESSION_DB_KEY]: true, [AH_META_DEV_CONTAINER_WORKTREE_DB_KEY]: true, [AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY]: true, [AH_META_WORKSPACELESS_DB_KEY]: true, [AH_META_EHCLI_ADOPTED_DB_KEY]: true, [AH_META_EHCLI_LAST_TURN_DB_KEY]: true, [SESSION_META_MULTI_ROOT_KEY]: true, [SESSION_META_FOLDER_PICKER_KEY]: true, [SESSION_ARTIFACTS_KEY]: true, [CHAT_BACKING_METADATA_KEY]: true, [WORKTREE_META_REPOSITORY_ROOT]: true, ...GIT_DB_METADATA_KEYS };
					const m = await ref.object.getMetadataObject(metadataKeys);
					if (m[CHAT_BACKING_METADATA_KEY]) {
						return undefined;
					}
					let updated = sanitized;
					if (m.customTitle) {
						updated = { ...updated, summary: m.customTitle };
					}
					if (m[AH_META_IS_READ_DB_KEY] !== undefined) {
						updated = { ...updated, status: withSessionStatusFlag(updated.status ?? SessionStatus.Idle, SessionStatus.IsRead, m[AH_META_IS_READ_DB_KEY] === 'true') };
					}
					const persistedArchived = m[AH_META_IS_ARCHIVED_DB_KEY] ?? m[AH_META_IS_DONE_DB_KEY];
					if (persistedArchived !== undefined) {
						updated = { ...updated, status: withSessionStatusFlag(updated.status ?? SessionStatus.Idle, SessionStatus.IsArchived, persistedArchived === 'true') };
					}
					const creationReference = parseSessionCreationReference(m[AH_META_CREATED_BY_SESSION_DB_KEY]);
					if (creationReference) {
						updated = { ...updated, _meta: withSessionCreationReference(updated._meta, creationReference) };
					}
					if (m[AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY] !== undefined) {
						updated = { ...updated, _meta: withSessionHasWorkspaceTransitions(updated._meta, m[AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY] === 'true') };
					}
					if (m[AH_META_DEV_CONTAINER_WORKTREE_DB_KEY]) {
						try {
							const metadata = readAgentDevContainerWorktreeMetadata({
								[AH_META_DEV_CONTAINER_WORKTREE_DB_KEY]: JSON.parse(m[AH_META_DEV_CONTAINER_WORKTREE_DB_KEY]),
							});
							if (metadata) {
								updated = { ...updated, _meta: withAgentDevContainerWorktreeMetadata(updated._meta, metadata.handle) };
							}
						} catch (err) {
							this._logService.warn(`[AgentService][listSessions] Failed to parse Dev Container worktree metadata for ${s.session}`, err);
						}
					}
					if (m[META_GIT_STATE]) {
						try {
							const gitState = JSON.parse(m[META_GIT_STATE]) as ISessionGitState;
							updated = { ...updated, _meta: withSessionGitState(updated._meta, gitState) };
						} catch (e) {
							this._logService.warn(`[AgentService][listSessions] Failed to parse Git state for ${s.session}`, e);
						}
					}
					if (m[META_GITHUB_STATE]) {
						try {
							const gitHubState = JSON.parse(m[META_GITHUB_STATE]) as ISessionGitHubState;
							updated = { ...updated, _meta: withSessionGitHubState(updated._meta, gitHubState) };
						} catch (e) {
							this._logService.warn(`[AgentService][listSessions] Failed to parse GitHub state for ${s.session}`, e);
						}
					}
					if (m[META_SOURCE_CONTROL_STATE]) {
						try {
							const sourceControlState = parsePersistedSourceControlState(m[META_SOURCE_CONTROL_STATE]);
							updated = { ...updated, _meta: withSessionSourceControlState(updated._meta, sourceControlState) };
						} catch (e) {
							this._logService.warn(`[AgentService][listSessions] Failed to parse source-control state for ${s.session}`, e);
						}
					}

					if (m[AH_META_WORKSPACELESS_DB_KEY] !== undefined) {
						updated = { ...updated, _meta: withSessionWorkspaceless(updated._meta, m[AH_META_WORKSPACELESS_DB_KEY] === 'true') };
					}
					if (m[AH_META_EHCLI_ADOPTED_DB_KEY] !== undefined) {
						updated = { ...updated, _meta: withSessionEhcliAdopted(updated._meta, m[AH_META_EHCLI_ADOPTED_DB_KEY] === 'true') };
					}
					if (m[AH_META_EHCLI_LAST_TURN_DB_KEY] !== undefined) {
						updated = { ...updated, _meta: withSessionEhcliLastMigratedTurn(updated._meta, m[AH_META_EHCLI_LAST_TURN_DB_KEY]) };
					}
					const multiRoot = parseSessionMultiRootMetadata(m[SESSION_META_MULTI_ROOT_KEY]);
					if (multiRoot) {
						updated = { ...updated, _meta: withSessionMultiRootMetadata(updated._meta, multiRoot) };
					}
					const artifacts = this._readPersistedArtifacts(m[SESSION_ARTIFACTS_KEY], sessionStr, '[AgentService][listSessions]');
					if (artifacts.length > 0) {
						updated = { ...updated, _meta: withSessionArtifacts(updated._meta, artifacts) };
					}
					const folderPickerDecision = parseSessionFolderPickerDecision(m[SESSION_META_FOLDER_PICKER_KEY]);
					if (folderPickerDecision) {
						updated = { ...updated, _meta: withSessionFolderPickerDecision(updated._meta, folderPickerDecision) };
					}

					const worktreeProject = worktreeProjectFromRepositoryRoot(m[WORKTREE_META_REPOSITORY_ROOT]);
					if (worktreeProject) {
						updated = { ...updated, project: worktreeProject };
					}

					return this._changesetCoordinator.decorateListEntry(updated, m as Record<string, string | undefined>);
				} finally {
					ref.dispose();
				}
			} catch (e) {
				this._logService.warn(`[AgentService] Failed to read session metadata overlay for ${s.session}`, e);
			}
			return sanitized;
		})));
		const result = overlaid.filter((s): s is IAgentSessionMetadata => s !== undefined);
		const overlayPhaseMs = Date.now() - overlayPhaseStartedAt;

		const withStatus = result.map(s => {
			const liveSummary = this._stateManager.getSessionSummary(s.session.toString());
			if (liveSummary) {
				return this._withLiveSessionMetadata(s, liveSummary);
			}
			return s;
		});

		const known = new Set(hiddenExternal);
		for (const session of withStatus) {
			known.add(session.session.toString());
		}
		const additions: IAgentSessionMetadata[] = [];
		for (const summary of this._stateManager.getOverlaySessionSummaries()) {
			if (known.has(summary.resource)) {
				continue;
			}
			if (isSubagentSession(summary.resource)) {
				continue;
			}

			const summaryWorkingDirs = summary.workingDirectories;
			additions.push({
				session: URI.parse(summary.resource),
				startTime: Date.parse(summary.createdAt),
				modifiedTime: Date.parse(summary.modifiedAt),
				summary: summary.title,
				status: summary.status,
				activity: summary.activity,
				workingDirectories: summaryWorkingDirs?.map(d => URI.parse(d)),
				...(summary.project ? { project: { uri: URI.parse(summary.project.uri), displayName: summary.project.displayName } } : {}),
				changes: summary.changes,
				...(summary._meta !== undefined ? { _meta: summary._meta } : {}),
			});
		}
		const combined = additions.length > 0 ? [...withStatus, ...additions] : withStatus;
		const now = Date.now();
		const recentSessionKeys = mode === AgentHostExternalSessionsMode.Recent
			? this._getRecentSessionKeys(combined, now)
			: undefined;
		const visible: IAgentSessionMetadata[] = [];
		let hiddenByExternalMode = hiddenExternal.size;
		for (const session of combined) {
			if (this._shouldIncludeSession(session, mode, now, recentSessionKeys)) {
				visible.push(session);
			} else if (!readSessionEhcliAdoptable(session._meta)) {
				hiddenByExternalMode++;
			}
		}
		const total = combined.length + hiddenExternal.size;
		this._logHiddenSessions(hiddenByExternalMode, total, mode);

		const duration = Date.now() - startedAt;
		const message = `[AgentService] listSessions computed ${visible.length} of ${total} session(s) for mode '${mode}' in ${duration}ms (metadata ${metadataPhaseMs}ms, overlay ${overlayPhaseMs}ms, ${additions.length} state-manager fallback)`;
		if (duration >= SLOW_LIST_SESSIONS_THRESHOLD_MS) {
			this._logService.info(message);
		} else {
			this._logService.trace(message);
		}
		return visible;
	}

	private _lastHiddenSessionsLog: string | undefined;

	private _logHiddenSessions(hidden: number, total: number, mode: AgentHostExternalSessionsMode): void {
		const signature = `${hidden}/${total}/${mode}`;
		if (signature === this._lastHiddenSessionsLog) {
			return;
		}
		this._lastHiddenSessionsLog = signature;
		if (hidden > 0) {
			this._logService.info(`[AgentService] listSessions hid ${hidden} of ${total} session(s) (${AgentHostShowExternalSessionsConfigKey}: '${mode}')`);
		}
	}

	private _getExternalSessionsMode(): AgentHostExternalSessionsMode {
		const rootValue = this._configurationService.getRootConfigValues()?.[AgentHostShowExternalSessionsConfigKey];
		if (rootValue === 'all') {
			return AgentHostExternalSessionsMode.Last30Days;
		}
		return this._configurationService.getRootValue(platformRootSchema, AgentHostShowExternalSessionsConfigKey) ?? AgentHostExternalSessionsMode.None;
	}

	private _startChatDiscovery(provider: IAgent, reason: string): void {
		void provider.startChatDiscovery?.().catch(error =>
			this._logService.warn(`[AgentService] Chat discovery for provider ${provider.id} failed after ${reason}`, error));
	}

	private _isExternalSessionOlderThanMaxAge(modifiedTime: number, now: number): boolean {
		return modifiedTime < now - EXTERNAL_SESSION_MAX_AGE_MS;
	}

	private _getRecentSessionKeys(sessions: readonly IAgentSessionMetadata[], now: number): ReadonlySet<string> {
		const supersededBefore = this._getRecentLocalSessionUpdateCutoff(now);
		const recentExternalSessions = sessions
			.filter(session => readSessionExternal(session._meta)
				&& !readSessionEhcliAdoptable(session._meta)
				&& session.modifiedTime >= now - 7 * DAY_MS
				&& session.modifiedTime >= supersededBefore)
			.sort((a, b) => {
				const timeDifference = b.modifiedTime - a.modifiedTime;
				if (timeDifference !== 0) {
					return timeDifference;
				}
				const aKey = a.session.toString();
				const bKey = b.session.toString();
				return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
			})
			.slice(0, RECENT_EXTERNAL_SESSION_LIMIT);
		return new Set(recentExternalSessions.map(session => session.session.toString()));
	}

	private _getRecentLocalSessionUpdateCutoff(now: number): number {
		return this._recentLocalSessionUpdateSnapshot[RECENT_LOCAL_SESSION_UPDATE_LIMIT - 1]?.modifiedTime ?? now - 7 * DAY_MS;
	}

	private _recordRecentLocalSessionUpdate(session: URI, modifiedTime: number): void {
		if (!Number.isFinite(modifiedTime)) {
			return;
		}

		const sessionKey = session.toString();
		const existing = this._recentLocalSessionUpdates.find(entry => entry.session === sessionKey);
		if (existing && existing.modifiedTime >= modifiedTime) {
			return;
		}

		const next = [
			...this._recentLocalSessionUpdates.filter(entry => entry.session !== sessionKey),
			{ session: sessionKey, modifiedTime },
		]
			.sort((a, b) => b.modifiedTime - a.modifiedTime || a.session.localeCompare(b.session))
			.slice(0, RECENT_LOCAL_SESSION_UPDATE_LIMIT);
		if (next.length === this._recentLocalSessionUpdates.length
			&& next.every((entry, index) => entry.session === this._recentLocalSessionUpdates[index].session
				&& entry.modifiedTime === this._recentLocalSessionUpdates[index].modifiedTime)) {
			return;
		}

		this._recentLocalSessionUpdates = next;
		if (!this._storageService.loadError) {
			this._storageService.set(RECENT_LOCAL_SESSION_UPDATES_STORAGE_KEY, next);
		}
	}

	private _readRecentLocalSessionUpdates(): readonly IRecentLocalSessionUpdate[] {
		if (this._storageService.loadError) {
			this._logService.warn('[AgentService] Recent local session updates could not be restored because Agent Host storage failed to load.');
			return [];
		}
		const stored = this._storageService.get<unknown>(RECENT_LOCAL_SESSION_UPDATES_STORAGE_KEY);
		if (stored === undefined) {
			return [];
		}
		if (!Array.isArray(stored)
			|| stored.length > RECENT_LOCAL_SESSION_UPDATE_LIMIT
			|| !stored.every(isRecentLocalSessionUpdate)) {
			this._logService.warn('[AgentService] Ignoring invalid persisted recent local session updates.');
			return [];
		}
		const updates: readonly IRecentLocalSessionUpdate[] = stored;
		if (new Set(updates.map(entry => entry.session)).size !== updates.length) {
			this._logService.warn('[AgentService] Ignoring persisted recent local session updates with duplicate sessions.');
			return [];
		}
		return updates.toSorted((a, b) => b.modifiedTime - a.modifiedTime || a.session.localeCompare(b.session));
	}

	private _shouldIncludeSession(
		session: IAgentSessionMetadata,
		mode = this._getExternalSessionsMode(),
		now = Date.now(),
		recentSessionKeys?: ReadonlySet<string>,
	): boolean {
		if (readSessionEhcliAdoptable(session._meta)) {
			return false;
		}
		if (!readSessionExternal(session._meta)) {
			return true;
		}
		switch (mode) {
			case AgentHostExternalSessionsMode.Recent:
				return session.modifiedTime >= now - 7 * DAY_MS
					&& (recentSessionKeys === undefined || recentSessionKeys.has(session.session.toString()));
			case AgentHostExternalSessionsMode.Last24Hours:
				return session.modifiedTime >= now - DAY_MS;
			case AgentHostExternalSessionsMode.Last7Days:
				return session.modifiedTime >= now - 7 * DAY_MS;
			case AgentHostExternalSessionsMode.Last30Days:
				return !this._isExternalSessionOlderThanMaxAge(session.modifiedTime, now);
			case AgentHostExternalSessionsMode.None:
				return false;
		}
	}

	private _hidesAllExternalSessions(mode: AgentHostExternalSessionsMode): boolean {
		return mode === AgentHostExternalSessionsMode.None;
	}

	async getRegisteredSessions(): Promise<URI[]> {
		return (await this._listRegisteredSessions()).map(s => s.session);
	}

	async isProviderRegistryBackfilled(provider: AgentProvider): Promise<boolean> {
		return this._sessionRegistry.isProviderBackfilled(provider);
	}






	async isLegacyRegistryBackfilled(): Promise<boolean> {
		return this._sessionRegistry.isBackfilled();
	}

	private readonly _announcedSurfacedKeys = new Set<string>();
	private readonly _broadcastExternalSessions = new Set<string>();
	private _sessionListReconciliation = Promise.resolve();
	private _reconciliationInFlight = false;
	private _reconciliationDirty = false;

	private _migrateLegacyEnabledSnapshot: boolean | undefined;

	primeMigrateLegacyGate(): void {
		this._isMigrateLegacyEnabled();
	}

	private _isMigrateLegacyEnabled(): boolean {
		return this._migrateLegacyEnabledSnapshot ??= this._configurationService.getRootValue(platformRootSchema, AgentHostMigrateLegacyCopilotCliEnabledConfigKey) === true;
	}

	private _isAgentMergeEnabled(): boolean {
		return this._configurationService.getRootValue(agentMergeRootConfigSchema, AgentMergeConfigKey.Enabled) === true;
	}

	private _queueSessionListReconciliation(previousMode?: AgentHostExternalSessionsMode): void {
		if (previousMode !== undefined) {
			this._sessionListReconciliation = this._sessionListReconciliation
				.then(() => this._reconcileExternalSessions(previousMode))
				.catch(error => this._logService.warn('[AgentService] External session reconciliation failed', error));
			return;
		}
		if (this._reconciliationInFlight) {
			this._reconciliationDirty = true;
			return;
		}
		this._reconciliationInFlight = true;
		this._reconciliationDirty = false;
		this._sessionListReconciliation = this._sessionListReconciliation
			.then(() => this._reconcileExternalSessions())
			.catch(error => this._logService.warn('[AgentService] External session reconciliation failed', error))
			.finally(() => {
				this._reconciliationInFlight = false;
				if (this._reconciliationDirty) {
					this._reconciliationDirty = false;
					this._queueSessionListReconciliation();
				}
			});
	}

	private async _reconcileExternalSessions(previousMode?: AgentHostExternalSessionsMode): Promise<void> {
		const startedAt = Date.now();
		const previouslyBroadcast = new Set(this._broadcastExternalSessions);
		const previouslyExposed = new Set(previouslyBroadcast);
		for (const session of this._stateManager.getExposedExternalSessionKeys()) {
			previouslyExposed.add(session);
		}
		const listed = previousMode !== undefined
			? this._resolveModeChangeVisibility(await this.listSessions(AgentHostExternalSessionsMode.Last30Days), previousMode, previouslyExposed)
			: await this.listSessions();
		const visible = new Set<string>();
		let published = 0;
		for (const metadata of listed) {
			if (!readSessionExternal(metadata._meta)) {
				continue;
			}
			const key = metadata.session.toString();
			visible.add(key);
			if (!previouslyBroadcast.has(key)) {
				published++;
			}
			if (this._stateManager.getSessionState(key)) {
				this._stateManager.setSessionSummaryPublished(key, true);
			} else {
				const provider = AgentSession.provider(metadata.session);
				if (provider) {
					await this._announceSurfacedSession(metadata, provider);
				}
			}
		}
		let retracted = 0;
		for (const key of previouslyExposed) {
			if (!visible.has(key)) {
				retracted++;
				if (this._stateManager.getSessionState(key)) {
					this._stateManager.setSessionSummaryPublished(key, false);
				} else {
					this._stateManager.retractSurfacedSession(key);
				}
				this._announcedSurfacedKeys.delete(key);
			}
		}
		this._broadcastExternalSessions.clear();
		for (const key of visible) {
			this._broadcastExternalSessions.add(key);
		}
		const duration = Date.now() - startedAt;
		const message = `[AgentService] External session reconciliation done in ${duration}ms (mode: '${this._getExternalSessionsMode()}'${previousMode !== undefined ? `, previous: '${previousMode}'` : ''}): ${published} published, ${retracted} retracted, ${visible.size} visible`;
		if (published > 0 || retracted > 0 || duration >= SLOW_LIST_SESSIONS_THRESHOLD_MS) {
			this._logService.info(message);
		} else {
			this._logService.trace(message);
		}
	}

	private _resolveModeChangeVisibility(
		superset: readonly IAgentSessionMetadata[],
		previousMode: AgentHostExternalSessionsMode,
		previouslyExposed: Set<string>,
	): IAgentSessionMetadata[] {
		const now = Date.now();
		const mode = this._getExternalSessionsMode();
		const recentKeysFor = (candidate: AgentHostExternalSessionsMode) => candidate === AgentHostExternalSessionsMode.Recent
			? this._getRecentSessionKeys(superset, now)
			: undefined;

		const previousRecentKeys = recentKeysFor(previousMode);
		for (const session of superset) {
			if (readSessionExternal(session._meta) && this._shouldIncludeSession(session, previousMode, now, previousRecentKeys)) {
				previouslyExposed.add(session.session.toString());
			}
		}

		const recentKeys = recentKeysFor(mode);
		const visible = superset.filter(session => this._shouldIncludeSession(session, mode, now, recentKeys));
		this._logHiddenSessions(superset.length - visible.length, superset.length, mode);
		return visible;
	}

	private async _announceSurfacedSession(meta: IAgentSessionMetadata, provider: string): Promise<void> {
		const key = meta.session.toString();
		if (!this._shouldIncludeSession(meta) || this._announcedSurfacedKeys.has(key) || this._stateManager.getSessionState(key)) {
			return;
		}
		this._announcedSurfacedKeys.add(key);
		try {
			if (await this._sessionRegistry.isTombstoned(meta.session)) {
				this._announcedSurfacedKeys.delete(key);
				return;
			}
			if (!this._shouldIncludeSession(meta)) {
				this._announcedSurfacedKeys.delete(key);
				return;
			}
			this._stateManager.announceSurfacedSession(this._surfacedSessionSummary(meta, provider));
			if (readSessionExternal(meta._meta)) {
				this._broadcastExternalSessions.add(key);
			}
		} catch (err) {
			this._announcedSurfacedKeys.delete(key);
			throw err;
		}
	}

	private _surfacedSessionSummary(meta: IAgentSessionMetadata, provider: string): SessionSummary {
		return {
			resource: meta.session.toString(),
			provider,
			title: meta.summary ?? '',
			status: withSessionStatusFlag(meta.status ?? SessionStatus.Idle, SessionStatus.IsRead, true),
			createdAt: new Date(meta.startTime).toISOString(),
			modifiedAt: new Date(meta.modifiedTime).toISOString(),
			...(meta.project ? { project: { uri: meta.project.uri.toString(), displayName: meta.project.displayName } } : {}),
			workingDirectories: meta.workingDirectories?.map(d => d.toString()),
			_meta: meta._meta,
		};
	}

	async createSession(config?: IAgentCreateSessionConfig): Promise<URI> {
		const provider = this._providerService.resolveProvider(config?.provider);
		const isEphemeral = config ? readEphemeralSessionMeta(config).isEphemeral === true : false;
		if (!provider) {
			throw new Error(`No agent provider registered for: ${config?.provider ?? '(none)'}`);
		}
		if (config?.session) {
			this._cancelPendingSessionGc(config.session);
			this._sessionResidency.touch(config.session);
		}

		if (config?.workingDirectories && config.workingDirectories.length > 1) {
			const supportsMultiple = !!provider.getDescriptor().capabilities?.multipleWorkingDirectories;
			if (!supportsMultiple) {
				this._logService.warn(`[AgentService] Provider '${provider.id}' does not advertise multipleWorkingDirectories; truncating ${config.workingDirectories.length} working directories to 1.`);
				config = { ...config, workingDirectories: [config.workingDirectories[0]] };
			}
		}

		if (config?.importConversation) {
			const importedTurns = config.importConversation.turns.map(t => ({ ...t, id: generateUuid() }));
			config = { ...config, importConversation: { ...config.importConversation, turns: importedTurns } };
		}

		const initializeSideEffects = this._sideEffects.initialize();
		const sessionConfig = await this._resolveCreatedSessionConfig(provider, config);
		const deferWorktreeCreation = sessionConfig?.values?.[SessionConfigKey.Isolation] === 'worktree' && !config?.importConversation;

		this._logService.trace(`[AgentService] createSession: initializing auto-approver and creating session...`);
		const [, created] = await Promise.all([
			initializeSideEffects,
			this._createProviderSession(provider, config, deferWorktreeCreation),
		]);
		const session = created.session;
		const isIdleProvisional = created.provisional === true && !config?.importConversation;
		this._logService.trace(`[AgentService] createSession: initialization complete`);
		const creationReference = readSessionCreationReference(config?._meta);
		const devContainerWorktree = readAgentDevContainerWorktreeMetadata(config?._meta);
		if ((creationReference || devContainerWorktree) && !isEphemeral) {
			try {
				const metadata: Record<string, string> = {};
				if (creationReference) {
					metadata[AH_META_CREATED_BY_SESSION_DB_KEY] = JSON.stringify(creationReference);
				}
				if (devContainerWorktree) {
					metadata[AH_META_DEV_CONTAINER_WORKTREE_DB_KEY] = JSON.stringify(devContainerWorktree);
				}
				await persistSessionMetadataValues(this._sessionDataService, session.toString(), metadata);
			} catch (err) {
				await this._rollbackProviderSession(provider, session);
				throw err;
			}
		}
		if (isEphemeral) {
			try {
				await this._retryRegistryMutation(
					() => this._sessionRegistry.tombstone(session),
					`tombstoning ephemeral session ${session.toString()}`,
				);
				if (!isIdleProvisional) {
					this._invalidateSessionList();
				}
			} catch (err) {
				await this._rollbackProviderSession(provider, session);
				throw err;
			}
		} else {
			try {
				const registeredAt = Date.now();
				await this._retryRegistryMutation(
					() => this._sessionRegistry.register(session, { provider: provider.id, startTime: registeredAt, modifiedTime: registeredAt, source: 'explicit' }, { checkTombstone: false }),
					`registration for ${session.toString()}`,
				);
				if (!isIdleProvisional) {
					this._invalidateSessionList();
				}
			} catch (err) {
				await this._rollbackProviderSession(provider, session);
				throw err;
			}
		}

		this._cancelPendingSessionGc(session);
		this._sessionResidency.touch(session);

		this._logService.trace(`[AgentService] createSession: provider=${provider.id} model=${config?.model?.id ?? '(default)'}`);
		this._providerService.associateSession(session.toString(), provider.id);

		if (config?.progressToken) {
			let sessions = this._downloadProgressInterest.get(provider.id);
			if (!sessions) {
				sessions = new Set<string>();
				this._downloadProgressInterest.set(provider.id, sessions);
			}
			sessions.add(session.toString());
		}
		this._logService.trace(`[AgentService] createSession returned: ${session.toString()}`);

		const provisionalState = isIdleProvisional
			? (() => {
				const summary = this._buildInitialSummary(provider, session, config, created, '');
				const state = this._stateManager.createSession(summary, { emitNotification: false });
				state.config = sessionConfig;
				state.activeClients = config?.activeClient ? [config.activeClient] : [];
				return state;
			})()
			: undefined;


		const defaultChat = URI.parse(buildDefaultChatUri(session));
		const workingDirectories = config?.workingDirectories;
		const [initialCustomizations, folderPickerDecision] = await Promise.all([
			provider.getChatCustomizations(defaultChat, this._chatContext(session, defaultChat), this._hostCustomizations(session)).catch(err => {
				this._logService.error('[AgentService] createSession: failed to resolve initial customizations', err);
				return undefined;
			}),
			workingDirectories && workingDirectories.length > 1 && !config?.importConversation && provider.computeFolderPickerDecision
				? provider.computeFolderPickerDecision(workingDirectories).catch(err => {
					this._logService.error('[AgentService] createSession: failed to compute folder-picker decision', err);
					return { hidden: false };
				})
				: Promise.resolve(undefined),
		]);

		if (config?.importConversation) {
			const importedTurns = [...config.importConversation.turns];
			const importedTitle = this._buildImportedTitle(importedTurns);
			const summary = this._buildInitialSummary(provider, session, config, created, importedTitle);
			const state = this._stateManager.createSession(summary);
			state.config = sessionConfig;
			this._stateManager.seedDefaultChatTurns(summary.resource, importedTurns);
			state.activeClients = config.activeClient ? [config.activeClient] : [];

			if (importedTurns.length > 0) {
				this._sideEffects.generateForkedTitle(summary.resource, undefined, importedTurns, importedTitle);
			}
		} else {
			const summary = this._buildInitialSummary(provider, session, config, created, '');
			const state = provisionalState ?? this._stateManager.createSession(summary, { emitNotification: true });
			if (!provisionalState) {
				state.config = sessionConfig;
				state.activeClients = config?.activeClient ? [config.activeClient] : [];
			}
		}
		if (initialCustomizations && initialCustomizations.length > 0) {
			this._stateManager.dispatchServerAction(session.toString(), { type: ActionType.SessionCustomizationsChanged, customizations: [...initialCustomizations] });
		}
		if (folderPickerDecision) {
			this._stateManager.setSessionMeta(session.toString(), withSessionFolderPickerDecision(this._stateManager.getSessionState(session.toString())?._meta, folderPickerDecision));
		}
		this._syncAgentMergeIndex(session, undefined, sessionConfig);
		this._serverToolHost.advertise(session.toString());
		if (sessionConfig?.values && Object.keys(sessionConfig.values).length > 0 && !created.provisional) {
			const persistedConfigValues = omitTransientSessionConfigValues(sessionConfig.values);
			if (Object.keys(persistedConfigValues).length > 0) {
				this._persistConfigValues(session, persistedConfigValues);
			}
		}

		this._changesetCoordinator.onSessionCreated(session.toString());

		if (!created.provisional) {
			this._persistWorkspaceless(session, readSessionWorkspaceless(this._stateManager.getSessionSummary(session.toString())?._meta));
			this._persistMultiRoot(session, readSessionMultiRootMetadata(this._stateManager.getSessionSummary(session.toString())?._meta));
			this._persistFolderPickerDecision(session, readSessionFolderPickerDecision(this._stateManager.getSessionSummary(session.toString())?._meta));

			this._stateManager.dispatchServerAction(session.toString(), { type: ActionType.SessionReady });
			const gitHubState = readSessionGitHubState(this._stateManager.getSessionSummary(session.toString())?._meta);
			if (gitHubState) {
				await this._gitStateService.setSessionGitHubState(session.toString(), gitHubState);
			}
		}

		const workingDirectory = created.resolvedWorkingDirectory ?? config?.workingDirectories?.[0];
		void this._gitStateService.refreshSessionGitState(session.toString(), workingDirectory);

		this._sessionResidency.touch(session);
		await this._sessionResidency.reconcile();
		return session;
	}

	async createDetachedWorktree(session: URI, prompt: string): Promise<{ handle: string; worktree: URI }> {
		const sessionChannel = session.toString();
		const state = this._stateManager.getSessionState(sessionChannel);
		if (state?.lifecycle !== SessionLifecycle.Creating) {
			throw new Error(`Cannot create detached worktree for non-creating session: ${sessionChannel}`);
		}

		const sessionId = AgentSession.id(session);
		if (!this._worktree.isWorkingDirectoryPending(sessionId)) {
			throw new Error(`Session is not configured for worktree isolation: ${sessionChannel}`);
		}

		const workingDirectories = this._configurationService.getEffectiveWorkingDirectories(sessionChannel);
		const workingDirectory = workingDirectories?.[0] ? URI.parse(workingDirectories[0]) : undefined;
		if (!workingDirectory) {
			throw new Error(`Cannot create detached worktree without a working directory: ${sessionChannel}`);
		}

		return this._worktree.createDetachedWorktree({
			workingDirectory,
			config: this._configurationService.getSessionConfigValues(sessionChannel),
			prompt,
		});
	}

	setDetachedWorktreeArchived(handle: string, archived: boolean): Promise<void> {
		return this._worktree.setDetachedWorktreeArchived(handle, archived);
	}

	claimDetachedWorktree(handle: string): Promise<void> {
		return this._worktree.claimDetachedWorktree(handle);
	}

	deleteDetachedWorktree(handle: string): Promise<void> {
		return this._worktree.deleteDetachedWorktree(handle);
	}

	reconcileDetachedWorktrees(scope: string, activeHandles: readonly string[]): Promise<void> {
		return this._worktree.reconcileDetachedWorktrees(scope, activeHandles);
	}

	async createChat(session: URI, chat: URI, options?: IAgentCreateChatRequestOptions): Promise<void> {
		const sessionKey = session.toString();
		const provider = this._providerService.getProviderForSession(session);
		if (!provider) {
			throw new Error(`[AgentService] createChat: no provider for session ${sessionKey}`);
		}
		if (!this._supportsChats(provider)) {
			throw new Error(`[AgentService] createChat: provider ${provider.id} does not support multiple chats`);
		}
		let forkedTurns: Turn[] | undefined;
		let forkedTitle: string | undefined;
		let forkedSourceTitle: string | undefined;
		const { sideChat, ...providerOptions } = options ?? {};
		let createOptions: IAgentCreateChatOptions | undefined = providerOptions;
		let peerChatOrigin: ChatOrigin | undefined;
		if (sideChat) {
			const resolvedSideChat = await this._resolveSideChatOrigin(session, sideChat);
			peerChatOrigin = resolvedSideChat.origin;
			createOptions = {
				...providerOptions,
				...(resolvedSideChat.shouldFork
					? {
						fork: {
							source: URI.parse(resolvedSideChat.sourceChat),
							turnId: resolvedSideChat.anchorTurnId ?? sideChat.turnId,
							independentQueue: true,
						},
					}
					: {
						fork: undefined,
					}),
			};
		}
		if (createOptions?.fork && !sideChat) {
			const { sourceChatKey, sourceSessionKey, sourceState } = await this._resolveSessionSourceChat(createOptions.fork.source);
			if (this._stateManager.getChatOrigin(sourceChatKey)?.kind === ChatOriginKind.Tool) {
				throw new Error(`[AgentService] createChat: cannot fork provider-spawned chat ${sourceChatKey}`);
			}
			const sourceTurns = sourceState?.turns ?? [];
			const forkTurnId = createOptions.fork.turnId;
			const forkIndex = sourceTurns.findIndex(t => t.id === forkTurnId);
			if (forkIndex < 0) {
				createOptions = { ...createOptions, fork: undefined };
			} else {
				const slice = sourceTurns.slice(0, forkIndex + 1);
				const turnIdMapping = new Map<string, string>();
				for (const t of slice) {
					turnIdMapping.set(t.id, generateUuid());
				}
				forkedTurns = slice.map(t => ({ ...t, id: turnIdMapping.get(t.id) ?? generateUuid() }));

				peerChatOrigin = { kind: ChatOriginKind.Fork, chat: sourceChatKey, turnId: createOptions.fork.turnId };

				this._persistForkedLocalTurns(sessionKey, sourceChatKey, chat.toString(), slice, forkedTurns, turnIdMapping);

				const forkedTitlePrefix = localize('agentHost.forkedTitlePrefix', "Forked: ");
				forkedSourceTitle = sourceState?.title || this._stateManager.getSessionState(sourceSessionKey)?.title;
				forkedTitle = forkedSourceTitle
					? (forkedSourceTitle.startsWith(forkedTitlePrefix) ? forkedSourceTitle : `${forkedTitlePrefix}${forkedSourceTitle}`)
					: localize('agentHost.forkedChatFallback', "Forked Chat");
				const concreteForkTurnId = this._localTurns.resolveConcreteTurnId(sourceChatKey, createOptions.fork.turnId);
				createOptions = {
					...createOptions,
					fork: {
						...createOptions.fork,
						source: URI.parse(sourceChatKey),
						turnIdMapping,
						...(concreteForkTurnId !== undefined ? { turnId: concreteForkTurnId } : {}),
					},
				};
			}
		}

		const createResult = await this._createChat(provider, chat, session, createOptions);
		const providerData = createResult?.providerData;
		try {
			await this._persistPeerChat(session, chat, providerData, peerChatOrigin, createResult?.inheritedTurnId);
		} catch (error) {
			try {
				await provider.chats.disposeChat(chat, this._chatContext(session, chat));
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], `Failed to persist and roll back chat ${chat.toString()}`);
			}
			throw error;
		}

		this._stateManager.addChat(sessionKey, chat.toString(), {
			...(forkedTitle !== undefined ? { title: forkedTitle } : options?.title !== undefined ? { title: options.title } : {}),
			...(forkedTurns !== undefined ? { turns: forkedTurns } : {}),
			...(providerData !== undefined ? { providerData } : {}),
			...(peerChatOrigin !== undefined ? { origin: peerChatOrigin } : {}),
			...(createResult?.inheritedTurnId !== undefined ? { inheritedTurnId: createResult.inheritedTurnId } : {}),
		});
		this._sessionResidency.touch(session);
		void this._sessionResidency.reconcile();

		if (createResult?.backingSession) {
			await this._markChatBacking(createResult.backingSession, chat);
		}

		if (forkedTurns && forkedTurns.length > 0 && forkedTitle !== undefined) {
			this._sideEffects.generateForkedTitle(sessionKey, chat.toString(), forkedTurns, forkedTitle, forkedSourceTitle);
		}
	}

	private async _resolveSideChatOrigin(session: URI, sideChat: IAgentCreateChatSideChatSource): Promise<{ origin: ChatOrigin; sourceChat: string; selection?: IAgentCreateChatSideChatSelection; anchorTurnId?: string; shouldFork: boolean }> {
		const sessionKey = session.toString();
		const sourceKey = sideChat.source.toString();
		const { sourceChatKey, sourceSessionKey, sourceState } = await this._resolveSessionSourceChat(sideChat.source);
		if (sourceSessionKey !== sessionKey) {
			throw new Error(`[AgentService] createChat: side chat source ${sourceKey} does not belong to session ${sessionKey}`);
		}
		const activeTurn = sourceState?.activeTurn?.id === sideChat.turnId ? sourceState.activeTurn : undefined;
		const hasCompletedTurn = sourceState?.turns.some(t => t.id === sideChat.turnId) ?? false;
		if (!hasCompletedTurn && !activeTurn) {
			throw new Error(`[AgentService] createChat: side chat source turn ${sideChat.turnId} not found in ${sourceKey}`);
		}
		const sourceHasProviderFork = this._stateManager.getChatOrigin(sourceChatKey)?.kind !== ChatOriginKind.Tool;
		let anchorTurnId: string | undefined;
		if (activeTurn) {
			anchorTurnId = resolveLastNonLocalTurnId(sourceState?.turns ?? [], turnId => this._localTurns.isLocal(sourceChatKey, turnId));
		} else if (this._localTurns.isLocal(sourceChatKey, sideChat.turnId)) {
			anchorTurnId = this._localTurns.resolveConcreteTurnId(sourceChatKey, sideChat.turnId);
		}
		const selection = sideChat.selection?.text.trim()
			? sideChat.selection
			: sideChat.selection
				? (() => { throw new Error('[AgentService] createChat: side chat selection text must be non-empty'); })()
				: undefined;
		return {
			origin: {
				kind: ChatOriginKind.SideChat,
				chat: sourceChatKey,
				turnId: sideChat.turnId,
				...(selection ? { selection } : {}),
			},
			sourceChat: sourceChatKey,
			shouldFork: sourceHasProviderFork && (!activeTurn || anchorTurnId !== undefined),
			...(selection ? { selection } : {}),
			...(anchorTurnId ? { anchorTurnId } : {}),
		};
	}

	private async _resolveSessionSourceChat(source: URI): Promise<{ sourceChatKey: string; sourceSessionKey: string; sourceState: ReturnType<AgentHostStateManager['getChatState']> | undefined }> {
		const sourceKey = source.toString();
		const sourceSessionKey = isAhpChatChannel(sourceKey) ? parseRequiredSessionUriFromChatUri(sourceKey) : sourceKey;
		const defaultChatKey = this._stateManager.getSessionState(sourceSessionKey)?.defaultChat ?? buildDefaultChatUri(sourceSessionKey);
		const isDefaultSource = sourceKey === sourceSessionKey || isDefaultChatUri(sourceKey);
		const sourceChatKey = isDefaultSource ? defaultChatKey : sourceKey;
		return {
			sourceSessionKey,
			sourceChatKey,
			sourceState: isDefaultSource
				? (this._stateManager.getChatState(defaultChatKey) ?? this._stateManager.getDefaultChatState(sourceSessionKey))
				: await this._stateManager.resolveChatState(sourceChatKey),
		};
	}

	async disposeChat(session: URI, chat: URI): Promise<void> {
		const sessionKey = session.toString();
		const chatKey = chat.toString();
		const provider = this._providerService.getProviderForSession(session);
		this._disposingPeerChats.add(chatKey);
		try {
			await this._checkpointService.discardChatTurnStartCheckpoints(session, chat);
			if (provider) {
				await this._disposeChat(provider, chat);
			}
			await this._removePersistedPeerChat(session, chat);
			this._sideEffects.cancelSubagentSessions(chatKey);
			this._sideEffects.clearChannelTelemetry(chatKey);
			this._chatContributions.disposeChatState(chatKey);
			this._stateManager.removeChat(sessionKey, chatKey);
		} finally {
			this._disposingPeerChats.delete(chatKey);
		}
	}


	private _supportsChats(provider: IAgent): boolean {
		return !!provider.getDescriptor().capabilities?.multipleChats;
	}

	private _chatContext(session: URI, chat: URI): IAgentChatContext {
		return createAgentChatContext(this._stateManager, session, chat);
	}

	private _hostCustomizations(session: URI): readonly Customization[] | undefined {
		return this._stateManager.getSessionState(session.toString())?.customizations;
	}

	private _mintSessionUri(provider: IAgent): URI {
		return AgentSession.uri(provider.id, generateUuid());
	}

	private async _createProviderSession(provider: IAgent, config: IAgentCreateSessionConfig | undefined, deferWorktreeCreation: boolean): Promise<IAgentCreateSessionResult> {
		const requestedSessionId = deferWorktreeCreation && config?.session ? AgentSession.id(config.session) : undefined;
		if (requestedSessionId) {
			this._worktree.notePending(requestedSessionId);
		}

		let created: IAgentCreateSessionResult | undefined;
		try {
			const providerConfig = config ? this._toProviderConfig(config) : undefined;
			const session = config?.session ?? this._mintSessionUri(provider);
			const defaultChatUri = URI.parse(buildDefaultChatUri(session));
			const boundConfig: IAgentCreateSessionConfig = { ...(providerConfig ?? {}), session };
			const result = await provider.chats.createChat(defaultChatUri, this._chatContext(session, defaultChatUri), this._toCreateChatOptions(boundConfig));
			created = {
				session,
				...(result?.project ? { project: result.project } : {}),
				...(result?.resolvedWorkingDirectory ? { resolvedWorkingDirectory: result.resolvedWorkingDirectory } : {}),
				...(result?.provisional ? { provisional: true } : {}),
				...(result ? { chat: result } : {}),
			};
			if (deferWorktreeCreation && created.provisional) {
				this._worktree.notePending(AgentSession.id(created.session));
			}
			await this._persistDefaultChatBacking(created);
			return created;
		} catch (err) {
			if (created) {
				await this._rollbackProviderSession(provider, created.session);
			}
			throw err;
		} finally {
			const returnedPendingSessionId = created?.provisional ? AgentSession.id(created.session) : undefined;
			if (requestedSessionId && requestedSessionId !== returnedPendingSessionId) {
				this._worktree.clearPending(requestedSessionId);
			}
		}
	}

	private async _rollbackProviderSession(provider: IAgent, session: URI): Promise<void> {
		const defaultChatUri = URI.parse(buildDefaultChatUri(session));
		try {
			await provider.chats.disposeChat(defaultChatUri, this._chatContext(session, defaultChatUri));
		} catch (disposeError) {
			this._logService.error(disposeError, `[AgentService] Failed to roll back default chat of provider session ${session.toString()}`);
		}
	}

	private _getSessionChatsInTeardownOrder(session: URI): URI[] {
		const state = this._stateManager.getSessionState(session.toString());
		return this._orderSessionChatsForTeardown(session, state?.chats.map(chat => chat.resource) ?? []);
	}

	private async _getSessionChatsForDisposal(provider: IAgent, session: URI): Promise<URI[]> {
		const state = this._stateManager.getSessionState(session.toString());
		if (state) {
			return this._getSessionChatsInTeardownOrder(session);
		}
		const persisted = await this._readPersistedPeerChatCatalog(session);
		const peerChats = persisted?.map(chat => chat.uri)
			?? (await provider.listLegacyChatBackings?.(session))?.map(chat => chat.uri.toString())
			?? [];
		return this._orderSessionChatsForTeardown(session, peerChats);
	}

	private _orderSessionChatsForTeardown(session: URI, chats: readonly string[]): URI[] {
		const defaultChat = buildDefaultChatUri(session.toString());
		const result: URI[] = [];
		const seen = new Set<string>();
		for (const chat of chats) {
			if (chat !== defaultChat && !seen.has(chat)) {
				seen.add(chat);
				result.push(URI.parse(chat));
			}
		}
		if (!seen.has(defaultChat)) {
			result.push(URI.parse(defaultChat));
		}
		return result;
	}

	private async _disposeSession(provider: IAgent, session: URI): Promise<void> {
		await this._defaultChatBackingWrites.get(session.toString())?.catch(() => { });
		let firstError: unknown;
		for (const chat of await this._getSessionChatsForDisposal(provider, session)) {
			try {
				await provider.chats.disposeChat(chat, this._chatContext(session, chat));
			} catch (err) {
				firstError ??= err;
			}
		}
		if (firstError !== undefined) {
			throw firstError;
		}
	}

	private async _canReleaseSession(provider: IAgent, session: URI, chats: readonly URI[]): Promise<boolean> {
		for (const chat of chats) {
			if (provider.chats.canReleaseChat && !await provider.chats.canReleaseChat(chat, this._chatContext(session, chat))) {
				return false;
			}
		}
		return true;
	}

	private async _releaseSession(provider: IAgent, session: URI, chats: readonly URI[]): Promise<void> {
		await this._defaultChatBackingWrites.get(session.toString())?.catch(() => { });
		let firstError: unknown;
		for (const chat of chats) {
			try {
				await provider.chats.releaseChat(chat, this._chatContext(session, chat));
			} catch (err) {
				firstError ??= err;
			}
		}
		if (firstError !== undefined) {
			throw firstError;
		}
	}

	private async _getChatMessages(provider: IAgent, chat: URI, session: URI, origin?: ChatOrigin, workspaceTransitionsPromise?: Promise<ReadonlyMap<string, string> | undefined>): Promise<readonly Turn[]> {
		const context = { ...this._chatContext(session, chat), ...(origin ? { origin } : {}) };
		const transitionsPromise = workspaceTransitionsPromise ?? this._loadWorkspaceTransitions(chat);
		this._logService.trace(`[AgentService] getChatMessages start: chat=${chat.toString()}`);
		const [providerTurns, workspaceTransitions] = await Promise.all([
			provider.chats.getMessages(chat, context),
			transitionsPromise,
		]);
		this._logService.trace(`[AgentService] getChatMessages: provider returned ${providerTurns.length} turn(s) for chat=${chat.toString()}`);
		return this._chatContributions.hydrateTurns({ session: session.toString(), chat: chat.toString(), workspaceTransitions }, providerTurns);
	}

	private async _loadWorkspaceTransitions(chat: URI): Promise<ReadonlyMap<string, string> | undefined> {
		const storage = chatStorageUri(chat);
		if (!storage) {
			return undefined;
		}
		try {
			const database = await this._sessionDataService.tryOpenDatabase(storage);
			return database ? this._readWorkspaceTransitions(database, storage, true) : undefined;
		} catch (error) {
			this._logService.warn(`[AgentService] Failed to open workspace transition storage for ${storage.toString()}`, error);
			return undefined;
		}
	}

	private async _readWorkspaceTransitions(database: IReference<ISessionDatabase>, storage: URI, requireMarker = false): Promise<ReadonlyMap<string, string> | undefined> {
		try {
			if (requireMarker && await database.object.getMetadata(AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY) !== 'true') {
				return undefined;
			}
			return await database.object.getTurnWorkspaceTransitions();
		} catch (error) {
			this._logService.warn(`[AgentService] Failed to restore workspace transitions for ${storage.toString()}`, error);
			return undefined;
		} finally {
			database.dispose();
		}
	}

	private async _interleaveLocalTurns(sessionStr: string, chatUri: string, turns: readonly Turn[]): Promise<Turn[]> {
		const records = await this._localTurns.loadForChat(sessionStr, chatUri);
		if (records.length === 0) {
			return [...turns];
		}
		const knownIds = new Set(turns.map(t => t.id));
		const byAnchor = new Map<string, Turn[]>();
		const head: Turn[] = [];
		for (const record of records) {
			let turn: Turn;
			try {
				turn = JSON.parse(record.payload) as Turn;
			} catch {
				continue;
			}
			if (record.anchorTurnId === undefined) {
				head.push(turn);
			} else if (knownIds.has(record.anchorTurnId)) {
				const list = byAnchor.get(record.anchorTurnId) ?? [];
				list.push(turn);
				byAnchor.set(record.anchorTurnId, list);
			}
		}
		const merged: Turn[] = [...head];
		for (const turn of turns) {
			merged.push(turn);
			const locals = byAnchor.get(turn.id);
			if (locals) {
				merged.push(...locals);
			}
		}
		return merged;
	}

	private _persistForkedLocalTurns(persistSession: string, sourceChatUri: string, newChatUri: string, originalSlice: readonly Turn[], forkedTurns: readonly Turn[], mapping: ReadonlyMap<string, string>): void {
		for (let i = 0; i < originalSlice.length; i++) {
			const original = originalSlice[i];
			if (!this._localTurns.isLocal(sourceChatUri, original.id)) {
				continue;
			}
			const originalAnchor = this._localTurns.resolveConcreteTurnId(sourceChatUri, original.id);
			const newAnchor = originalAnchor !== undefined ? mapping.get(originalAnchor) : undefined;
			this._localTurns.record(persistSession, newChatUri, forkedTurns[i], newAnchor);
		}
	}

	private async _createChat(provider: IAgent, chat: URI, session: URI, options: IAgentCreateChatOptions | undefined): Promise<IAgentCreateChatResult | void> {
		const placement = this._buildChatPlacement(session);
		const convOptions: IAgentCreateChatOptions | undefined = (options?.title !== undefined || options?.model !== undefined || placement)
			? {
				...(options?.title !== undefined ? { title: options.title } : {}),
				...(options?.model !== undefined ? { model: options.model } : {}),
				...(placement?.workingDirectories ? { workingDirectories: placement.workingDirectories } : {}),
				...(placement?.project ? { project: placement.project } : {}),
				...(placement?.config ? { config: placement.config } : {}),
			}
			: undefined;
		const context = this._chatContext(session, chat);
		const result = await provider.chats.createChat(chat, context, options?.fork ? { ...convOptions, fork: options.fork } : convOptions);
		return result;
	}

	private _toCreateChatOptions(config: IAgentCreateSessionConfig): IAgentCreateChatOptions {
		return {
			...(config.session && this._stateManager.isEphemeralSession(config.session.toString()) ? { isEphemeral: true } : {}),
			...(readChatSurfaceMeta(config)?.surface === 'editorInline' ? { hasScopedEditSurface: true } : {}),
			...(config.model ? { model: config.model } : {}),
			...(config.agent ? { agent: config.agent } : {}),
			...(config.workingDirectories ? { workingDirectories: config.workingDirectories } : {}),
			...(config.config ? { config: config.config } : {}),
			...(config.activeClient ? { activeClient: config.activeClient } : {}),
			...(!config.importConversation ? { deferBacking: true } : {}),
			...(config.importConversation ? { importConversation: config.importConversation } : {}),
		};
	}

	private _buildChatPlacement(session: URI): Pick<IAgentCreateChatOptions, 'workingDirectories' | 'project' | 'config'> | undefined {
		const state = this._stateManager.getSessionState(session.toString());
		const workingDirectories = state?.workingDirectories?.map(directory => typeof directory === 'string' ? URI.parse(directory) : directory) ?? [];
		const resolvedPrimary = this._worktree.getResolvedWorktree(AgentSession.id(session));
		if (resolvedPrimary) {
			workingDirectories[0] = resolvedPrimary;
		}
		if (workingDirectories.length === 0) {
			return undefined;
		}
		const config = this._configurationService.getSessionConfigValues(session.toString());
		return {
			workingDirectories,
			...(state?.project ? { project: { uri: URI.parse(state.project.uri), displayName: state.project.displayName } } : {}),
			...(config && Object.keys(config).length > 0 ? { config } : {}),
		};
	}

	private async _disposeChat(provider: IAgent, chat: URI): Promise<void> {
		const session = URI.parse(parseRequiredSessionUriFromChatUri(chat));
		await provider.chats.disposeChat(chat, this._chatContext(session, chat));
	}

	private _buildImportedTitle(turns: readonly Turn[]): string {
		const firstText = turns.find(t => t.message?.text?.trim())?.message.text.trim();
		if (!firstText) {
			return localize('agentHost.importedSessionFallback', "New Session");
		}
		const MAX = 60;
		return firstText.length > MAX ? `${firstText.slice(0, MAX)}...` : firstText;
	}

	private _buildInitialSummary(provider: IAgent, session: URI, config: IAgentCreateSessionConfig | undefined, created: { project?: { uri: URI; displayName: string }; resolvedWorkingDirectory?: URI }, title: string): SessionSummary {
		const now = new Date().toISOString();
		const explicitGitHubState = readSessionGitHubState(config?._meta);
		const explicitMultiRoot = readSessionMultiRootMetadata(config?._meta);
		let _meta = withSessionGitHubState(undefined, explicitGitHubState);
		_meta = withSessionMultiRootMetadata(_meta, explicitMultiRoot);
		_meta = withEphemeralSessionMeta(_meta, config ? readEphemeralSessionMeta(config).isEphemeral : undefined);
		_meta = withChatSurfaceMeta(_meta, readChatSurfaceMeta(config ?? {}));
		_meta = withSessionExternal(_meta, false);
		const creationReference = readSessionCreationReference(config?._meta);
		_meta = creationReference ? withSessionCreationReference(_meta, creationReference) : _meta;
		const devContainerWorktree = readAgentDevContainerWorktreeMetadata(config?._meta);
		_meta = devContainerWorktree ? withAgentDevContainerWorktreeMetadata(_meta, devContainerWorktree.handle) : _meta;
		_meta = !config?.workingDirectories
			? withSessionWorkspaceless(_meta, true)
			: _meta;
		return {
			resource: session.toString(),
			provider: provider.id,
			title,
			status: SessionStatus.Idle,
			createdAt: now,
			modifiedAt: now,
			...(created.project ? { project: { uri: created.project.uri.toString(), displayName: created.project.displayName } } : {}),
			workingDirectories: reconcileWorkingDirectories(config?.workingDirectories, created.resolvedWorkingDirectory ? [created.resolvedWorkingDirectory] : undefined),
			...(_meta ? { _meta } : {}),
		};
	}

	private _onDidMaterializeChat(e: IAgentMaterializeChatEvent): void {
		const session = URI.parse(parseRequiredSessionUriFromChatUri(e.chat));
		const sessionKey = session.toString();
		this._clearDownloadProgressInterest(sessionKey);
		const state = this._stateManager.getSessionState(sessionKey);
		if (!state) {
			this._logService.warn(`[AgentService] onDidMaterializeChat for unknown session: ${sessionKey}`);
			return;
		}
		const currentSummary = this._stateManager.getSessionSummary(sessionKey);
		if (!currentSummary) {
			this._logService.warn(`[AgentService] onDidMaterializeChat missing summary for session: ${sessionKey}`);
			return;
		}
		if (e.chat.toString() !== state.defaultChat) {
			if (!state.chats.some(chat => chat.resource.toString() === e.chat.toString())) {
				return;
			}
			if (e.result?.providerData !== undefined) {
				this._onChatDataChanged({ chat: e.chat, providerData: e.result.providerData });
			}
			if (e.result?.backingSession) {
				void this._markChatBacking(e.result.backingSession, e.chat);
			}
			return;
		}
		if (e.result) {
			const write = this._persistDefaultChatBacking({ session, chat: e.result });
			this._defaultChatBackingWrites.set(sessionKey, write);
			void write.catch(err => this._logService.error(err, `[AgentService] Failed to persist materialized default-chat backing for ${sessionKey}`));
			const clearWrite = () => {
				if (this._defaultChatBackingWrites.get(sessionKey) === write) {
					this._defaultChatBackingWrites.delete(sessionKey);
				}
			};
			void write.then(clearWrite, clearWrite);
		}
		const project = this._worktree.sessionWorktreeProject(AgentSession.id(session)) ?? e.project;
		const currentSet = currentSummary.workingDirectories?.map(d => URI.parse(d));
		const summary: SessionSummary = {
			...currentSummary,
			...(project ? { project: { uri: project.uri.toString(), displayName: project.displayName } } : {}),
			workingDirectories: reconcileWorkingDirectories(currentSet, e.workingDirectories),
			modifiedAt: new Date().toISOString(),
		};
		const configValues = state.config?.values;
		if (configValues && Object.keys(configValues).length > 0) {
			const persistedConfigValues = omitTransientSessionConfigValues(configValues);
			if (Object.keys(persistedConfigValues).length > 0) {
				this._persistConfigValues(session, persistedConfigValues);
			}
		}
		this._persistWorkspaceless(session, readSessionWorkspaceless(summary._meta));
		this._persistMultiRoot(session, readSessionMultiRootMetadata(summary._meta));
		this._persistFolderPickerDecision(session, readSessionFolderPickerDecision(summary._meta));
		this._stateManager.markSessionPersisted(sessionKey, summary);
		this._stateManager.dispatchServerAction(sessionKey, { type: ActionType.SessionReady });
		const gitHubState = readSessionGitHubState(summary._meta);
		if (gitHubState) {
			void this._gitStateService.setSessionGitHubState(sessionKey, gitHubState);
		}

		void this._gitStateService.refreshSessionGitState(sessionKey, e.workingDirectories?.[0]);

		this._changesetCoordinator.onSessionMaterialized(sessionKey);
	}

	private _clearDownloadProgressInterest(sessionKey: string): void {
		for (const [provider, sessions] of this._downloadProgressInterest) {
			if (sessions.delete(sessionKey) && sessions.size === 0) {
				this._downloadProgressInterest.delete(provider);
			}
		}
	}





















	emitDownloadProgress(packageId: string, displayName: string, receivedBytes: number, totalBytes: number | undefined, terminal: boolean, explicitlyRequested = false): void {
		const sessions = this._downloadProgressInterest.get(packageId);
		if ((!sessions || sessions.size === 0) && !explicitlyRequested) {
			return;
		}
		const total = terminal ? receivedBytes : totalBytes;
		const message = localize('agentHost.download.agentSdkTitle', "Downloading {0} agent", displayName);
		this._stateManager.emitProgress({ progressToken: packageId, progress: receivedBytes, total, message });
		if (terminal) {
			this._downloadProgressInterest.delete(packageId);
		}
	}

	private _persistWorkspaceless(session: URI, workspaceless: boolean): void {
		let ref;
		try {
			ref = this._sessionDataService.openDatabase(session);
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to open session database to persist workspaceless for ${session.toString()}: ${toErrorMessage(err)}`);
			return;
		}
		ref.object.setMetadata(AH_META_WORKSPACELESS_DB_KEY, workspaceless ? 'true' : 'false').catch(err => {
			this._logService.warn(`[AgentService] Failed to persist workspaceless for ${session.toString()}: ${toErrorMessage(err)}`);
		}).finally(() => {
			ref.dispose();
		});
	}

	private _persistMultiRoot(session: URI, multiRoot: ReturnType<typeof readSessionMultiRootMetadata>): void {
		if (!multiRoot) {
			return;
		}
		let ref;
		try {
			ref = this._sessionDataService.openDatabase(session);
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to open session database to persist multi-root metadata for ${session.toString()}: ${toErrorMessage(err)}`);
			return;
		}
		ref.object.setMetadata(SESSION_META_MULTI_ROOT_KEY, JSON.stringify(multiRoot)).catch(err => {
			this._logService.warn(`[AgentService] Failed to persist multi-root metadata for ${session.toString()}: ${toErrorMessage(err)}`);
		}).finally(() => {
			ref.dispose();
		});
	}

	private _persistFolderPickerDecision(session: URI, decision: ReturnType<typeof readSessionFolderPickerDecision>): void {
		if (!decision) {
			return;
		}
		let ref;
		try {
			ref = this._sessionDataService.openDatabase(session);
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to open session database to persist folder-picker decision for ${session.toString()}: ${toErrorMessage(err)}`);
			return;
		}
		ref.object.setMetadata(SESSION_META_FOLDER_PICKER_KEY, JSON.stringify(decision)).catch(err => {
			this._logService.warn(`[AgentService] Failed to persist folder-picker decision for ${session.toString()}: ${toErrorMessage(err)}`);
		}).finally(() => {
			ref.dispose();
		});
	}

	private _persistConfigValues(session: URI, values: Record<string, unknown>): void {
		let ref;
		try {
			ref = this._sessionDataService.openDatabase(session);
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to open session database to persist configValues for ${session.toString()}: ${toErrorMessage(err)}`);
			return;
		}
		ref.object.setMetadata('configValues', JSON.stringify(values)).catch(err => {
			this._logService.warn(`[AgentService] Failed to persist configValues for ${session.toString()}: ${toErrorMessage(err)}`);
		}).finally(() => {
			ref.dispose();
		});
	}

	private _persistAnnotations(envelope: ActionEnvelope): void {
		if (!isAnnotationsAction(envelope.action)) {
			return;
		}
		const parsed = parseAnnotationsUri(envelope.channel);
		const state = this._stateManager.getAnnotationsState(envelope.channel);
		if (!parsed || !state) {
			return;
		}

		const session = URI.parse(parsed.sessionUri);
		const storage = this._annotationsStorage(session);
		try {
			const serialized = JSON.stringify(state);
			const ref = this._sessionDataService.openDatabase(storage.session);
			ref.object.setMetadata(storage.key, serialized).catch(err => {
				this._logService.warn(`[AgentService] Failed to persist annotations for ${parsed.sessionUri}: ${toErrorMessage(err)}`);
			}).finally(() => {
				ref.dispose();
			});
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to persist annotations for ${parsed.sessionUri}: ${toErrorMessage(err)}`);
		}
	}

	private _annotationsStorage(session: URI): { session: URI; key: string } {
		const subagent = parseSubagentSessionUri(session);
		return subagent
			? { session: subagent.parentSession, key: `${ANNOTATIONS_METADATA_KEY}:${session.toString()}` }
			: { session, key: ANNOTATIONS_METADATA_KEY };
	}

	private async _resolveCreatedSessionConfig(provider: IAgent, config: IAgentCreateSessionConfig | undefined): Promise<SessionConfigState | undefined> {
		if (!config?.config && config?.workingDirectories === undefined) {
			return undefined;
		}
		const params: IAgentResolveSessionConfigParams = {
			provider: provider.id,
			workingDirectory: config.workingDirectories?.[0],
			config: config.config,
		};
		try {
			const resolved = await this._withHostSessionConfigContributions(await provider.resolveChatConfig(this._toProviderConfig(params)), params);
			return { schema: resolved.schema, values: resolved.values };
		} catch (err) {
			this._logService.error(`[AgentService] Failed to resolve created session config for provider ${provider.id}`, err);
			return config.config ? { schema: { type: 'object', properties: {} }, values: config.config } : undefined;
		}
	}

	async resolveSessionConfig(params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult> {
		const provider = this._providerService.resolveProvider(params.provider);
		if (!provider) {
			throw new Error(`No agent provider registered for: ${params.provider ?? '(none)'}`);
		}
		return this._withHostSessionConfigContributions(await provider.resolveChatConfig(this._toProviderConfig(params)), params);
	}

	private async _withHostSessionConfigContributions(result: ResolveSessionConfigResult, params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult> {
		result = await this._withWorktreeConfigContribution(result, params);
		result = this._withAgentMergeConfigContribution(result, params.config);
		return result;
	}

	private async _withWorktreeConfigContribution(result: ResolveSessionConfigResult, params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult> {
		const iso = await this._worktree.resolveIsolationConfig({ workingDirectory: params.workingDirectory, config: params.config });
		if (!iso) {
			return result;
		}
		const properties: Record<string, SessionConfigPropertySchema> = {
			[SessionConfigKey.Isolation]: iso.isolationProperty.protocol,
			...omitHostOwnedSessionConfig(result.schema.properties),
		};
		if (iso.branchProperty) {
			properties[SessionConfigKey.Branch] = iso.branchProperty.protocol;
		}
		if (iso.worktreeBranchPrefixProperty) {
			properties[SessionConfigKey.WorktreeBranchPrefix] = iso.worktreeBranchPrefixProperty.protocol;
		}
		if (iso.worktreeBranchTrackProperty) {
			properties[SessionConfigKey.WorktreeBranchTrack] = iso.worktreeBranchTrackProperty.protocol;
		}
		if (iso.worktreeCreateNewBranchProperty) {
			properties[SessionConfigKey.WorktreeCreateNewBranch] = iso.worktreeCreateNewBranchProperty.protocol;
		}
		if (iso.worktreeIncludeFilesProperty) {
			properties[SessionConfigKey.WorktreeIncludeFiles] = iso.worktreeIncludeFilesProperty.protocol;
		}
		const values = omitHostOwnedSessionConfig(result.values);
		values[SessionConfigKey.Isolation] = iso.isolationValue;
		if (iso.branchProperty && iso.branchValue !== undefined) {
			values[SessionConfigKey.Branch] = iso.branchValue;
		}
		if (iso.worktreeBranchPrefixProperty && typeof params.config?.[SessionConfigKey.WorktreeBranchPrefix] === 'string') {
			values[SessionConfigKey.WorktreeBranchPrefix] = params.config[SessionConfigKey.WorktreeBranchPrefix];
		}
		if (iso.worktreeBranchTrackProperty && typeof params.config?.[SessionConfigKey.WorktreeBranchTrack] === 'boolean') {
			values[SessionConfigKey.WorktreeBranchTrack] = params.config[SessionConfigKey.WorktreeBranchTrack];
		}
		if (iso.worktreeCreateNewBranchProperty && typeof params.config?.[SessionConfigKey.WorktreeCreateNewBranch] === 'boolean') {
			values[SessionConfigKey.WorktreeCreateNewBranch] = params.config[SessionConfigKey.WorktreeCreateNewBranch];
		}
		if (iso.worktreeIncludeFilesProperty
			&& Array.isArray(params.config?.[SessionConfigKey.WorktreeIncludeFiles])
			&& params.config[SessionConfigKey.WorktreeIncludeFiles].every(pattern => typeof pattern === 'string')) {
			values[SessionConfigKey.WorktreeIncludeFiles] = params.config[SessionConfigKey.WorktreeIncludeFiles];
		}
		return { schema: { ...result.schema, properties }, values };
	}

	private _withAgentMergeConfigContribution(result: ResolveSessionConfigResult, config: Record<string, unknown> | undefined): ResolveSessionConfigResult {
		const values = { ...result.values };
		for (const key of [SessionConfigKey.AgentMerge, SessionConfigKey.AgentMergeController]) {
			if (config && Object.hasOwn(config, key)) {
				values[key] = config[key];
			}
		}
		return { ...result, values };
	}

	async sessionConfigCompletions(params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		if (params.property === SessionConfigKey.Branch && this._worktree.supported) {
			return this._worktree.branchCompletions(params.workingDirectory, params.query);
		}
		const provider = this._providerService.resolveProvider(params.provider);
		if (!provider) {
			throw new Error(`No agent provider registered for: ${params.provider ?? '(none)'}`);
		}
		return provider.chatConfigCompletions(this._toProviderConfig(params));
	}

	async completions(params: CompletionsParams): Promise<CompletionsResult> {
		return this._completions.completions(params);
	}

	get automationCapabilities(): AutomationCapabilities | undefined {
		return this._automationService.capabilities;
	}

	async listAutomationTriggerDefinitions(params: ListAutomationTriggerDefinitionsParams): Promise<ListAutomationTriggerDefinitionsResult> {
		return this._automationService.listTriggerDefinitions(params);
	}

	async runAutomation(params: RunAutomationParams): Promise<RunAutomationResult> {
		return this._automationService.runAutomation(params);
	}

	async fetchAutomationRuns(params: FetchAutomationRunsParams): Promise<FetchAutomationRunsResult> {
		return this._automationService.fetchAutomationRuns(params);
	}

	async getCompletionTriggerCharacters(): Promise<readonly string[]> {
		return this._completions.triggerCharacters;
	}

	async disposeSession(session: URI): Promise<void> {
		this._logService.trace(`[AgentService] disposeSession: ${session.toString()}`);
		await this._sessionResidency.runDisposal(session, () => this._doDisposeSession(session));
	}

	private async _doDisposeSession(session: URI): Promise<void> {
		const sessionKey = session.toString();
		this._cancelPendingSessionGc(session);
		const isEphemeral = this._stateManager.isEphemeralSession(sessionKey);
		const isIdleProvisional = this._stateManager.isIdleProvisionalSession(sessionKey);
		this._stateManager.invalidateSessionChatResolutions(session.toString());
		const sessionChats = this._stateManager.getSessionState(session.toString())?.chats ?? [];
		for (const chat of sessionChats) {
			this._sideEffects.clearChannelTelemetry(chat.resource);
		}
		this._sideEffects.clearChannelTelemetry(session.toString());
		const workingDirectories = this._configurationService.getEffectiveWorkingDirectories(session.toString());
		const sessionId = AgentSession.id(session);
		const worktree = await this._worktree.prepareSessionDeletion(session, sessionId);
		const provider = this._providerService.getProviderForSession(session);
		if (provider) {
			await this._disposeSession(provider, session);
		}
		if (!isEphemeral) {
			await this._retryRegistryMutation(
				() => this._sessionRegistry.tombstone(session),
				`unregistration for ${session.toString()}`,
			);
		}
		if (!isIdleProvisional) {
			this._invalidateSessionList();
		}
		if (provider) {
			this._providerService.releaseSession(session.toString());
			this._clearDownloadProgressInterest(session.toString());
		}
		this._sideEffects.clearSessionTitleState(session.toString(), sessionChats.map(chat => chat.resource));
		this._chatContributions.disposeSessionState(session.toString());
		await this._whenSessionDataIdle(session);
		await this._sessionDataService.deleteSessionData(session, workingDirectories);
		await this._worktree.removeSessionWorktree(sessionId, worktree);
		this._changesetCoordinator.onSessionDisposed(session.toString());
		this._sideEffects.clearInputRequestsForSession(session.toString());
		this._sideEffects.removeSubagentSessions(session.toString());
		this._stateManager.deleteSession(session.toString());
		if (isEphemeral) {
			await this._retryRegistryMutation(
				() => this._sessionRegistry.clearTombstone(session),
				`clearing ephemeral session tombstone for ${session.toString()}`,
			);
		}
	}

	private async _whenSessionDataIdle(session: URI): Promise<void> {
		const ref = this._sessionDataService.openDatabase(session);
		try {
			await ref.object.whenIdle();
		} finally {
			ref.dispose();
		}
	}


	async createTerminal(params: CreateTerminalParams): Promise<void> {
		await this._terminalManager.createTerminal(params);
	}

	async disposeTerminal(terminal: URI): Promise<void> {
		this._terminalManager.disposeTerminal(terminal.toString());
	}

	async subscribe(resource: URI, clientId: string, isActive?: () => boolean): Promise<IStateSnapshot> {
		this._logService.trace(`[AgentService] subscribe: ${resource.toString()}`);
		const resourceStr = resource.toString();
		const subscribe = async (telemetry: IAgentHostSessionOpenTelemetryScope): Promise<IStateSnapshot> => {
			const restoreSession = (session: URI) => this.restoreSession(session, joinedRestore => telemetry.restoreStarted(joinedRestore));
			await this._sessionResidency.waitForRelease(resource);
			if (this._store.isDisposed || (isActive && !isActive())) {
				throw new Error(`Subscription cancelled: ${resourceStr}`);
			}
			this.addSubscriber(resource, clientId);
			const terminalState = this._terminalManager.getTerminalState(resourceStr);
			if (terminalState) {
				telemetry.setServedFromMemory(true);
				return { resource: resourceStr, state: terminalState, fromSeq: this._stateManager.serverSeq };
			}

			let snapshot = this._stateManager.getSnapshot(resourceStr);
			telemetry.setServedFromMemory(!!snapshot);
			const parsedChangeset = parseChangesetUri(resourceStr);
			if (snapshot && parsedChangeset && !this._stateManager.getSessionState(parsedChangeset.sessionUri)) {
				await this._changesetCoordinator.restoreSessionIfChangesetSubscription(resource, restoreSession);
				snapshot = this._stateManager.getSnapshot(resourceStr);
			}
			const parsedAnnotations = parseAnnotationsUri(resourceStr);
			if (snapshot && parsedAnnotations) {
				await this._ensureAnnotationsRestored(parsedAnnotations.sessionUri);
				snapshot = this._stateManager.getSnapshot(resourceStr);
			}
			if (!snapshot) {
				const parsedChatSession = parseDefaultChatUri(resourceStr);
				if (parsedChatSession !== undefined) {
					if (!this._stateManager.getSessionState(parsedChatSession)) {
						const parentUri = URI.parse(parsedChatSession);
						const parsedSubagentParent = parseSubagentSessionUri(parentUri);
						if (parsedSubagentParent) {
							await this._restoreSubagentSession(parsedChatSession, parsedSubagentParent.parentSession);
						} else {
							await restoreSession(parentUri);
						}
					}
					snapshot = this._stateManager.getSnapshot(resourceStr);
				}
			}
			if (!snapshot && isAhpChatChannel(resourceStr)) {
				await this._stateManager.resolveChatState(resourceStr);
				snapshot = this._stateManager.getSnapshot(resourceStr);
			}
			if (!snapshot) {
				if (isSubagentChatUri(resource)) {
					snapshot = await this._awaitPendingSubagentChat(resourceStr);
					if (!snapshot) {
						const parsed = parseChatUri(resource);
						if (parsed?.chatId.startsWith('subagent/')) {
							await this._restoreSubagentChat(resourceStr, URI.parse(parsed.session), parsed.chatId.slice('subagent/'.length));
							snapshot = this._stateManager.getSnapshot(resourceStr);
						}
					}
				} else {
					const handled = await this._changesetCoordinator.tryHandleSubscribe(resource, restoreSession);
					if (handled) {
						snapshot = this._stateManager.getSnapshot(resourceStr);
					} else {
						const parsedSubagent = parseSubagentSessionUri(resource);
						if (parsedSubagent) {
							await this._restoreSubagentSession(resourceStr, parsedSubagent.parentSession);
						} else {
							await restoreSession(resource);
						}
						snapshot = this._stateManager.getSnapshot(resourceStr);
					}
				}
			}
			if (!snapshot) {
				throw new Error(`Cannot subscribe to unknown resource: ${resourceStr}`);
			}
			if (this._store.isDisposed || (isActive && !isActive())) {
				throw new Error(`Subscription cancelled: ${resourceStr}`);
			}
			this._sessionResidency.touch(resource);
			void this._sessionResidency.reconcile();

			const sessionState = this._stateManager.getSessionState(resourceStr);
			if (!isAhpChatChannel(resourceStr) && sessionState && needsSessionGitStateRefresh(readSessionGitState(sessionState._meta))) {
				const workingDirectory = sessionState.workingDirectories?.[0]
					? URI.parse(sessionState.workingDirectories[0])
					: undefined;
				void this._gitStateService.refreshSessionGitState(resourceStr, workingDirectory);
			}

			this._logService.trace(`[AgentService] subscribe done: ${resourceStr} (servedFromMemory=${telemetry.servedFromMemory})`);
			telemetry.restoreCompleted();
			return snapshot;
		};
		try {
			return await this._sessionOpenTelemetry.withSubscription(resource, subscribe);
		} catch (error) {
			const subscriptionIsActive = isActive?.() ?? true;
			if (subscriptionIsActive) {
				this.unsubscribe(resource, clientId);
			}
			throw error;
		}
	}

	private async _awaitPendingSubagentChat(subagentChatUri: string): Promise<IStateSnapshot | undefined> {
		const pending = this._pendingSubagentChats.get(subagentChatUri);
		if (!pending) {
			return undefined;
		}
		await pending.p;
		return this._stateManager.getSnapshot(subagentChatUri);
	}

	addSubscriber(resource: URI, clientId: string): void {
		this._cancelPendingSessionGc(resource);
		this._cancelPendingEphemeralSessionGc(resource);
		if (this._subscriptions.addSubscriber(resource, clientId)) {
			this._changesetCoordinator.onFirstSubscriber(resource);
		}
		this._sessionResidency.touch(resource);
	}

	unsubscribe(resource: URI, clientId: string): void {
		if (this._store.isDisposed) {
			return;
		}
		if (!this._subscriptions.removeSubscriber(resource, clientId)) {
			return;
		}
		this._changesetCoordinator.onLastSubscriber(resource);
		this._stateManager.onChangesetLivenessChanged();
		if (this._maybeScheduleEphemeralSessionGc(resource)) {
			return;
		}
		if (this._maybeScheduleSessionGc(resource)) {
			return;
		}
		void this._sessionResidency.reconcile();
	}

	private _maybeScheduleEphemeralSessionGc(resource: URI): boolean {
		const session = resolveAgentHostSession(resource);
		const sessionKey = session.toString();
		if (!this._stateManager.isEphemeralSession(sessionKey)) {
			return false;
		}
		if (this._subscriptions.hasSessionSubscribers(session)) {
			return true;
		}
		this._pendingSessionGc.set(session, disposableTimeout(() => {
			this._pendingSessionGc.deleteAndDispose(session);
			void this._runEphemeralSessionGc(session).catch(err => {
				this._logService.error(err, `[AgentService] GC failed for ephemeral session ${sessionKey}`);
			});
		}, SESSION_GC_GRACE_MS));
		return true;
	}

	private _maybeScheduleSessionGc(resource: URI): boolean {
		const session = resolveAgentHostSession(resource);
		if (this._subscriptions.hasSessionSubscribers(session)) {
			return true;
		}
		const key = session.toString();
		const state = this._stateManager.getSessionState(key);
		if (!state) {
			return false;
		}
		if (state.turns.length > 0 || state.activeTurn !== undefined) {
			return false;
		}
		if (this._stateManager.isUnusedDraft(key) !== true) {
			this._logService.trace(`[AgentService] Skipping GC for session that is not an unused draft: ${key}`);
			return false;
		}
		if (this._agentMergeController.holdsSession(key)) {
			return false;
		}
		this._pendingSessionGc.set(session, disposableTimeout(() => {
			this._pendingSessionGc.deleteAndDispose(session);
			this._runSessionGc(session).catch(err => {
				this._logService.error(err, `[AgentService] GC failed for ${key}`);
			});
		}, SESSION_GC_GRACE_MS));
		return true;
	}

	private _cancelPendingSessionGc(resource: URI): void {
		this._pendingSessionGc.deleteAndDispose(resolveAgentHostSession(resource));
	}

	private _cancelPendingEphemeralSessionGc(resource: URI): void {
		const session = resolveAgentHostSession(resource);
		if (this._stateManager.isEphemeralSession(session.toString())) {
			this._pendingSessionGc.deleteAndDispose(session);
		}
	}

	private async _runEphemeralSessionGc(session: URI): Promise<void> {
		if (this._subscriptions.hasSessionSubscribers(session)) {
			return;
		}
		this._logService.info(`[AgentService] GC: disposing unsubscribed ephemeral session ${session.toString()}`);
		await this.disposeSession(session);
	}

	private async _runSessionGc(resource: URI): Promise<void> {
		const key = resource.toString();
		if (this._subscriptions.hasSessionSubscribers(resource)) {
			return;
		}
		const state = this._stateManager.getSessionState(key);
		if (state && (state.turns.length > 0 || state.activeTurn !== undefined)) {
			return;
		}
		if (this._stateManager.isUnusedDraft(key) === false) {
			this._logService.trace(`[AgentService] GC aborted, session is no longer an unused draft: ${key}`);
			return;
		}
		this._logService.info(`[AgentService] GC: disposing empty unsubscribed session ${key}`);
		await this.disposeSession(resource);
	}

	private _evictSessionState(evictionTarget: URI, evictionTargetKey: string, triggerKey: string, chats: readonly string[]): void {
		this._logService.info(`[AgentService] Evicting idle session: ${evictionTargetKey} (triggered by unsubscribe of ${triggerKey})`);
		const subagentPrefix = buildSubagentSessionUriPrefix(evictionTarget);
		for (const cachedKey of this._stateManager.getSessionUrisWithPrefix(subagentPrefix)) {
			this._stateManager.removeSession(cachedKey);
		}
		this._sideEffects.clearSessionTitleState(evictionTargetKey, chats);
		this._chatContributions.disposeSessionState(evictionTargetKey);
		this._stateManager.removeSession(evictionTargetKey);
	}

	private _canEvictChangeset(changeset: string): boolean {
		const changesetUri = URI.parse(changeset);
		if (this._subscriptions.hasSubscribers(changesetUri)) {
			return false;
		}
		const parsed = parseChangesetUri(changeset);
		if (!parsed) {
			return false;
		}
		const sessionUri = URI.parse(parsed.sessionUri);
		if (this._subscriptions.hasSubscribers(sessionUri)) {
			return false;
		}
		for (const subscribedUri of this._subscriptions.subscribedResources) {
			if (this._isSubagentDescendantOf(subscribedUri, sessionUri)) {
				return false;
			}
		}
		return !this._changesets.isStaticChangesetComputeActive(changeset);
	}

	private _isSubagentDescendantOf(resource: URI, parent: URI): boolean {
		let parsed = parseSubagentSessionUri(resource);
		while (parsed) {
			if (isEqual(parsed.parentSession, parent)) {
				return true;
			}
			parsed = parseSubagentSessionUri(parsed.parentSession);
		}
		return false;
	}

	private readonly _clientDispatchQueues = new Map<string, Promise<void>>();

	private async _applyPassiveSessionMetadata(session: string, action: IIsArchivedChangedAction | IIsReadChangedAction): Promise<boolean> {
		if (!this._stateManager.getSurfacedSessionSummary(session)) {
			return false;
		}
		const [key, flag, set] = action.type === ActionType.SessionIsArchivedChanged
			? [AH_META_IS_ARCHIVED_DB_KEY, SessionStatus.IsArchived, action.isArchived] as const
			: [AH_META_IS_READ_DB_KEY, SessionStatus.IsRead, action.isRead] as const;
		await persistSessionMetadataValues(this._sessionDataService, session, { [key]: set ? 'true' : '' });
		this._stateManager.setSurfacedSessionStatusFlag(session, flag, set);
		return true;
	}

	private _isAutomationAction(action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | IRootConfigChangedAction | ClientAutomationAction | ClientAutomationRunAction): action is ClientAutomationAction {
		return action.type === ActionType.AutomationCreateRequested
			|| action.type === ActionType.AutomationUpdateRequested
			|| action.type === ActionType.AutomationRemoved;
	}

	private _isAutomationRunAction(action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | IRootConfigChangedAction | ClientAutomationAction | ClientAutomationRunAction): action is ClientAutomationRunAction {
		return action.type === ActionType.AutomationRunCancelRequested;
	}

	dispatchAction(channel: string, action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | IRootConfigChangedAction | ClientAutomationAction | ClientAutomationRunAction, clientId: string, clientSeq: number, clientContextOrType: IAgentHostClientTelemetryContext | AgentHostClientType = AgentHostClientType.Unknown): void {
		const clientContext = typeof clientContextOrType === 'string'
			? createUnknownAgentHostClientTelemetryContext(clientContextOrType)
			: clientContextOrType;
		this._logService.trace(`[AgentService] dispatchAction: type=${action.type}, clientId=${clientId}, clientSeq=${clientSeq}`, action);
		if (action.type === ActionType.RootConfigChanged && Object.hasOwn(action.config, AGENT_HOST_AUTOMATION_MIGRATION_CONFIG_KEY)) {
			const migration = action.config[AGENT_HOST_AUTOMATION_MIGRATION_CONFIG_KEY];
			const origin = { clientId, clientSeq };
			if (!isAgentHostAutomationMigrationCompletion(migration)) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Invalid automation migration completion payload.');
				return;
			}
			if (Object.keys(action.config).length !== 1 || action.replace) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Automation migration completion must be dispatched as an isolated root-config patch.');
				return;
			}
			this._dispatchAutomationMigrationAction(channel, action, clientId, clientSeq, clientContext);
			return;
		}
		if (this._isAutomationAction(action)) {
			const origin = { clientId, clientSeq };
			if (!isAhpAutomationCatalogChannel(channel)) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Automation actions require the automation catalogue channel.');
				return;
			}

			void this._dispatchAutomationAction(action).catch(error => {
				const message = toErrorMessage(error);
				this._logService.error(`[AgentService] automation action failed: ${message}`);
				this._stateManager.rejectClientAction(channel, action, origin, message);
			});
			return;
		}
		if (this._isAutomationRunAction(action)) {
			const origin = { clientId, clientSeq };
			if (!isAhpAutomationRunChannel(channel)) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Automation run actions require an automation-run channel.');
				return;
			}
			void this._automationService.handleCancel(channel, action).catch(error => {
				const message = toErrorMessage(error);
				this._logService.error(`[AgentService] automation run action failed: ${message}`);
				this._stateManager.rejectClientAction(channel, action, origin, message);
			});
			return;
		}

		const chatChannel = isAhpChatChannel(channel) ? channel : undefined;
		const sessionChannel = chatChannel ? parseRequiredSessionUriFromChatUri(chatChannel) : channel;
		const requiresSessionRestore = (chatChannel !== undefined || isSessionAction(action)) && !this._stateManager.getSessionState(sessionChannel);
		const requiresPeerResolution = chatChannel !== undefined && !this._stateManager.getChatState(chatChannel);
		const requiresTurnOwnerResolution = action.type === ActionType.ChatTurnStarted && (requiresSessionRestore || (this._getUnresolvedPeerChats(sessionChannel)?.length ?? 0) > 0);
		const requiresAttachmentRewrite = this._needsAsyncRewrite(sessionChannel, action);
		const requiresReviewStateUpdate = action.type === ActionType.ChangesetFilesReviewChanged;

		const pending = this._clientDispatchQueues.get(clientId);
		if (!pending && !requiresSessionRestore && !requiresPeerResolution && !requiresTurnOwnerResolution && !requiresAttachmentRewrite && !requiresReviewStateUpdate) {
			this._dispatchActionNow(channel, sessionChannel, action, clientId, clientSeq, clientContext);
			return;
		}

		const next = (pending ?? Promise.resolve()).then(async () => {
			const sessionUri = URI.parse(sessionChannel);
			const subagent = parseSubagentSessionUri(sessionUri);
			if (isPassiveSessionMetadataAction(action) && !subagent) {
				await this._restoreSessionInFlight.get(sessionChannel)?.catch(() => undefined);
				if (!this._stateManager.getSessionState(sessionChannel)) {
					if (readSessionEhcliAdoptable(this._stateManager.getSurfacedSessionSummary(sessionChannel)?._meta)) {
						return;
					}
					if (!await this._applyPassiveSessionMetadata(sessionChannel, action)) {
						return;
					}
				}
			} else if (requiresSessionRestore) {
				if (subagent) {
					await this._restoreSubagentSession(sessionChannel, subagent.parentSession);
				} else {
					await this.restoreSession(sessionUri);
				}
			}
			if (chatChannel && requiresPeerResolution) {
				await this._stateManager.resolveChatState(chatChannel);
			}
			if (action.type === ActionType.ChatTurnStarted && requiresTurnOwnerResolution) {
				await this._resolvePeerChatsForTurnValidation(sessionChannel);
			}
			const rewritten: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | IRootConfigChangedAction = requiresAttachmentRewrite
				? await this._rewriteUserMessageAttachments(sessionChannel, action, clientId)
				: action;
			if (rewritten.type === ActionType.ChangesetFilesReviewChanged) {
				await this._reviewService.setReviewState(channel, rewritten.files, rewritten.reviewed);
				const changeset = parseChangesetUri(channel);
				if (!changeset) {
					throw new Error(`Invalid changeset URI: ${channel}`);
				}
				this._changesets.refreshBranchChangeset(changeset.sessionUri);
			}
			this._dispatchActionNow(channel, sessionChannel, rewritten, clientId, clientSeq, clientContext);
		}).catch(err => {
			this._logService.error(`[AgentService] async dispatchAction failed: ${toErrorMessage(err)}`);
			this._stateManager.rejectClientAction(channel, action, { clientId, clientSeq }, toErrorMessage(err));
		}).finally(() => {
			if (this._clientDispatchQueues.get(clientId) === next) {
				this._clientDispatchQueues.delete(clientId);
			}
		});

		this._clientDispatchQueues.set(clientId, next);
	}

	private _dispatchAutomationMigrationAction(channel: string, action: IRootConfigChangedAction, clientId: string, clientSeq: number, clientContext: IAgentHostClientTelemetryContext): void {
		const pending = this._clientDispatchQueues.get(clientId);
		const next = (pending ?? Promise.resolve()).then(async () => {
			const migration = action.config[AGENT_HOST_AUTOMATION_MIGRATION_CONFIG_KEY];
			if (!isAgentHostAutomationMigrationCompletion(migration)) {
				throw new Error('Invalid automation migration completion payload.');
			}
			await this._automationService.completeMigration(migration.resources);
			this._dispatchActionNow(channel, channel, action, clientId, clientSeq, clientContext);
		}).catch(error => {
			const message = toErrorMessage(error);
			this._logService.error(`[AgentService] Failed to complete automation migration: ${message}`);
			this._stateManager.rejectClientAction(channel, action, { clientId, clientSeq }, message);
		}).finally(() => {
			if (this._clientDispatchQueues.get(clientId) === next) {
				this._clientDispatchQueues.delete(clientId);
			}
		});
		this._clientDispatchQueues.set(clientId, next);
	}

	private async _dispatchAutomationAction(action: ClientAutomationAction): Promise<void> {
		switch (action.type) {
			case ActionType.AutomationCreateRequested:
				return this._automationService.handleCreate(action);
			case ActionType.AutomationUpdateRequested:
				return this._automationService.handleUpdate(action);
			case ActionType.AutomationRemoved:
				return this._automationService.handleRemove(action);
		}
	}

	private _prepareWorkingDirectoryAction(session: string, action: SessionWorkingDirectoryAction): SessionWorkingDirectoryAction {
		const state = this._stateManager.getSessionState(session);
		if (!state || state.lifecycle !== SessionLifecycle.Ready || !state.workingDirectories?.length) {
			throw new Error(`Session is not ready for working-directory changes: ${session}`);
		}
		if (!readSessionMultiRootMetadata(state._meta)
			|| readSessionWorkspaceless(state._meta)
			|| state.config?.values[SessionConfigKey.Isolation] === 'worktree'
			|| state.chats.length !== 1
			|| !state.defaultChat
			|| state.defaultChat !== state.chats[0].resource) {
			throw new Error(`Session does not support dynamic working-directory changes: ${session}`);
		}

		const sessionUri = URI.parse(session);
		const provider = this._providerService.getProviderForSession(sessionUri);
		const capability = provider?.getDescriptor().capabilities?.multipleWorkingDirectories;
		if (!provider || !capability) {
			throw new Error(`Provider does not support dynamic working-directory changes: ${AgentSession.provider(sessionUri) ?? '(unknown)'}`);
		}

		return resolveSessionWorkingDirectoryAction(action, state.workingDirectories, {
			immutablePrimary: capability.immutablePrimary === true,
			primaryReplacement: capability.primaryReplacement === true,
		});
	}

	private _withPreservedHostWrittenSessionConfig(session: string, action: SessionConfigChangedAction): SessionConfigChangedAction {
		const values = this._stateManager.getSessionState(session)?.config?.values;
		if (!values) {
			return action;
		}
		let preserved: Record<string, unknown> | undefined;
		for (const key of HOST_WRITTEN_SESSION_CONFIG_KEYS) {
			if (Object.hasOwn(values, key)) {
				preserved ??= {};
				preserved[key] = values[key];
			}
		}
		return preserved ? { ...action, config: { ...action.config, ...preserved } } : action;
	}

	private _dispatchActionNow(channel: string, sessionChannel: string, action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | IRootConfigChangedAction, clientId: string, clientSeq: number, clientContext: IAgentHostClientTelemetryContext): void {
		const origin = { clientId, clientSeq };
		if (action.type === ActionType.ChatTurnCancelled) {
			const resumedDuration = this._sideEffects.getResumedTurnDuration(channel, action.turnId);
			if (resumedDuration !== undefined) {
				action = { ...action, duration: resumedDuration };
			}
		}
		let resumedTurn: Turn | undefined;
		if (action.type === ActionType.ChatTurnResume) {
			if (!isAhpChatChannel(channel)) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Turn resume requires a chat channel.');
				return;
			}
			const chatState = this._stateManager.getChatState(channel);
			const sessionState = this._stateManager.getSessionState(sessionChannel);
			const sessionArchived = ((sessionState?.status ?? 0) & SessionStatus.IsArchived) === SessionStatus.IsArchived;
			const turn = chatState?.turns.at(-1);
			const errorPart = getErrorResponsePart(turn);
			const provider = this._providerService.getProviderForSession(sessionChannel);
			if (chatState?.activeTurn) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Cannot resume while a turn is active.');
				return;
			}
			if (isChatReadOnly(chatState?.interactivity, sessionArchived)) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Cannot resume a read-only or archived chat.');
				return;
			}
			if (!turn || turn.id !== action.turnId || turn.state !== TurnState.Error || errorPart?.resumable !== true) {
				this._stateManager.rejectClientAction(channel, action, origin, 'The requested turn is not the latest resumable errored turn.');
				return;
			}
			if (!provider?.chats.resumeTurn) {
				this._stateManager.rejectClientAction(channel, action, origin, 'The session provider does not support turn resume.');
				return;
			}
			resumedTurn = turn;
		}
		if (action.type === ActionType.ChatTurnStarted && this._isTurnIdUsedByAnotherChat(sessionChannel, channel, action.turnId)) {
			this._stateManager.rejectClientAction(channel, action, origin, 'Turn id is already used by another chat in this session.');
			return;
		}
		if (action.type === ActionType.SessionConfigChanged) {
			const configAction = action as SessionConfigChangedAction;
			const forbidden = HOST_WRITTEN_SESSION_CONFIG_KEYS.filter(key => Object.hasOwn(configAction.config, key));
			if (forbidden.length > 0) {
				this._stateManager.rejectClientAction(channel, action, origin, `Session config keys are host-owned and cannot be set by a client: ${forbidden.join(', ')}.`);
				return;
			}
			if (configAction.replace) {
				action = this._withPreservedHostWrittenSessionConfig(sessionChannel, configAction);
			}
		}
		if (action.type === ActionType.SessionWorkingDirectoryReplaced) {
			this._stateManager.rejectClientAction(channel, action, origin, 'Session working-directory replacement is not supported.');
			return;
		}
		if (action.type === ActionType.SessionWorkingDirectorySet
			|| action.type === ActionType.SessionWorkingDirectoryRemoved) {
			if (clientContext.clientType !== AgentHostClientType.EditorWindow) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Session working-directory actions require an Editor Window client.');
				return;
			}
			if (channel !== sessionChannel) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Session working-directory actions require a session channel.');
				return;
			}
			try {
				action = this._prepareWorkingDirectoryAction(sessionChannel, action);
			} catch (error) {
				this._stateManager.rejectClientAction(channel, action, origin, toErrorMessage(error));
				return;
			}
		}
		const automationMigration = action.type === ActionType.RootConfigChanged
			? action.config[AGENT_HOST_AUTOMATION_MIGRATION_CONFIG_KEY]
			: undefined;
		if (automationMigration !== undefined && !isAgentHostAutomationMigrationCompletion(automationMigration)) {
			this._stateManager.rejectClientAction(channel, action, origin, 'Invalid automation migration completion payload.');
			return;
		}
		this._stateManager.dispatchClientAction(channel, action, origin, clientContext);
		if (action.type === ActionType.RootConfigChanged) {
			this._configurationService.persistRootConfig();
			const editTelemetryEnabled = action.config[AgentHostEditTelemetryEnabledConfigKey];
			if (typeof editTelemetryEnabled === 'boolean') {
				this._editAttributionService.setEnabled(editTelemetryEnabled);
			}
			void this._automationService.handleConfigurationChanged().catch(error => {
				this._logService.error(`[AgentService] Failed to apply Automation configuration: ${toErrorMessage(error)}`);
			});
		}
		this._sideEffects.handleAction(channel, action, clientId, clientContext, resumedTurn);
	}
	private _getUnresolvedPeerChats(sessionChannel: string): readonly string[] | undefined {
		return this._stateManager.getSessionState(sessionChannel)?.chats.filter(chat => !isDefaultChatUri(chat.resource) && !this._stateManager.getChatState(chat.resource)).map(chat => chat.resource);
	}

	private async _resolvePeerChatsForTurnValidation(sessionChannel: string): Promise<void> {
		const unavailableSubagentTranscripts = new Set<string>();
		while (true) {
			const unresolvedChats = this._getUnresolvedPeerChats(sessionChannel)?.filter(chat => !unavailableSubagentTranscripts.has(chat));
			if (!unresolvedChats) { throw new Error('Cannot validate turn id for unknown session'); }
			if (unresolvedChats.length === 0) { return; }
			await Promise.all(unresolvedChats.map(async chat => {
				try {
					if (!await this._stateManager.resolveChatState(chat)) { throw new Error('Cannot resolve peer chat for turn id validation'); }
				} catch (error) {
					if (!(error instanceof SubagentTranscriptUnavailableError)) {
						throw error;
					}
					unavailableSubagentTranscripts.add(chat);
					this._logService.warn(`[AgentService] Cannot validate turn ids against unavailable subagent transcript: ${chat}`);
				}
			}));
		}
	}
	private _isTurnIdUsedByAnotherChat(sessionChannel: string, chatChannel: string, turnId: string): boolean {
		const sessionState = this._stateManager.getSessionState(sessionChannel);
		if (!sessionState) { return false; }
		if (sessionState.defaultChat !== chatChannel && (sessionState.activeTurn?.id === turnId || (sessionState.turns ?? []).some(turn => turn.id === turnId))) { return true; }
		for (const chat of sessionState.chats ?? []) {
			if (chat.resource === chatChannel || isDefaultChatUri(chat.resource)) { continue; }
			const chatState = this._stateManager.getChatState(chat.resource);
			if (chatState?.activeTurn?.id === turnId || chatState?.turns.some(turn => turn.id === turnId)) { return true; }
		}
		return false;
	}

	private _needsAsyncRewrite(sessionURI: string, action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | IRootConfigChangedAction): action is ChatTurnStartedAction | ChatPendingMessageSetAction {
		if (action.type !== ActionType.ChatTurnStarted && action.type !== ActionType.ChatPendingMessageSet) {
			return false;
		}
		const attachmentsRoot = this._attachmentsRoot(sessionURI);
		return !!action.message.attachments?.some(a =>
			this._isRewritableAttachment(a, attachmentsRoot) || this._isUntaggedSnapshotResource(a, attachmentsRoot));
	}
	private _isRewritableAttachment(attachment: MessageAttachment, attachmentsRoot: URI): boolean {
		if (attachment.type === MessageAttachmentKind.EmbeddedResource) {
			return true;
		}
		if (attachment.type === MessageAttachmentKind.Resource) {
			if (attachment.displayKind === 'directory') {
				return false;
			}
			if (this._isUnderAttachmentsRoot(attachment.uri, attachmentsRoot)) {
				return false;
			}
			return true;
		}
		return false;
	}

	private _isUntaggedSnapshotResource(attachment: MessageAttachment, attachmentsRoot: URI): boolean {
		return attachment.type === MessageAttachmentKind.Resource
			&& attachment.displayKind !== 'directory'
			&& this._isUnderAttachmentsRoot(attachment.uri, attachmentsRoot)
			&& !isHostSnapshotAttachment(attachment);
	}

	private _isUnderAttachmentsRoot(attachmentUri: string, attachmentsRoot: URI): boolean {
		return extUriBiasedIgnorePathCase.isEqualOrParent(URI.parse(attachmentUri), attachmentsRoot);
	}

	private _attachmentsRoot(sessionURI: string): URI {
		return joinPath(this._sessionDataService.getSessionDataDir(URI.parse(sessionURI)), SESSION_ATTACHMENTS_DIRNAME);
	}

	private async _rewriteUserMessageAttachments<T extends ChatTurnStartedAction | ChatPendingMessageSetAction>(channel: string, action: T, clientId: string): Promise<T> {
		const attachments = action.message.attachments;
		if (!attachments?.length) {
			return action;
		}
		const attachmentsRoot = this._attachmentsRoot(channel);
		const rewritten = await Promise.all(attachments.map(a => this._rewriteSingleAttachment(a, attachmentsRoot, clientId)));
		return {
			...action,
			message: { ...action.message, attachments: rewritten },
		};
	}

	private async _rewriteSingleAttachment(attachment: MessageAttachment, attachmentsRoot: URI, clientId: string): Promise<MessageAttachment> {
		try {
			if (attachment.type === MessageAttachmentKind.EmbeddedResource) {
				const bytes = decodeBase64(attachment.data).buffer;
				const basename = this._attachmentBasename(attachment.label, attachment.contentType);
				return this._writeAndRewrite(attachment, bytes, basename, attachmentsRoot, attachment.contentType);
			}
			if (attachment.type === MessageAttachmentKind.Resource) {
				if (this._isUntaggedSnapshotResource(attachment, attachmentsRoot)) {
					return this._tagSnapshotAttachment(attachment, getMediaMime(URI.parse(attachment.uri).path));
				}
				if (this._isRewritableAttachment(attachment, attachmentsRoot)) {
					const originalUri = URI.parse(attachment.uri);
					if (originalUri.scheme === Schemas.file && await this._fileExistsSafe(originalUri)) {
						return attachment;
					}

					const contentType = getMediaMime(originalUri.path);
					const bytes = await this._readClientResource(originalUri, clientId);
					const basename = this._attachmentBasename(attachment.label, contentType);
					return this._writeAndRewrite(attachment, bytes, basename, attachmentsRoot, contentType);
				}
			}
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to rewrite attachment '${attachment.label}': ${toErrorMessage(err)}`);
		}
		return attachment;
	}

	private _tagSnapshotAttachment(attachment: MessageResourceAttachment, contentType: string | undefined): MessageResourceAttachment {
		return {
			...attachment,
			_meta: { ...attachment._meta, ...toHostSnapshotAttachmentMeta(contentType) },
		};
	}

	private async _fileExistsSafe(uri: URI): Promise<boolean> {
		try {
			return await this._fileService.exists(uri);
		} catch {
			return false;
		}
	}

	private async _readClientResource(originalUri: URI, clientId: string): Promise<Uint8Array> {
		const proxiedUri = clientId ? toAgentClientUri(originalUri, clientId) : originalUri;
		try {
			const contents = await this._fileService.readFile(proxiedUri);
			return contents.value.buffer;
		} catch (err) {
			if (proxiedUri !== originalUri) {
				try {
					const contents = await this._fileService.readFile(originalUri);
					return contents.value.buffer;
				} catch {
				}
			}
			throw err;
		}
	}

	private async _writeAndRewrite(
		original: MessageAttachment,
		bytes: Uint8Array,
		basename: string,
		attachmentsRoot: URI,
		contentType: string | undefined,
	): Promise<MessageResourceAttachment> {
		const id = generateUuid();
		const target = joinPath(attachmentsRoot, id, basename);
		await this._fileService.writeFile(target, VSBuffer.wrap(bytes));
		const rewritten: MessageResourceAttachment = {
			type: MessageAttachmentKind.Resource,
			uri: target.toString(),
			label: original.label,
			displayKind: original.displayKind,
			range: original.range,
			_meta: { ...original._meta, ...toHostSnapshotAttachmentMeta(contentType) },
		};
		if (original.type === MessageAttachmentKind.Resource && original.selection) {
			rewritten.selection = original.selection;
		}
		return rewritten;
	}

	private _attachmentBasename(label: string, contentType: string | undefined): string {
		const safeLabel = (label || 'attachment').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
		if (resourcesExtname(URI.file(safeLabel))) {
			return safeLabel;
		}
		const ext = contentType ? getExtensionForMimeType(contentType) : undefined;
		return ext ? `${safeLabel}${ext}` : safeLabel;
	}

	async resourceList(uri: URI): Promise<ResourceListResult> {
		let stat;
		try {
			stat = await this._fileService.resolve(uri);
		} catch {
			throw new ProtocolError(AhpErrorCodes.NotFound, `Directory not found: ${uri.toString()}`);
		}

		if (!stat.isDirectory) {
			throw new ProtocolError(AhpErrorCodes.NotFound, `Not a directory: ${uri.toString()}`);
		}

		const entries: DirectoryEntry[] = (stat.children ?? []).map(child => ({
			name: child.name,
			type: child.isDirectory ? 'directory' : 'file',
		}));
		return { entries };
	}

	async restoreSession(session: URI, onRestoreStart?: (joinedRestore: boolean) => void): Promise<void> {
		const sessionStr = session.toString();
		this._cancelPendingSessionGc(session);
		this._sessionResidency.touch(session);
		await this._sessionResidency.waitForRelease(session);

		const inFlight = this._restoreSessionInFlight.get(sessionStr);
		if (inFlight) {
			onRestoreStart?.(true);
			this._logService.trace(`[AgentService] restoreSession: joining in-flight restore for ${sessionStr}`);
			return inFlight;
		}

		if (this._stateManager.getSessionState(sessionStr)) {
			this._sessionResidency.touch(session);
			await this._sessionResidency.reconcile();
			return;
		}

		onRestoreStart?.(false);
		this._logService.trace(`[AgentService] restoreSession start: ${sessionStr}`);
		const restore = this._doRestoreSession(session, sessionStr);
		this._restoreSessionInFlight.set(sessionStr, restore);
		try {
			await restore;
			this._sessionResidency.touch(session);
			await this._sessionResidency.reconcile();
			this._logService.trace(`[AgentService] restoreSession done: ${sessionStr}`);
		} finally {
			if (this._restoreSessionInFlight.get(sessionStr) === restore) {
				this._restoreSessionInFlight.delete(sessionStr);
			}
		}
	}

	private _reportLegacyMigration(
		provider: string,
		outcome: AgentHostLegacyMigrationEvent['outcome'],
		startTime: number,
		extra: { turnCount?: number; hasProject?: boolean; hasWorktree?: boolean; workingDirectoryCount?: number; errorMessage?: string; reason?: AgentChatAdoptionReason },
	): void {
		this._telemetryService.publicLog2<AgentHostLegacyMigrationEvent, AgentHostLegacyMigrationClassification>('agentHost.legacyCopilotCliMigration', {
			provider,
			outcome,
			success: outcome === 'migrated' && (extra.turnCount ?? 0) > 0,
			turnCount: extra.turnCount ?? 0,
			durationMs: Date.now() - startTime,
			hasProject: extra.hasProject ?? false,
			hasWorktree: extra.hasWorktree ?? false,
			workingDirectoryCount: extra.workingDirectoryCount ?? 0,
			errorMessage: extra.errorMessage,
			reason: extra.reason ?? 'unknown',
		});
	}

	private async _doRestoreSession(session: URI, sessionStr: string): Promise<void> {
		if (this._stateManager.getSessionState(sessionStr)) {
			return;
		}
		if (await this._sessionRegistry.isTombstoned(session)) {
			throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Session was explicitly deleted: ${sessionStr}`);
		}
		if (await this._isWorkspaceConversionQuarantined(session)) {
			throw new ProtocolError(JSON_RPC_INTERNAL_ERROR, `Session is unavailable because its provider could not be detached from an untrusted working directory: ${sessionStr}`);
		}
		let registeredSession = await this._sessionRegistry.get(session, entry => this._migrateRegisteredSession(entry));
		if (registeredSession) {
			this._providerService.associateSession(session, registeredSession.provider);
		}
		const agent = registeredSession
			? this._providerService.getProvider(registeredSession.provider)
			: this._providerService.getProviderForSession(session);
		if (!agent) {
			throw new ProtocolError(AHP_SESSION_NOT_FOUND, `No agent for session: ${sessionStr}`);
		}
		let catalogReadable: Promise<boolean> | undefined;
		const awaitCatalogReadable = () => catalogReadable ??= (async () => {
			let readable: boolean;
			try {
				readable = await this._awaitInitialProviderMigrationForProvider(agent, !registeredSession);
			} catch (err) {
				readable = false;
				this._logService.warn(`[AgentService] restore: initial catalog migration for provider ${agent.id} failed; a metadata miss will be reported as unavailable, not missing`, err);
			}
			if (await this._sessionRegistry.isTombstoned(session)) {
				throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Session was explicitly deleted: ${sessionStr}`);
			}
			return readable;
		})();
		let external = registeredSession?.external ?? false;
		this._logService.trace(`[AgentService] restore: catalog and registry resolved for ${sessionStr} (registered=${!!registeredSession}, external=${external})`);

		const migrateLegacyEnabled = this._isMigrateLegacyEnabled();
		const migrationStartTime = Date.now();
		let adoption: IAgentChatAdoptionResult = { adopted: false, eligible: false };
		if (!external && migrateLegacyEnabled && agent.ensureChatAdopted) {
			try {
				const defaultChat = URI.parse(buildDefaultChatUri(session));
				adoption = await agent.ensureChatAdopted(defaultChat, this._chatContext(session, defaultChat));
			} catch (err) {
				this._reportLegacyMigration(agent.id, 'failed', migrationStartTime, { errorMessage: toErrorMessage(err) });
				throw err;
			}
		}
		const adopted = adoption.adopted;

		if (!registeredSession && agent.ensureChatAdopted && !adoption.eligible && !adoption.native) {
			await awaitCatalogReadable();
			registeredSession = await this._sessionRegistry.get(session, entry => this._migrateRegisteredSession(entry));
			external = registeredSession?.external ?? external;
			if (!registeredSession) {
				this._logService.info(`[AgentService] restore refused for unregistered ${sessionStr}: not an adoptable legacy chat (reason=${adoption.reason ?? 'unknown'})`);
				throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Session is not an adoptable legacy chat: ${sessionStr}`);
			}
		}

		let registeredAfterAdoption = !!registeredSession;
		try {
			if (adopted && !registeredSession) {
				const registeredAt = Date.now();
				await this._retryRegistryMutation(
					() => this._sessionRegistry.register(session, { provider: agent.id, startTime: registeredAt, modifiedTime: registeredAt, source: 'restore' }, { checkTombstone: true }),
					`adoption registration for ${sessionStr}`,
				);
				registeredAfterAdoption = true;
				this._invalidateSessionList();
				try {
					const surfaced = await this._registeredSessionMetadata(agent, session, false);
					if (surfaced) {
						await this._announceSurfacedSession(surfaced, agent.id);
					}
				} catch (err) {
					this._logService.warn(`[AgentService] Failed to surface adopted session ${sessionStr} before restore`, err);
				}
			}
			const facts = await this._restoreSessionState(agent, session, sessionStr, adopted, external, registeredSession?.source ?? 'restore', awaitCatalogReadable, !!registeredSession, adoption.worktree);
			await this._restoreAnnotations(session);
			if (adopted) {
				this._stateManager.setSessionSummaryPublished(sessionStr, true);
				this._reportLegacyMigration(agent.id, 'migrated', migrationStartTime, { ...facts, reason: adoption.reason });
			} else if (adoption.eligible) {
				this._logService.info(`[AgentService] legacy session ${sessionStr} was a migration candidate but was not adopted (reason=${adoption.reason ?? 'unknown'})`);
				this._reportLegacyMigration(agent.id, 'skipped', migrationStartTime, { hasProject: facts.hasProject, workingDirectoryCount: facts.workingDirectoryCount, reason: adoption.reason });
			}
		} catch (err) {
			if (adopted) {
				this._logService.error(registeredAfterAdoption
					? `[AgentService] legacy session ${sessionStr} was adopted but its restore failed; it is registered so it surfaces with an error rather than disappearing`
					: `[AgentService] legacy session ${sessionStr} was adopted but could not be registered; the extension host no longer lists it, so it will not appear until the next successful restore`, err);
				this._reportLegacyMigration(agent.id, 'failed', migrationStartTime, { errorMessage: toErrorMessage(err), reason: adoption.reason });
			}
			throw err;
		}
	}

	private async _restoreAnnotations(session: URI): Promise<void> {
		const sessionStr = session.toString();
		if (this._stateManager.getAnnotationsState(buildAnnotationsUri(sessionStr))) {
			return;
		}
		const inFlight = this._restoreAnnotationsInFlight.get(sessionStr);
		if (inFlight) {
			await inFlight;
			return;
		}
		const restore = this._doRestoreAnnotations(session);
		this._restoreAnnotationsInFlight.set(sessionStr, restore);
		try {
			await restore;
		} finally {
			if (this._restoreAnnotationsInFlight.get(sessionStr) === restore) {
				this._restoreAnnotationsInFlight.delete(sessionStr);
			}
		}
	}

	private async _ensureAnnotationsRestored(sessionUri: string): Promise<void> {
		if (this._stateManager.getAnnotationsState(buildAnnotationsUri(sessionUri))) {
			return;
		}
		await this._restoreSessionInFlight.get(sessionUri);
		await this._restoreSubagentInFlight.get(sessionUri);
		const session = URI.parse(sessionUri);
		if (!this._stateManager.getSessionState(sessionUri)) {
			const parsedSubagent = parseSubagentSessionUri(session);
			if (parsedSubagent) {
				await this._restoreSubagentSession(sessionUri, parsedSubagent.parentSession);
			} else {
				await this.restoreSession(session);
			}
		}
		await this._restoreAnnotations(session);
	}

	private async _doRestoreAnnotations(session: URI): Promise<void> {
		const storage = this._annotationsStorage(session);
		const refPromise = this._sessionDataService.tryOpenDatabase?.(storage.session);
		if (!refPromise) {
			return;
		}
		try {
			const ref = await refPromise;
			if (!ref) {
				return;
			}
			try {
				const raw = await ref.object.getMetadata(storage.key);
				if (!raw) {
					return;
				}
				const state: unknown = JSON.parse(raw);
				const annotations = readPersistedAnnotationsState(state, session.toString());
				if (!annotations) {
					throw new Error('Invalid annotations state');
				}
				this._stateManager.restoreAnnotations(session.toString(), annotations);
			} finally {
				ref.dispose();
			}
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to restore annotations for ${session.toString()}: ${toErrorMessage(err)}`);
		}
	}

	private async _restoreSessionState(agent: IAgent, session: URI, sessionStr: string, adopted: boolean, external: boolean, registrationSource: IRegisteredSession['source'], awaitCatalogReadable: () => Promise<boolean>, sessionKnownToRegistry: boolean, adoptionWorktree: IAgentAdoptedWorktree | undefined): Promise<{ turnCount: number; hasProject: boolean; hasWorktree: boolean; workingDirectoryCount: number }> {
		this._logService.trace(`[AgentService] restore: reading provider metadata for ${sessionStr}`);
		let meta = await this._getSessionMetadataForRestore(agent, session, external);
		if (!meta) {
			const catalogReadable = await awaitCatalogReadable();
			meta = await this._getSessionMetadataForRestore(agent, session, external);
			const knownToRegistry = sessionKnownToRegistry || (await this._listRegisteredSessions()).some(entry => entry.session.toString() === sessionStr);
			if (!meta) {
				throw catalogReadable && !knownToRegistry
					? new ProtocolError(AHP_SESSION_NOT_FOUND, `Session not found on backend: ${sessionStr}`)
					: new ProtocolError(JSON_RPC_INTERNAL_ERROR, `Provider ${agent.id} could not describe ${sessionStr} yet`);
			}
		}
		this._logService.trace(`[AgentService] restore: provider metadata resolved for ${sessionStr}`);

		let adoptedWorktree = false;
		if (adopted && this._worktree.supported) {
			if (adoptionWorktree) {
				try {
					await this._worktree.recordAdoptedWorktreeMetadata(session, adoptionWorktree);
					adoptedWorktree = true;
					const worktreeProject = await this._worktree.resolveWorktreeProject(session);
					if (worktreeProject) {
						meta = { ...meta, project: worktreeProject };
					}
				} catch (err) {
					this._logService.warn(`[AgentService] adopt: recording recorded worktree metadata failed for ${sessionStr}`, err);
				}
			}
			const adoptedWorkingDirectory = meta.workingDirectories?.[0];
			if (!adoptedWorktree && adoptedWorkingDirectory) {
				try {
					if (await this._worktree.adoptExistingWorktreeMetadata(session, adoptedWorkingDirectory)) {
						adoptedWorktree = true;
						const worktreeProject = await this._worktree.resolveWorktreeProject(session);
						if (worktreeProject) {
							meta = { ...meta, project: worktreeProject };
						}
					}
				} catch (err) {
					this._logService.warn(`[AgentService] adopt: worktree metadata bridge failed for ${sessionStr}`, err);
				}
			}
		}
		if (!meta.project && !readSessionWorkspaceless(meta._meta) && this._worktree.supported) {
			const workingDirectory = meta.workingDirectories?.[0];
			if (workingDirectory) {
				try {
					const project = await this._worktree.recordExternalWorktreeProject(session, workingDirectory);
					if (project) {
						adoptedWorktree = true;
						meta = { ...meta, project };
					}
				} catch (err) {
					this._logService.warn(`[AgentService] restore: external worktree project discovery failed for ${sessionStr}`, err);
				}
			}
		}

		const defaultChatUri = URI.parse(buildDefaultChatUri(sessionStr));
		const defaultChatProviderData = await this._readDefaultChatProviderData(session);
		const chatContext = this._chatContext(session, defaultChatUri);
		const recoveredDefaultChat = !external && defaultChatProviderData === undefined
			? await agent.recoverLegacyChat?.(defaultChatUri, chatContext)
			: undefined;
		if (recoveredDefaultChat?.providerData !== undefined) {
			await this._persistDefaultChatBacking({ session, chat: recoveredDefaultChat });
		}
		const providerData = defaultChatProviderData ?? recoveredDefaultChat?.providerData;
		const materializedDefaultChat = await agent.materializeChat(defaultChatUri, chatContext, providerData);
		if (providerData === undefined && materializedDefaultChat?.providerData !== undefined) {
			await this._persistDefaultChatBacking({ session, chat: materializedDefaultChat });
		}
		if (providerData === undefined && materializedDefaultChat?.providerData === undefined) {
			this._logService.warn(`[AgentService] Restoring default chat ${defaultChatUri.toString()} with no persisted or recovered provider backing (agent=${agent.id})`);
		}
		let title = meta.summary ?? 'Session';
		let isRead: boolean | undefined;
		let isArchived: boolean | undefined;
		let persistedConfigValues: Record<string, string> | undefined;
		let changes: ChangesSummary | undefined;
		let gitMetadata: Record<string, string | undefined> | undefined;
		let changesetMetadata: Record<string, string | undefined> | undefined;
		let sessionMetadata: Record<string, unknown> | undefined;
		let workspaceTransitionsPromise: Promise<ReadonlyMap<string, string> | undefined> = Promise.resolve(undefined);
		const ref = this._sessionDataService.tryOpenDatabase?.(session);
		if (ref) {
			try {
				const db = await ref;
				if (db) {
					let retainedForWorkspaceTransitions = false;
					try {
						const m = await db.object.getMetadataObject({
							customTitle: true,
							[AH_META_IS_READ_DB_KEY]: true,
							[AH_META_IS_ARCHIVED_DB_KEY]: true,
							[AH_META_IS_DONE_DB_KEY]: true,
							configValues: true,
							[AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY]: true,
							[AH_META_WORKSPACELESS_DB_KEY]: true,
							[AH_META_EHCLI_ADOPTED_DB_KEY]: true,
							[AH_META_EHCLI_LAST_TURN_DB_KEY]: true,
							[AH_META_CREATED_BY_SESSION_DB_KEY]: true,
							[AH_META_DEV_CONTAINER_WORKTREE_DB_KEY]: true,
							[SESSION_META_MULTI_ROOT_KEY]: true,
							[SESSION_ARTIFACTS_KEY]: true,
							[SESSION_META_FOLDER_PICKER_KEY]: true,
							...GIT_DB_METADATA_KEYS,
							...CHANGESET_DB_METADATA_KEYS,
						});
						if (m[AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY] === 'true') {
							retainedForWorkspaceTransitions = true;
							workspaceTransitionsPromise = this._readWorkspaceTransitions(db, session);
						}
						if (m.customTitle) {
							title = m.customTitle;
						}
						if (m[AH_META_IS_READ_DB_KEY] !== undefined) {
							isRead = m[AH_META_IS_READ_DB_KEY] === 'true';
						}
						const persistedArchived = m[AH_META_IS_ARCHIVED_DB_KEY] ?? m[AH_META_IS_DONE_DB_KEY];
						if (persistedArchived !== undefined) {
							isArchived = persistedArchived === 'true';
						}

						changesetMetadata = m as Record<string, string | undefined>;
						if (changesetMetadata[META_CHANGES_SUMMARY]) {
							try {
								changes = JSON.parse(changesetMetadata[META_CHANGES_SUMMARY]);
							} catch (err) {
								this._logService.warn(`[AgentService] Failed to parse changes summary for ${sessionStr}: ${toErrorMessage(err)}`);
							}
						}

						gitMetadata = m as Record<string, string | undefined>;

						if (gitMetadata[META_GIT_STATE]) {
							try {
								const gitState = JSON.parse(gitMetadata[META_GIT_STATE]);
								sessionMetadata = { [SESSION_META_GIT_KEY]: gitState };
							} catch (err) {
								this._logService.warn(`[AgentService] Failed to parse Git state for ${sessionStr}: ${toErrorMessage(err)}`);
							}
						}

						if (gitMetadata[META_GITHUB_STATE]) {
							try {
								const githubState = JSON.parse(gitMetadata[META_GITHUB_STATE]);
								sessionMetadata = {
									...(sessionMetadata ? sessionMetadata : {}),
									[SESSION_META_GITHUB_KEY]: githubState
								};
							} catch (err) {
								this._logService.warn(`[AgentService] Failed to parse GitHub state for ${sessionStr}: ${toErrorMessage(err)}`);
							}
						}

						if (gitMetadata[META_SOURCE_CONTROL_STATE]) {
							try {
								sessionMetadata = withSessionSourceControlState(sessionMetadata, parsePersistedSourceControlState(gitMetadata[META_SOURCE_CONTROL_STATE]));
							} catch (err) {
								this._logService.warn(`[AgentService] Failed to parse source-control state for ${sessionStr}: ${toErrorMessage(err)}`);
							}
						}

						if (m[AH_META_WORKSPACELESS_DB_KEY] !== undefined) {
							sessionMetadata = withSessionWorkspaceless(sessionMetadata, m[AH_META_WORKSPACELESS_DB_KEY] === 'true');
						}
						if (m[AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY] !== undefined) {
							sessionMetadata = withSessionHasWorkspaceTransitions(sessionMetadata, m[AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY] === 'true');
						}
						if (m[AH_META_EHCLI_ADOPTED_DB_KEY] !== undefined) {
							sessionMetadata = withSessionEhcliAdopted(sessionMetadata, m[AH_META_EHCLI_ADOPTED_DB_KEY] === 'true');
						}
						if (m[AH_META_EHCLI_LAST_TURN_DB_KEY] !== undefined) {
							sessionMetadata = withSessionEhcliLastMigratedTurn(sessionMetadata, m[AH_META_EHCLI_LAST_TURN_DB_KEY]);
						}
						const creationReference = parseSessionCreationReference(m[AH_META_CREATED_BY_SESSION_DB_KEY]);
						if (creationReference) {
							sessionMetadata = withSessionCreationReference(sessionMetadata, creationReference);
						}
						if (m[AH_META_DEV_CONTAINER_WORKTREE_DB_KEY]) {
							try {
								const metadata = readAgentDevContainerWorktreeMetadata({
									[AH_META_DEV_CONTAINER_WORKTREE_DB_KEY]: JSON.parse(m[AH_META_DEV_CONTAINER_WORKTREE_DB_KEY]),
								});
								if (metadata) {
									sessionMetadata = withAgentDevContainerWorktreeMetadata(sessionMetadata, metadata.handle);
								}
							} catch (err) {
								this._logService.warn(`[AgentService] Failed to parse Dev Container worktree metadata for ${sessionStr}: ${toErrorMessage(err)}`);
							}
						}
						sessionMetadata = withSessionMultiRootMetadata(sessionMetadata, parseSessionMultiRootMetadata(m[SESSION_META_MULTI_ROOT_KEY]));
						sessionMetadata = withSessionArtifacts(sessionMetadata, this._readPersistedArtifacts(m[SESSION_ARTIFACTS_KEY], sessionStr, '[AgentService]'));
						sessionMetadata = withSessionFolderPickerDecision(sessionMetadata, parseSessionFolderPickerDecision(m[SESSION_META_FOLDER_PICKER_KEY]));

						if (m.configValues) {
							try {
								persistedConfigValues = omitTransientSessionConfigValues(JSON.parse(m.configValues));
							} catch (err) {
								this._logService.warn(`[AgentService] Failed to parse persisted configValues for ${sessionStr}: ${toErrorMessage(err)}`);
							}
						}
					} finally {
						if (!retainedForWorkspaceTransitions) {
							db.dispose();
						}
					}
				}
			} catch {
			}
		}
		this._logService.trace(`[AgentService] restore: persisted session metadata read for ${sessionStr}`);

		let turns: readonly Turn[];
		try {
			turns = await this._getChatMessages(agent, defaultChatUri, session, undefined, workspaceTransitionsPromise);
		} catch (err) {
			if (err instanceof ProtocolError) {
				throw err;
			}
			const message = err instanceof Error ? err.message : String(err);
			throw new ProtocolError(JSON_RPC_INTERNAL_ERROR, `Failed to restore session ${sessionStr}: ${message}`);
		}

		let status: SessionStatus = SessionStatus.Idle;
		if (isRead) {
			status |= SessionStatus.IsRead;
		}
		if (isArchived) {
			status |= SessionStatus.IsArchived;
		}

		const providerMeta = withSessionMultiRootMetadata(meta._meta, undefined);
		let restoredMeta = (sessionMetadata || providerMeta) ? { ...(providerMeta ?? {}), ...(sessionMetadata ?? {}) } : undefined;
		restoredMeta = withSessionMultiRootMetadata(restoredMeta, readSessionMultiRootMetadata(sessionMetadata));
		restoredMeta = withSessionExternal(restoredMeta, external);
		const summary: SessionSummary = {
			resource: sessionStr,
			provider: agent.id,
			title,
			status,
			createdAt: new Date(meta.startTime).toISOString(),
			modifiedAt: new Date(meta.modifiedTime).toISOString(),
			...(meta.project ? { project: { uri: meta.project.uri.toString(), displayName: meta.project.displayName } } : {}),
			changes: meta.changes ?? changes,
			workingDirectories: meta.workingDirectories?.map(d => d.toString()),
			_meta: restoredMeta,
		};

		const { draft: defaultDraft, title: defaultChatTitle } = await this._chatContributions.hydrateChat({
			session: sessionStr,
			chat: defaultChatUri.toString(),
		}, {});
		const restoredDraft = meta.model
			? { ...(defaultDraft ?? { text: '', origin: { kind: MessageKind.User } }), model: meta.model }
			: defaultDraft;
		const mergedTurns = await this._interleaveLocalTurns(sessionStr, defaultChatUri.toString(), turns);
		const registered = await this._retryRegistryMutation(
			() => this._sessionRegistry.register(session, { provider: agent.id, startTime: meta.startTime, modifiedTime: meta.modifiedTime, source: registrationSource }, { checkTombstone: true }),
			`registration for restored session ${session.toString()}`,
		);
		if (!registered) {
			throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Session was explicitly deleted: ${sessionStr}`);
		}
		this._invalidateSessionList();
		this._stateManager.restoreSession(summary, mergedTurns, { draft: restoredDraft, defaultChatTitle });
		this._logService.trace(`[AgentService] restore: hydrated state for ${sessionStr} with ${mergedTurns.length} turn(s)`);
		this._serverToolHost.advertise(sessionStr);

		if (adopted && this._checkpointService.adoptLegacyCheckpoints) {
			try {
				const checkpointWorkingDirectory = meta.workingDirectories?.[0];
				if (checkpointWorkingDirectory) {
					await this._checkpointService.adoptLegacyCheckpoints(session, checkpointWorkingDirectory, AgentSession.id(session), mergedTurns.map(t => t.id));
				}
			} catch (err) {
				this._logService.warn(`[AgentService] adopt: checkpoint bridge failed for ${sessionStr}`, err);
			}
		}

		const promises: Promise<unknown>[] = [];
		await this._registerRestoredSubagentSummaries(agent, session, mergedTurns);

		promises.push(this._restorePeerChats(agent, session));

		this._changesetCoordinator.onSessionRestored(sessionStr, changesetMetadata ?? {});

		if (summary._meta) {
			this._stateManager.setSessionMeta(sessionStr, summary._meta);
		}

		const restoredConfigValues = meta.workingDirectories?.length
			? { [SessionConfigKey.Isolation]: 'folder', ...persistedConfigValues }
			: persistedConfigValues;
		const [restoredConfig, restoredCustomizations] = await Promise.all([
			this._resolveCreatedSessionConfig(agent, {
				workingDirectories: meta.workingDirectories,
				config: restoredConfigValues,
			}),
			agent.getChatCustomizations(defaultChatUri, chatContext, this._hostCustomizations(session)).catch(err => {
				this._logService.error('[AgentService] restoreSession: failed to resolve chat customizations', err);
				return undefined;
			}),
			...promises
		]);
		if (restoredConfig) {
			this._stateManager.setSessionConfig(sessionStr, restoredConfig);
			this._changesetCoordinator.onSessionConfigRestored(sessionStr);
			this._syncAgentMergeIndex(session, undefined, restoredConfig);
		}
		this._agentMergeController.onSessionAvailable(sessionStr);
		if (restoredCustomizations && restoredCustomizations.length > 0) {
			this._stateManager.setSessionCustomizations(sessionStr, restoredCustomizations);
		}

		this._logService.info(`[AgentService] Restored session ${sessionStr} with ${turns.length} turns`);

		void this._gitStateService.attachSessionGitHubPullRequest(sessionStr, meta.workingDirectories?.[0]);

		return {
			turnCount: mergedTurns.length,
			hasProject: !!meta.project,
			hasWorktree: adoptedWorktree,
			workingDirectoryCount: meta.workingDirectories?.length ?? 0,
		};
	}

	private async _restorePeerChats(agent: IAgent, session: URI): Promise<void> {
		const persisted = await this._readPersistedPeerChatCatalog(session);
		if (persisted !== undefined) {
			await this._restorePeerChatsFromCatalog(session, persisted);
			return;
		}
		await this._migrateLegacyPeerChats(agent, session);
	}

	private async _migrateLegacyPeerChats(agent: IAgent, session: URI): Promise<void> {
		const legacy = await agent.listLegacyChatBackings?.(session);
		if (!legacy || legacy.length === 0) {
			await this._enqueuePeerChatCatalogWrite(session, () => []);
			return;
		}
		const entries: IPersistedPeerChat[] = legacy.map(chat => ({
			uri: chat.uri.toString(),
			...(chat.providerData !== undefined ? { providerData: chat.providerData } : {}),
		}));
		await this._restorePeerChatsFromCatalog(session, entries);
		await this._enqueuePeerChatCatalogWrite(session, () => [...entries]);
	}

	private async _restorePeerChatsFromCatalog(session: URI, entries: readonly IPersistedPeerChat[]): Promise<void> {
		const restored = await Promise.all(entries.map(async (entry) => {
			let chatUri: URI;
			try {
				chatUri = URI.parse(entry.uri);
			} catch (err) {
				this._logService.warn(`[AgentService] Skipping malformed persisted peer chat URI '${entry.uri}': ${toErrorMessage(err)}`);
				return undefined;
			}
			const { title, draft } = await this._chatContributions.hydrateChat({
				session: session.toString(),
				chat: chatUri.toString(),
			}, {});
			return { chatUri, title, draft, providerData: entry.providerData, origin: entry.origin, inheritedTurnId: entry.inheritedTurnId };
		}));
		for (const item of restored) {
			if (!item) {
				continue;
			}
			const { chatUri, title, draft, providerData, origin, inheritedTurnId } = item;
			if (this._stateManager.getChatState(chatUri.toString())) {
				continue;
			}
			this._stateManager.registerRestoredChatSummary(session.toString(), chatUri.toString(), {
				title,
				draft,
				providerData,
				origin,
				inheritedTurnId,
				resolver: currentProviderData => this._materializeRestoredPeerChat(session, chatUri, currentProviderData),
			});
		}
	}

	private async _materializeRestoredPeerChat(session: URI, chat: URI, providerData: string | undefined): Promise<{ turns: Turn[] }> {
		const chatKey = chat.toString();
		const agent = this._providerService.getProviderForSession(session);
		if (!agent) {
			throw new Error(`No agent provider for restored peer chat: ${chatKey}`);
		}
		try {
			const result = await agent.materializeChat(chat, this._chatContext(session, chat), providerData);
			if (result?.backingSession) {
				await this._markChatBacking(result.backingSession, chat);
			}
			const turns = await this._getChatMessages(agent, chat, session);
			return { turns: await this._interleaveLocalTurns(session.toString(), chatKey, turns) };
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to materialize peer chat ${chatKey}: ${toErrorMessage(err)}`);
			throw err;
		}
	}

	private _onChatDataChanged(e: IAgentChatDataChange): void {
		const sessionStr = parseDefaultChatUri(e.chat);
		if (sessionStr === undefined) {
			this._logService.warn(`[AgentService] onDidChangeChatData for malformed chat URI: ${e.chat.toString()}`);
			return;
		}
		if (isDefaultChatUri(e.chat)) {
			void this._persistDefaultChatBacking({ session: URI.parse(sessionStr), chat: e })
				.catch(err => this._logService.error(err, `[AgentService] Failed to persist default-chat backing for ${e.chat.toString()}`));
			return;
		}
		const session = this._stateManager.getSessionState(sessionStr);
		if (this._disposingPeerChats.has(e.chat.toString()) || !session?.chats.some(chat => chat.resource.toString() === e.chat.toString())) {
			return;
		}
		this._stateManager.updateChatProviderData(e.chat.toString(), e.providerData);
		void this._persistPeerChat(URI.parse(sessionStr), e.chat, e.providerData)
			.catch(err => this._logService.error(err, `[AgentService] Failed to persist peer-chat backing for ${e.chat.toString()}`));
	}

	private _sequenceSpawnedChat(signal: AgentSignal): void {
		const spawn = SubagentChatSignal.toSpawnEvent(signal);
		if (spawn) {
			this._onChatSpawned(spawn);
		}
	}

	private _trackPendingSubagentChatFromEnvelope(envelope: ActionEnvelope): void {
		const { channel, action } = envelope;
		if (action.type === ActionType.ChatToolCallStart || action.type === ActionType.ChatToolCallDelta || action.type === ActionType.ChatToolCallReady) {
			const key = `${channel}:${action.toolCallId}`;
			const subagentChatUri = readToolCallMeta(action).subagentChatUri ?? this._pendingSubagentToolCalls.get(key);
			if (subagentChatUri === undefined) {
				return;
			}
			if (action.type === ActionType.ChatToolCallReady && action.confirmed) {
				this._pendingSubagentToolCalls.delete(key);
				this._armPendingSubagentChat(subagentChatUri);
				return;
			}
			this._pendingSubagentToolCalls.set(key, subagentChatUri);
			return;
		}
		if (action.type === ActionType.ChatToolCallConfirmed) {
			const key = `${channel}:${action.toolCallId}`;
			const subagentChatUri = this._pendingSubagentToolCalls.get(key);
			if (subagentChatUri === undefined) {
				return;
			}
			this._pendingSubagentToolCalls.delete(key);
			if (action.approved) {
				this._armPendingSubagentChat(subagentChatUri);
			}
			return;
		}
		if (action.type === ActionType.ChatToolCallComplete) {
			this._pendingSubagentToolCalls.delete(`${channel}:${action.toolCallId}`);
		}
	}

	private _armPendingSubagentChat(subagentChatUri: string): void {
		if (this._pendingSubagentChats.has(subagentChatUri) || this._stateManager.getSnapshot(subagentChatUri)) {
			return;
		}
		const deferred = new DeferredPromise<void>();
		this._pendingSubagentChats.set(subagentChatUri, deferred);
		this._pendingSubagentChatTimeouts.set(subagentChatUri, disposableTimeout(() => {
			this._pendingSubagentChats.delete(subagentChatUri);
			this._pendingSubagentChatTimeouts.deleteAndDispose(subagentChatUri);
			deferred.complete();
		}, SUBAGENT_CHAT_PENDING_TIMEOUT_MS));
	}

	private _resolvePendingSubagentChat(resource: string): void {
		const deferred = this._pendingSubagentChats.get(resource);
		if (!deferred) {
			return;
		}
		this._pendingSubagentChats.delete(resource);
		this._pendingSubagentChatTimeouts.deleteAndDispose(resource);
		deferred.complete();
	}

	private _onChatSpawned(e: IAgentSpawnChatEvent): void {
		this._stateManager.addChat(e.session.toString(), e.chat.toString(), {
			...(e.title !== undefined ? { title: e.title } : {}),
			...(e.parent ? {
				origin: { kind: ChatOriginKind.Tool, chat: e.parent.chat.toString(), toolCallId: e.parent.toolCallId },
				interactivity: ChatInteractivity.ReadOnly,
			} : {}),
		});
		this._resolvePendingSubagentChat(e.chat.toString());
	}

	private async _persistDefaultChatBacking(created: IAgentCreateSessionResult): Promise<void> {
		const providerData = created.chat?.providerData;
		let providerDataError: Error | undefined;
		if (providerData !== undefined) {
			const ref = this._sessionDataService.openDatabase(created.session);
			try {
				await ref.object.setMetadata(DEFAULT_CHAT_PROVIDER_DATA_METADATA_KEY, providerData);
			} catch (err) {
				this._logService.warn(`[AgentService] failed to persist default-chat provider data for ${created.session.toString()}`, err);
				providerDataError = err instanceof Error ? err : new Error(String(err));
			} finally {
				ref.dispose();
			}
		}
		if (created.chat?.backingSession) {
			await this._markChatBacking(created.chat.backingSession, URI.parse(buildDefaultChatUri(created.session)));
		}
		if (providerDataError) {
			throw providerDataError;
		}
	}

	private async _readDefaultChatProviderData(session: URI): Promise<string | undefined> {
		const ref = await this._sessionDataService.tryOpenDatabase?.(session);
		if (!ref) {
			return undefined;
		}
		try {
			return await ref.object.getMetadata(DEFAULT_CHAT_PROVIDER_DATA_METADATA_KEY);
		} finally {
			ref.dispose();
		}
	}

	private async _isWorkspaceConversionQuarantined(session: URI): Promise<boolean> {
		const ref = await this._sessionDataService.tryOpenDatabase?.(session);
		if (!ref) {
			return false;
		}
		try {
			return await ref.object.getMetadata(AH_META_WORKSPACE_CONVERSION_QUARANTINED_DB_KEY) === 'true';
		} finally {
			ref.dispose();
		}
	}

	private async _readPersistedPeerChatCatalog(session: URI): Promise<IPersistedPeerChat[] | undefined> {
		const ref = await this._sessionDataService.tryOpenDatabase?.(session);
		if (!ref) {
			return undefined;
		}
		try {
			const raw = await ref.object.getMetadata(PEER_CHATS_METADATA_KEY);
			if (raw === undefined) {
				return undefined;
			}
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				this._logService.warn(`[AgentService] Ignoring malformed peer-chat catalog for ${session.toString()}`);
				return undefined;
			}
			return parsed
				.filter((entry): entry is IPersistedPeerChat => typeof entry?.uri === 'string')
				.map(entry => ({
					uri: entry.uri,
					...(typeof entry.providerData === 'string' ? { providerData: entry.providerData } : {}),
					...(entry.origin !== undefined ? { origin: entry.origin } : {}),
					...(typeof entry.inheritedTurnId === 'string' ? { inheritedTurnId: entry.inheritedTurnId } : {}),
				}));
		} catch (err) {
			this._logService.warn(`[AgentService] Failed to read peer-chat catalog for ${session.toString()}: ${toErrorMessage(err)}`);
			return undefined;
		} finally {
			ref.dispose();
		}
	}

	private async _markChatBacking(backingSession: URI, chat: URI): Promise<void> {
		const backingSessionStr = backingSession.toString();
		const write = async (): Promise<void> => {
			const ref = this._sessionDataService.openDatabase(backingSession);
			try {
				await ref.object.setMetadata(CHAT_BACKING_METADATA_KEY, chat.toString());
			} finally {
				ref.dispose();
			}
		};
		try {
			await write();
			this._unpersistedChatBackings.delete(backingSessionStr);
		} catch (err) {
			this._logService.warn(`[AgentService] failed to mark backing session ${backingSessionStr} for chat ${chat.toString()}, retrying`, err);
			try {
				await write();
				this._unpersistedChatBackings.delete(backingSessionStr);
			} catch (retryErr) {
				this._logService.warn(`[AgentService] retry failed to mark backing session ${backingSessionStr} for chat ${chat.toString()}; suppressing it in-process instead`, retryErr);
				this._unpersistedChatBackings.add(backingSessionStr);
			}
		}
	}

	private _persistPeerChat(session: URI, chat: URI, providerData: string | undefined, origin?: ChatOrigin, inheritedTurnId?: string): Promise<void> {
		const chatUri = chat.toString();
		return this._enqueuePeerChatCatalogWrite(session, entries => {
			const existing = entries.find(entry => entry.uri === chatUri);
			const effectiveOrigin = origin ?? existing?.origin;
			const effectiveInheritedTurnId = inheritedTurnId ?? existing?.inheritedTurnId;
			const next = entries.filter(entry => entry.uri !== chatUri);
			next.push({
				uri: chatUri,
				...(providerData !== undefined ? { providerData } : {}),
				...(effectiveOrigin !== undefined ? { origin: effectiveOrigin } : {}),
				...(effectiveInheritedTurnId !== undefined ? { inheritedTurnId: effectiveInheritedTurnId } : {}),
			});
			return next;
		});
	}

	private _removePersistedPeerChat(session: URI, chat: URI): Promise<void> {
		const chatUri = chat.toString();
		return this._enqueuePeerChatCatalogWrite(session, entries => entries.filter(entry => entry.uri !== chatUri));
	}

	private _enqueuePeerChatCatalogWrite(session: URI, mutate: (entries: IPersistedPeerChat[]) => IPersistedPeerChat[]): Promise<void> {
		const key = session.toString();
		const previous = this._peerChatCatalogWrites.get(key) ?? Promise.resolve();
		const next = previous
			.catch(() => { })
			.then(() => this._applyPeerChatCatalogWrite(session, mutate));
		const clear = () => {
			if (this._peerChatCatalogWrites.get(key) === tracked) {
				this._peerChatCatalogWrites.delete(key);
			}
		};
		const tracked = next.then(clear, error => {
			clear();
			throw error;
		});
		this._peerChatCatalogWrites.set(key, tracked);
		return tracked;
	}

	private async _applyPeerChatCatalogWrite(session: URI, mutate: (entries: IPersistedPeerChat[]) => IPersistedPeerChat[]): Promise<void> {
		const ref = this._sessionDataService.openDatabase(session);
		try {
			let current: IPersistedPeerChat[] = [];
			try {
				const raw = await ref.object.getMetadata(PEER_CHATS_METADATA_KEY);
				if (raw !== undefined) {
					const parsed = JSON.parse(raw);
					if (Array.isArray(parsed)) {
						current = parsed
							.filter((entry): entry is IPersistedPeerChat => typeof entry?.uri === 'string')
							.map(entry => ({
								uri: entry.uri,
								...(typeof entry.providerData === 'string' ? { providerData: entry.providerData } : {}),
								...(entry.origin !== undefined ? { origin: entry.origin } : {}),
								...(typeof entry.inheritedTurnId === 'string' ? { inheritedTurnId: entry.inheritedTurnId } : {}),
							}));
					}
				}
			} catch (err) {
				this._logService.warn(`[AgentService] Replacing malformed peer-chat catalog for ${session.toString()}: ${toErrorMessage(err)}`);
			}
			const updated = mutate(current);
			await ref.object.setMetadata(PEER_CHATS_METADATA_KEY, JSON.stringify(updated));
		} finally {
			ref.dispose();
		}
	}

	private async _getSessionMetadataForRestore(agent: IAgent, session: URI, external: boolean): Promise<IAgentSessionMetadata | undefined> {
		const sessionStr = session.toString();
		const chat = URI.parse(buildDefaultChatUri(session));
		try {
			const metadata = await agent.getChatMetadata(chat, this._chatContext(session, chat), await this._readDefaultChatProviderData(session), { activation: 'restore' });
			return await this._withWorktreeProject(session, metadata ? this._toSessionMetadata(metadata) : undefined);
		} catch (err) {
			if (err instanceof ProtocolError) {
				throw err;
			}
			try {
				return await this._withWorktreeProject(session, await this._getSessionMetadataFromCatalog(agent, session, external));
			} catch (fallbackErr) {
				if (fallbackErr instanceof ProtocolError) {
					const message = err instanceof Error ? err.message : String(err);
					throw new ProtocolError(fallbackErr.code, `Failed to get chat metadata for ${sessionStr}: ${message}; ${fallbackErr.message}`, fallbackErr.data);
				}
				throw fallbackErr;
			}
		}
	}

	private async _withWorktreeProject(session: URI, meta: IAgentSessionMetadata | undefined): Promise<IAgentSessionMetadata | undefined> {
		if (!meta) {
			return meta;
		}
		const project = await this._worktree.resolveWorktreeProject(session);
		return project ? { ...meta, project } : meta;
	}

	private async _getSessionMetadataFromCatalog(agent: IAgent, session: URI, external: boolean): Promise<IAgentSessionMetadata | undefined> {
		const sessionStr = session.toString();
		let allSessions;
		try {
			if (external) {
				return undefined;
			}
			allSessions = await this._enumerateLegacyProviderSessions(agent);
		} catch (err) {
			if (err instanceof ProtocolError) {
				throw err;
			}
			const message = err instanceof Error ? err.message : String(err);
			throw new ProtocolError(JSON_RPC_INTERNAL_ERROR, `Failed to list sessions for ${sessionStr}: ${message}`);
		}
		return allSessions === AgentChatMigrationDeferred ? undefined : allSessions?.find(candidate => candidate.session.toString() === sessionStr);
	}

	async resourceRead(uri: URI, encoding: ContentEncoding = ContentEncoding.Utf8): Promise<ResourceReadResult> {
		const editAttributionRequest = parseEditAttributionResource(uri);
		if (editAttributionRequest?.kind === 'prepare') {
			const prepared = await this.prepareEditAttributionFlush(editAttributionRequest.params);
			return {
				data: JSON.stringify(prepared ?? null),
				encoding: ContentEncoding.Utf8,
				contentType: 'application/json',
			};
		}
		if (editAttributionRequest?.kind === 'commit') {
			const result = await this.commitEditAttributionFlush(editAttributionRequest.params);
			return {
				data: JSON.stringify(result),
				encoding: ContentEncoding.Utf8,
				contentType: 'application/json',
			};
		}
		if (editAttributionRequest?.kind === 'cancel') {
			const result = await this.cancelEditAttributionFlush(editAttributionRequest.params);
			return {
				data: JSON.stringify(result),
				encoding: ContentEncoding.Utf8,
				contentType: 'application/json',
			};
		}

		const dbFields = parseSessionDbUri(uri.toString());
		if (dbFields) {
			return this._fetchSessionDbContent(dbFields);
		}

		const blobFields = parseGitBlobUri(uri.toString());
		if (blobFields) {
			return this._fetchGitBlobContent(blobFields);
		}

		try {
			const content = await this._fileService.readFile(uri);
			return {
				data: encoding === ContentEncoding.Base64 ? encodeBase64(content.value) : content.value.toString(),
				encoding,
				contentType: getMediaOrTextMime(uri.path) ?? 'application/octet-stream',
			};
		} catch (e) {
			const error = e instanceof Error ? e : new Error(String(e));
			const result = toFileOperationResult(error);
			if (result === FileOperationResult.FILE_NOT_FOUND) {
				throw new ProtocolError(AhpErrorCodes.NotFound, `Content not found: ${uri.toString()}`);
			}
			if (result === FileOperationResult.FILE_PERMISSION_DENIED) {
				throw new ProtocolError(AhpErrorCodes.PermissionDenied, `Permission denied: ${uri.toString()}`);
			}
			throw new ProtocolError(JSON_RPC_INTERNAL_ERROR, `Failed to read content: ${uri.toString()}: ${toErrorMessage(error)}`);
		}
	}

	prepareEditAttributionFlush(params: IPrepareEditAttributionFlushParams): Promise<IPreparedEditAttributionFlush | undefined> {
		return this._editAttributionService.prepareFlush(params);
	}

	commitEditAttributionFlush(params: ICommitEditAttributionFlushParams): Promise<IEditAttributionFlushResult> {
		return this._editAttributionService.commitFlush(params);
	}

	cancelEditAttributionFlush(params: ICancelEditAttributionFlushParams): Promise<IEditAttributionFlushResult> {
		return this._editAttributionService.cancelFlush(params);
	}

	async resourceWrite(params: ResourceWriteParams): Promise<ResourceWriteResult> {
		const fileUri = typeof params.uri === 'string' ? URI.parse(params.uri) : URI.revive(params.uri);
		try {
			const parent = await this._fileService.stat(resourcesDirname(fileUri));
			if (!parent.isDirectory) {
				throw new ProtocolError(AhpErrorCodes.NotFound, `Parent directory not found: ${fileUri.toString()}`);
			}
		} catch (e) {
			if (e instanceof ProtocolError) {
				throw e;
			}
			const result = toFileOperationResult(e as Error);
			if (result === FileOperationResult.FILE_PERMISSION_DENIED) {
				throw new ProtocolError(AhpErrorCodes.PermissionDenied, `Permission denied: ${fileUri.toString()}`);
			}
			throw new ProtocolError(AhpErrorCodes.NotFound, `Parent directory not found: ${fileUri.toString()}`);
		}
		let content: VSBuffer;
		if (params.encoding === ContentEncoding.Base64) {
			content = decodeBase64(params.data);
		} else {
			content = VSBuffer.fromString(params.data);
		}
		const mode = params.mode ?? ResourceWriteMode.Truncate;
		const position = params.position ?? 0;
		try {
			await this._resourceWriteQueue.queueFor(fileUri, async () => {
				if (params.ifMatch !== undefined || mode !== ResourceWriteMode.Truncate || position !== 0) {
					await this._resourceWriteWithMode(fileUri, content, mode, position, params);
				} else if (params.createOnly) {
					await this._createFileExclusive(fileUri, content);
				} else {
					await this._fileService.writeFile(fileUri, content);
				}
			}, extUriBiasedIgnorePathCase);
			return {};
		} catch (e) {
			if (e instanceof ProtocolError) {
				throw e;
			}
			const result = toFileOperationResult(e as Error);
			if (params.createOnly && (result === FileOperationResult.FILE_MODIFIED_SINCE || result === FileOperationResult.FILE_MOVE_CONFLICT)) {
				throw new ProtocolError(AhpErrorCodes.AlreadyExists, `File already exists: ${fileUri.toString()}`);
			}
			if (result === FileOperationResult.FILE_MODIFIED_SINCE) {
				const message = params.ifMatch !== undefined
					? `ifMatch precondition failed for: ${fileUri.toString()}`
					: `File changed while writing: ${fileUri.toString()}`;
				throw new ProtocolError(AhpErrorCodes.Conflict, message);
			}
			if (result === FileOperationResult.FILE_MOVE_CONFLICT) {
				throw new ProtocolError(AhpErrorCodes.AlreadyExists, `File already exists: ${fileUri.toString()}`);
			}
			if (result === FileOperationResult.FILE_PERMISSION_DENIED) {
				throw new ProtocolError(AhpErrorCodes.PermissionDenied, `Permission denied: ${fileUri.toString()}`);
			}
			throw new ProtocolError(AhpErrorCodes.NotFound, `Failed to write file: ${fileUri.toString()}`);
		}
	}

	private async _createFileExclusive(fileUri: URI, content: VSBuffer): Promise<void> {
		if (fileUri.scheme !== Schemas.file) {
			await this._fileService.createFile(fileUri, content, { overwrite: false });
			return;
		}

		let handle: FileHandle;
		try {
			handle = await open(fileUri.fsPath, 'wx');
		} catch (error) {
			if (isErrorWithCode(error, 'EEXIST')) {
				throw new ProtocolError(AhpErrorCodes.AlreadyExists, `File already exists: ${fileUri.toString()}`);
			}
			throw error;
		}

		let failure: unknown;
		try {
			await handle.writeFile(content.buffer);
		} catch (error) {
			failure = error;
		}
		try {
			await handle.close();
		} catch (error) {
			failure = failure ? new AggregateError([failure, error]) : error;
		}
		if (failure) {
			try {
				await unlink(fileUri.fsPath);
			} catch (cleanupError) {
				throw new AggregateError([failure, cleanupError], `Failed to create and clean up file: ${fileUri.toString()}`);
			}
			throw failure;
		}
	}

	private async _resourceWriteWithMode(
		fileUri: URI,
		data: VSBuffer,
		mode: ResourceWriteMode,
		position: number,
		params: ResourceWriteParams,
	): Promise<void> {
		let existing: VSBuffer | undefined;
		let currentEtag: string | undefined;
		let currentMtime: number | undefined;
		try {
			const file = await this._fileService.readFile(fileUri);
			existing = file.value;
			currentEtag = file.etag;
			currentMtime = file.mtime;
		} catch (e) {
			if (toFileOperationResult(e as Error) !== FileOperationResult.FILE_NOT_FOUND) {
				throw e;
			}
		}

		if (params.createOnly && existing !== undefined) {
			throw new ProtocolError(AhpErrorCodes.AlreadyExists, `File already exists: ${fileUri.toString()}`);
		}

		if (params.ifMatch !== undefined) {
			if (existing === undefined || currentEtag !== params.ifMatch) {
				throw new ProtocolError(AhpErrorCodes.Conflict, `ifMatch precondition failed for: ${fileUri.toString()}`);
			}
		}

		const base = existing ?? VSBuffer.alloc(0);
		let next: VSBuffer;
		switch (mode) {
			case ResourceWriteMode.Append: {
				const eof = base.byteLength;
				const splitAt = Math.max(0, eof - position);
				next = VSBuffer.concat([base.slice(0, splitAt), data, base.slice(splitAt, eof)]);
				break;
			}
			case ResourceWriteMode.Insert: {
				const splitAt = Math.min(position, base.byteLength);
				next = VSBuffer.concat([base.slice(0, splitAt), data, base.slice(splitAt, base.byteLength)]);
				break;
			}
			case ResourceWriteMode.Truncate:
			default: {
				const splitAt = Math.min(position, base.byteLength);
				next = VSBuffer.concat([base.slice(0, splitAt), data]);
				break;
			}
		}
		if (params.createOnly) {
			await this._createFileExclusive(fileUri, next);
		} else {
			await this._fileService.writeFile(fileUri, next, { etag: currentEtag, mtime: currentMtime });
		}
	}

	async resourceCopy(params: ResourceCopyParams): Promise<ResourceCopyResult> {
		const source = URI.parse(params.source);
		const destination = URI.parse(params.destination);
		try {
			await this._fileService.copy(source, destination, !params.failIfExists);
			return {};
		} catch (e) {
			const result = toFileOperationResult(e as Error);
			if (result === FileOperationResult.FILE_MOVE_CONFLICT) {
				throw new ProtocolError(AhpErrorCodes.AlreadyExists, `Destination already exists: ${destination.toString()}`);
			}
			if (result === FileOperationResult.FILE_PERMISSION_DENIED) {
				throw new ProtocolError(AhpErrorCodes.PermissionDenied, `Permission denied: ${source.toString()}`);
			}
			throw new ProtocolError(AhpErrorCodes.NotFound, `Source not found: ${source.toString()}`);
		}
	}

	async resourceDelete(params: ResourceDeleteParams): Promise<ResourceDeleteResult> {
		const fileUri = URI.parse(params.uri);
		try {
			await this._fileService.del(fileUri, { recursive: params.recursive });
			return {};
		} catch (e) {
			if (toFileOperationResult(e as Error) === FileOperationResult.FILE_PERMISSION_DENIED) {
				throw new ProtocolError(AhpErrorCodes.PermissionDenied, `Permission denied: ${fileUri.toString()}`);
			}
			throw new ProtocolError(AhpErrorCodes.NotFound, `Resource not found: ${fileUri.toString()}`);
		}
	}

	async resourceMove(params: ResourceMoveParams): Promise<ResourceMoveResult> {
		const source = URI.parse(params.source);
		const destination = URI.parse(params.destination);
		try {
			await this._fileService.move(source, destination, !params.failIfExists);
			return {};
		} catch (e) {
			const result = toFileOperationResult(e as Error);
			if (result === FileOperationResult.FILE_MOVE_CONFLICT) {
				throw new ProtocolError(AhpErrorCodes.AlreadyExists, `Destination already exists: ${destination.toString()}`);
			}
			if (result === FileOperationResult.FILE_PERMISSION_DENIED) {
				throw new ProtocolError(AhpErrorCodes.PermissionDenied, `Permission denied: ${source.toString()}`);
			}
			throw new ProtocolError(AhpErrorCodes.NotFound, `Source not found: ${source.toString()}`);
		}
	}

	async resourceResolve(params: ResourceResolveParams): Promise<ResourceResolveResult> {
		const uri = typeof params.uri === 'string' ? URI.parse(params.uri) : URI.revive(params.uri);
		try {
			const stat = await this._fileService.stat(uri);
			let type: ResourceType;
			if (stat.isSymbolicLink && params.followSymlinks === false) {
				type = ResourceType.Symlink;
			} else if (stat.isDirectory) {
				type = ResourceType.Directory;
			} else {
				type = ResourceType.File;
			}
			const result: ResourceResolveResult = {
				uri: uri.toString(),
				type,
				...(stat.size !== undefined ? { size: stat.size } : {}),
				...(stat.mtime !== undefined ? { mtime: new Date(stat.mtime).toISOString() } : {}),
				...(stat.ctime !== undefined ? { ctime: new Date(stat.ctime).toISOString() } : {}),
				...(stat.etag ? { etag: stat.etag } : {}),
			};
			return result;
		} catch (e) {
			if (toFileOperationResult(e as Error) === FileOperationResult.FILE_PERMISSION_DENIED) {
				throw new ProtocolError(AhpErrorCodes.PermissionDenied, `Permission denied: ${uri.toString()}`);
			}
			throw new ProtocolError(AhpErrorCodes.NotFound, `Resource not found: ${uri.toString()}`);
		}
	}

	async resourceMkdir(params: ResourceMkdirParams): Promise<ResourceMkdirResult> {
		const uri = typeof params.uri === 'string' ? URI.parse(params.uri) : URI.revive(params.uri);
		try {
			const existing = await this._fileService.stat(uri).catch(() => undefined);
			if (existing && !existing.isDirectory) {
				throw new ProtocolError(AhpErrorCodes.AlreadyExists, `Path exists and is not a directory: ${uri.toString()}`);
			}
			await this._fileService.createFolder(uri);
			return {};
		} catch (e) {
			if (e instanceof ProtocolError) {
				throw e;
			}
			if (toFileOperationResult(e as Error) === FileOperationResult.FILE_PERMISSION_DENIED) {
				throw new ProtocolError(AhpErrorCodes.PermissionDenied, `Permission denied: ${uri.toString()}`);
			}
			throw new ProtocolError(AhpErrorCodes.NotFound, `Failed to create directory: ${uri.toString()}`);
		}
	}

	async createResourceWatch(params: CreateResourceWatchParams): Promise<CreateResourceWatchResult> {
		const root = typeof params.uri === 'string' ? URI.parse(params.uri) : URI.revive(params.uri);
		try {
			await this._fileService.stat(root);
		} catch (e) {
			if (toFileOperationResult(e as Error) === FileOperationResult.FILE_PERMISSION_DENIED) {
				throw new ProtocolError(AhpErrorCodes.PermissionDenied, `Permission denied: ${root.toString()}`);
			}
			throw new ProtocolError(AhpErrorCodes.NotFound, `Resource not found: ${root.toString()}`);
		}

		const channel = buildResourceWatchChannelUri({
			root: root.toString(),
			recursive: params.recursive === true,
			excludes: params.excludes,
			includes: params.includes,
		});
		return { channel };
	}

	onResourceWatchSubscribed(channel: string): ResourceWatchState | undefined {
		const descriptor = parseResourceWatchChannelUri(channel);
		if (!descriptor) {
			return undefined;
		}
		const existing = this._resourceWatches.get(channel);
		if (existing) {
			existing.subscribers++;
			if (existing.pendingGc) {
				existing.pendingGc.clear();
			}
			return existing.descriptor;
		}
		const disposables = new DisposableStore();
		try {
			const root = URI.parse(descriptor.root);
			const watchOptions = {
				recursive: descriptor.recursive,
				excludes: descriptor.excludes?.items ?? [],
				includes: descriptor.includes?.items,
			};
			if (descriptor.recursive) {
				disposables.add(this._fileService.watch(root, watchOptions));
				disposables.add(this._fileService.onDidFilesChange(event => {
					const filtered = collectChangesUnderRoot(event, root);
					if (filtered.length > 0) {
						this._dispatchResourceWatchChanges(channel, filtered);
					}
				}));
			} else {
				const watcher = this._fileService.createWatcher(root, { ...watchOptions, recursive: false });
				disposables.add(watcher);
				disposables.add(watcher.onDidChange(event => {
					this._dispatchResourceWatchChanges(channel, collectChanges(event));
				}));
			}
		} catch (e) {
			disposables.dispose();
			this._logService.warn(`[AgentService] Failed to start IFileService watcher for ${channel}: ${e instanceof Error ? e.message : String(e)}`);
			return undefined;
		}
		this._resourceWatches.set(channel, {
			channel,
			descriptor,
			subscribers: 1,
			disposables,
			pendingGc: disposables.add(new MutableDisposable()),
			dispose: () => disposables.dispose(),
		});
		return descriptor;
	}

	onResourceWatchUnsubscribed(channel: string): boolean {
		const entry = this._resourceWatches.get(channel);
		if (!entry) {
			return false;
		}
		entry.subscribers = Math.max(0, entry.subscribers - 1);
		if (entry.subscribers > 0) {
			return true;
		}
		entry.pendingGc.value = disposableTimeout(() => {
			const current = this._resourceWatches.get(channel);
			if (!current || current.subscribers > 0) {
				return;
			}
			this._resourceWatches.deleteAndDispose(channel);
		}, RESOURCE_WATCH_GRACE_MS);
		return true;
	}

	private _dispatchResourceWatchChanges(channel: string, raw: readonly IFileChange[]): void {
		if (raw.length === 0) {
			return;
		}
		const items = raw.map(c => ({
			uri: c.resource.toString(),
			type: c.type === FileChangeType.ADDED ? ResourceChangeType.Added
				: c.type === FileChangeType.DELETED ? ResourceChangeType.Deleted
					: ResourceChangeType.Updated,
		}));
		this._stateManager.dispatchServerAction(channel, {
			type: ActionType.ResourceWatchChanged,
			changes: { items },
		});
	}

	async shutdown(): Promise<void> {
		this._logService.info('AgentService: shutting down all providers...');
		try {
			await this._providerService.shutdown();
		} finally {
			await this._debugLogsCollector?.cleanup();
			await this._orchestratorDatabase.close();
			this._downloadProgressInterest.clear();
		}
	}

	async getNetworkDiagnosticsInfo(): Promise<IAgentHostNetworkDiagnosticsInfo> {
		const { endpoints, account } = await this._providerService.getNetworkDiagnostics();
		return this._networkDiagnostics.getInfo(endpoints, account);
	}

	async getManagedSettingsDiagnostics(): Promise<readonly IAgentHostManagedSettingsDiagnostics[]> {
		return this._providerService.getManagedSettingsDiagnostics();
	}

	async diagnosticsFetch(url: string): Promise<IAgentHostNetworkFetchResult> {
		return this._networkDiagnostics.fetch(url);
	}

	async getSessionStateFile(session: URI, chat?: URI): Promise<URI | undefined> {
		return this._providerService.getProviderForSession(session)?.getSessionStateFile?.(session, chat);
	}

	async collectDebugLogs(session: URI | undefined, kind: AgentHostDebugLogsArtifactKind, chat?: URI): Promise<IAgentHostDebugLogsArtifact> {
		if (!this._debugLogsCollector) {
			throw new Error('Agent Host debug log collection is unavailable');
		}
		const providers = session
			? [this._providerService.getProviderForSession(session)].filter((provider): provider is IAgent => provider !== undefined)
			: this._providerService.getProviders();
		if (providers.length === 0) {
			throw new Error(session
				? `No Agent Host provider is available for session ${session.toString()}`
				: 'No Agent Host providers are available for debug-log collection');
		}
		return this._debugLogsCollector.collect(providers, session, kind, chat);
	}

	async readDebugLogsChunk(resource: URI, position: number): Promise<IAgentHostDebugLogsChunk> {
		if (!this._debugLogsCollector) {
			throw new Error('Agent Host debug log collection is unavailable');
		}
		return this._debugLogsCollector.readArtifactChunk(resource, position);
	}


	private async _fetchSessionDbContent(fields: ISessionDbUriFields): Promise<ResourceReadResult> {
		const sessionUri = URI.parse(fields.sessionUri);
		const ref = this._sessionDataService.openDatabase(sessionUri);
		try {
			const content = await ref.object.readFileEditContent(fields.toolCallId, fields.filePath);
			if (!content) {
				throw new ProtocolError(AhpErrorCodes.NotFound, `File edit not found: toolCallId=${fields.toolCallId}, filePath=${fields.filePath}`);
			}
			const bytes = fields.part === 'before' ? content.beforeContent : content.afterContent;
			if (!bytes) {
				throw new ProtocolError(AhpErrorCodes.NotFound, `No ${fields.part} content for: toolCallId=${fields.toolCallId}, filePath=${fields.filePath}`);
			}
			return {
				data: new TextDecoder().decode(bytes),
				encoding: ContentEncoding.Utf8,
				contentType: 'text/plain',
			};
		} finally {
			ref.dispose();
		}
	}

	private async _fetchGitBlobContent(fields: IGitBlobUriFields): Promise<ResourceReadResult> {
		if (!this._gitService) {
			throw new ProtocolError(AhpErrorCodes.NotFound, `git service unavailable for: ${fields.repoRelativePath}`);
		}
		const owningSession = resolveAgentHostSession(URI.parse(fields.sessionUri));
		const wasRestored = !!this._stateManager.getSessionState(owningSession.toString());
		try {
			if (!wasRestored) {
				await this.restoreSession(owningSession);
			}
			const workingDirectory = await this._resolveGitBlobWorkingDirectory(fields, owningSession);
			if (!workingDirectory) {
				throw new ProtocolError(AhpErrorCodes.NotFound, `No session repository resolves git-blob path: ${fields.absolutePath || fields.repoRelativePath}`);
			}
			const blob = await this._gitService.showBlob(workingDirectory, fields.sha, fields.repoRelativePath);
			if (!blob) {
				throw new ProtocolError(AhpErrorCodes.NotFound, `git blob not found: ${fields.sha}:${fields.repoRelativePath}`);
			}
			return {
				data: blob.toString(),
				encoding: ContentEncoding.Utf8,
				contentType: 'text/plain',
			};
		} finally {
			if (!wasRestored && this._stateManager.getSessionState(owningSession.toString()) && !this._subscriptions.hasSessionSubscribers(owningSession)) {
				void this._sessionResidency.reconcile();
			}
		}
	}

	private async _resolveGitBlobWorkingDirectory(fields: IGitBlobUriFields, owningSession: URI): Promise<URI | undefined> {
		const gitService = this._gitService;
		if (!gitService) {
			return undefined;
		}
		const workingDirectories = getEffectiveWorkingDirectories(this._stateManager, fields.sessionUri)
			?? getEffectiveWorkingDirectories(this._stateManager, owningSession.toString());
		if (!fields.absolutePath) {
			const primary = workingDirectories?.[0];
			return primary ? URI.parse(primary) : undefined;
		}
		if (!workingDirectories?.length) {
			return undefined;
		}
		if (!isMultiRootSession(workingDirectories)) {
			return URI.parse(workingDirectories[0]);
		}
		const { gitRepositories } = await resolveSessionRepositories(workingDirectories.map(directory => URI.parse(directory)), gitService);
		if (!gitRepositories.length) {
			return undefined;
		}
		const blobResource = gitRepositories[0].with({ path: fields.absolutePath });
		return findDeepestContainingWorkingDirectory(blobResource, gitRepositories);
	}

	private async _restoreSubagentChat(chatUri: string, parentSession: URI, toolCallId: string): Promise<void> {
		if (this._stateManager.getChatState(chatUri)) {
			return;
		}
		const inFlight = this._restoreSubagentInFlight.get(chatUri);
		if (inFlight) {
			return inFlight;
		}
		const restore = this._doRestoreSubagentChat(chatUri, parentSession, toolCallId);
		this._restoreSubagentInFlight.set(chatUri, restore);
		try {
			await restore;
		} finally {
			if (this._restoreSubagentInFlight.get(chatUri) === restore) {
				this._restoreSubagentInFlight.delete(chatUri);
			}
		}
	}

	private async _doRestoreSubagentChat(chatUri: string, parentSession: URI, toolCallId: string): Promise<void> {
		const parentSessionKey = parentSession.toString();
		try {
			await this._restoreSessionInFlight.get(parentSessionKey);
			if (!this._stateManager.getSessionState(parentSessionKey)) {
				await this.restoreSession(parentSession);
			}
		} catch {
			this._logService.warn(`[AgentService] Cannot restore parent session for subagent chat: ${parentSessionKey}`);
			return;
		}
		const parentState = this._stateManager.getSessionState(parentSessionKey);
		const agent = this._providerService.getProviderForSession(parentSession);
		if (!parentState || !agent) {
			return;
		}
		const spawnPoint = this._findSubagentSpawnPoint(parentSessionKey, chatUri, toolCallId);
		const origin = {
			kind: ChatOriginKind.Tool,
			chat: spawnPoint?.chat ?? parentState.defaultChat ?? buildDefaultChatUri(parentSession),
			toolCallId,
		} as const;
		const childTurns = await this._getChatMessages(agent, URI.parse(chatUri), parentSession, origin);
		if (childTurns.length === 0) {
			return;
		}
		const mergedTurns = await this._interleaveLocalTurns(parentSessionKey, chatUri, childTurns);
		this._stateManager.addChat(parentSessionKey, chatUri, {
			title: spawnPoint?.title ?? 'Subagent',
			turns: mergedTurns,
			origin,
			interactivity: ChatInteractivity.ReadOnly,
		});
	}

	private _findSubagentSpawnPoint(parentSessionKey: string, subagentChatUri: string, toolCallId: string): { readonly chat: string; readonly title?: string } | undefined {
		const parentState = this._stateManager.getSessionState(parentSessionKey);
		if (!parentState) {
			return undefined;
		}
		const defaultChat = parentState.defaultChat ?? buildDefaultChatUri(parentSessionKey);
		const candidates: { chat: string; turns: readonly Turn[]; activeTurn: Turn | undefined }[] = [
			{ chat: defaultChat, turns: parentState.turns, activeTurn: parentState.activeTurn as Turn | undefined },
		];
		for (const chat of parentState.chats) {
			if (chat.resource === defaultChat || chat.resource === subagentChatUri) {
				continue;
			}
			const chatState = this._stateManager.getChatState(chat.resource);
			if (chatState) {
				candidates.push({ chat: chat.resource, turns: chatState.turns, activeTurn: chatState.activeTurn as Turn | undefined });
			}
		}
		for (const candidate of candidates) {
			for (const turn of [...candidate.turns, ...(candidate.activeTurn ? [candidate.activeTurn] : [])]) {
				for (const part of turn.responseParts) {
					if (part.kind !== ResponsePartKind.ToolCall || part.toolCall.toolCallId !== toolCallId) {
						continue;
					}
					const content = part.toolCall.status === ToolCallStatus.Completed || part.toolCall.status === ToolCallStatus.Running
						? part.toolCall.content
						: undefined;
					const subagent = content?.find((item): item is ToolResultSubagentContent => item.type === ToolResultContentType.Subagent);
					return { chat: candidate.chat, ...(subagent?.title ? { title: subagent.title } : {}) };
				}
			}
		}
		return undefined;
	}

	private async _restoreSubagentSession(subagentUri: string, parentSession: URI): Promise<void> {
		if (this._stateManager.getSessionState(subagentUri)) {
			return;
		}

		const inFlight = this._restoreSubagentInFlight.get(subagentUri);
		if (inFlight) {
			return inFlight;
		}

		const restore = this._doRestoreSubagentSession(subagentUri, parentSession);
		this._restoreSubagentInFlight.set(subagentUri, restore);
		try {
			await restore;
		} finally {
			if (this._restoreSubagentInFlight.get(subagentUri) === restore) {
				this._restoreSubagentInFlight.delete(subagentUri);
			}
		}
	}

	private async _doRestoreSubagentSession(subagentUri: string, parentSession: URI): Promise<void> {
		const parentSessionKey = parentSession.toString();
		if (!this._stateManager.getSessionState(parentSessionKey)) {
			try {
				await this.restoreSession(parentSession);
			} catch {
				this._logService.warn(`[AgentService] Cannot restore parent session for subagent: ${parentSessionKey}`);
				return;
			}
		}

		const parentState = this._stateManager.getSessionState(parentSessionKey);
		if (!parentState) {
			return;
		}

		const allTurns = [...parentState.turns];
		if (parentState.activeTurn) {
			allTurns.push(parentState.activeTurn as Turn);
		}

		let subagentContent: ToolResultSubagentContent | undefined;
		for (const turn of allTurns) {
			for (const part of turn.responseParts) {
				if (part.kind === ResponsePartKind.ToolCall) {
					const tc = part.toolCall;
					const content = tc.status === ToolCallStatus.Completed
						? tc.content
						: (tc.status === ToolCallStatus.Running ? tc.content : undefined);
					if (content) {
						for (const c of content) {
							if (c.type === ToolResultContentType.Subagent && c.resource === subagentUri) {
								subagentContent = c;
								break;
							}
						}
					}
				}
			}
			if (subagentContent) {
				break;
			}
		}

		let childTurns: readonly Turn[] = [];
		const agent = this._providerService.getProviderForSession(parentSession);
		if (agent) {
			try {
				const parsedSubagent = parseSubagentSessionUri(URI.parse(subagentUri));
				const origin = parentState.chats.find(chat => chat.resource === subagentUri)?.origin
					?? (parsedSubagent ? {
						kind: ChatOriginKind.Tool,
						chat: parentState.defaultChat ?? buildDefaultChatUri(parentSession),
						toolCallId: parsedSubagent.toolCallId,
					} : undefined);
				childTurns = await this._getChatMessages(agent, URI.parse(subagentUri), parentSession, origin);
			} catch (err) {
				this._logService.warn(`[AgentService] Failed to load subagent turns for ${subagentUri}`, err);
			}
		}

		const title = subagentContent?.title ?? 'Subagent';

		const subagentNow = new Date().toISOString();
		const mergedChildTurns = await this._interleaveLocalTurns(parentSession.toString(), subagentUri, childTurns);
		this._stateManager.restoreSession(
			{
				resource: subagentUri,
				provider: 'subagent',
				title,
				status: SessionStatus.Idle,
				createdAt: subagentNow,
				modifiedAt: subagentNow,
				...(parentState?.project ? { project: parentState.project } : {}),
			},
			mergedChildTurns,
		);
		await this._restoreAnnotations(URI.parse(subagentUri));
		this._logService.info(`[AgentService] Restored subagent session: ${subagentUri} with ${childTurns.length} turn(s)`);
	}

	private async _registerRestoredSubagentSummaries(agent: IAgent, parentSession: URI, turns: readonly Turn[]): Promise<void> {
		const parentSessionStr = parentSession.toString();
		const parentChat = buildDefaultChatUri(parentSession);
		const discovered = new Map<string, { title: string; toolCallId: string }>();
		for (const turn of turns) {
			for (const part of turn.responseParts) {
				if (part.kind !== ResponsePartKind.ToolCall) {
					continue;
				}
				const content = part.toolCall.status === ToolCallStatus.Completed || part.toolCall.status === ToolCallStatus.Running
					? part.toolCall.content
					: undefined;
				const subagent = content?.find((item): item is ToolResultSubagentContent => item.type === ToolResultContentType.Subagent);
				if (subagent) {
					discovered.set(part.toolCall.toolCallId, {
						title: subagentChatTitle(readToolCallMeta(part.toolCall).subagentDescription, subagent.title),
						toolCallId: part.toolCall.toolCallId,
					});
				}
			}
		}
		for (const child of discovered.values()) {
			const chatUri = buildSubagentChatUri(parentSessionStr, child.toolCallId);
			if (this._stateManager.getChatState(chatUri)) {
				continue;
			}
			const origin = { kind: ChatOriginKind.Tool, chat: parentChat, toolCallId: child.toolCallId } as const;
			const existing = this._stateManager.getSessionState(parentSessionStr)?.chats.find(chat => chat.resource === chatUri);
			const { title: persistedTitle } = await this._chatContributions.hydrateChat({
				session: parentSessionStr,
				chat: chatUri,
			}, {});
			const title = persistedTitle ?? child.title;
			this._stateManager.registerRestoredChatSummary(parentSessionStr, chatUri, {
				title,
				origin,
				interactivity: ChatInteractivity.ReadOnly,
				resolver: async () => ({
					turns: [...await this._resolveRestoredSubagentTurns(agent, parentSession, chatUri, origin)],
				}),
			});
			if (existing && (!existing.title || existing.title === subagentChatTitle(undefined, undefined))) {
				this._stateManager.updateChatTitle(parentSessionStr, chatUri, title);
			}
		}
	}

	private async _resolveRestoredSubagentTurns(agent: IAgent, parentSession: URI, chatUri: string, origin: { readonly kind: ChatOriginKind.Tool; readonly chat: string; readonly toolCallId: string }): Promise<readonly Turn[]> {
		const childTurns = await this._getChatMessages(agent, URI.parse(chatUri), parentSession, origin);
		if (childTurns.length === 0) {
			throw new SubagentTranscriptUnavailableError(chatUri);
		}
		return this._interleaveLocalTurns(parentSession.toString(), chatUri, childTurns);
	}

	override dispose(): void {
		this._startupSettled.open();
		super.dispose();
	}
}

function isErrorWithCode(error: unknown, code: string): boolean {
	return error instanceof Error && hasErrorCode(error, code);
}

function hasErrorCode(error: Error | { code: unknown }, code: string): boolean {
	return hasKey(error, { code: true }) && error.code === code;
}

interface IActiveResourceWatch extends IDisposable {
	readonly channel: string;
	readonly descriptor: ResourceWatchState;
	subscribers: number;
	readonly disposables: DisposableStore;
	pendingGc: MutableDisposable<IDisposable>;
}

function collectChanges(event: FileChangesEvent): IFileChange[] {
	const out: IFileChange[] = [];
	for (const resource of event.rawAdded) {
		out.push({ resource, type: FileChangeType.ADDED });
	}
	for (const resource of event.rawUpdated) {
		out.push({ resource, type: FileChangeType.UPDATED });
	}
	for (const resource of event.rawDeleted) {
		out.push({ resource, type: FileChangeType.DELETED });
	}
	return out;
}







function collectChangesUnderRoot(event: FileChangesEvent, root: URI): IFileChange[] {
	const out: IFileChange[] = [];
	const accept = (resource: URI, type: FileChangeType) => {
		if (isEqualOrParent(resource, root)) {
			out.push({ resource, type });
		}
	};
	for (const resource of event.rawAdded) { accept(resource, FileChangeType.ADDED); }
	for (const resource of event.rawUpdated) { accept(resource, FileChangeType.UPDATED); }
	for (const resource of event.rawDeleted) { accept(resource, FileChangeType.DELETED); }
	return out;
}
