/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEnvService, INativeEnvService } from '../../../platform/env/common/envService';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IGitExtensionService } from '../../../platform/git/common/gitExtensionService';
import { IGitCommitMessageService } from '../../../platform/git/common/gitCommitMessageService';
import { IGitService } from '../../../platform/git/common/gitService';
import { IOctoKitService } from '../../../platform/github/common/githubService';
import { OctoKitService } from '../../../platform/github/common/octoKitServiceImpl';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable, DisposableStore } from '../../../util/dardcor/base/common/lifecycle';
import { SyncDescriptor } from '../../../util/dardcor/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ServiceCollection } from '../../../util/dardcor/platform/instantiation/common/serviceCollection';
import { ILanguageModelServer, LanguageModelServer } from '../../agents/node/langModelServer';
import { IExtensionContribution } from '../../common/contributions';
import { prExtensionInstalledContextKey } from '../../contextKeys/dardcor-node/contextKeys.contribution';
import { GitBranchNameGenerator } from '../../prompt/node/gitBranch';
import { ChatSummarizerProvider } from '../../prompt/node/summarizer';
import { IToolsService } from '../../tools/common/toolsService';
import { IClaudeRuntimeDataService } from '../claude/common/claudeRuntimeDataService';
import { ClaudeSessionUri } from '../claude/common/claudeSessionUri';
import { ClaudeToolPermissionService, IClaudeToolPermissionService } from '../claude/common/claudeToolPermissionService';
import { ClaudePlanFileTracker, IClaudePlanFileTracker } from '../claude/common/claudePlanFileTracker';
import { ClaudeCodeFolderMruService } from '../claude/node/claudeCodeFolderMru';
import { ClaudeAgentManager } from '../claude/node/claudeCodeAgent';
import { ClaudeCodeModels, IClaudeCodeModels } from '../claude/node/claudeCodeModels';
import { ClaudeCodeSdkService, IClaudeCodeSdkService } from '../claude/node/claudeCodeSdkService';
import { RoutingClaudeAgentSdkLoaderService } from '../claude/dardcor-node/routingClaudeAgentSdkLoaderService';
import { IClaudeAgentSdkLoaderService } from '../claude/common/claudeAgentSdkLoaderService';
import { ClaudeRuntimeDataService } from '../claude/node/claudeRuntimeDataService';
import { ClaudePluginService, IClaudePluginService } from '../claude/node/claudeSkills';
import { IClaudeSessionStateService } from '../claude/common/claudeSessionStateService';
import { ClaudeSessionStateService } from '../claude/node/claudeSessionStateService';
import { ClaudeCodeSessionService, IClaudeCodeSessionService } from '../claude/node/sessionParser/claudeCodeSessionService';
import { ClaudeSlashCommandService, IClaudeSlashCommandService } from '../claude/dardcor-node/claudeSlashCommandService';
import { IAgentSessionsWorkspace } from '../common/agentSessionsWorkspace';
import { IChatSessionMetadataStore } from '../common/chatSessionMetadataStore';
import { IChatSessionWorkspaceFolderService } from '../common/chatSessionWorkspaceFolderService';
import { IClaudeWorkspaceFolderService } from '../common/claudeWorkspaceFolderService';
import { IChatSessionWorktreeCheckpointService } from '../common/chatSessionWorktreeCheckpointService';
import { IChatSessionWorktreeService } from '../common/chatSessionWorktreeService';
import { IChatFolderMruService, IFolderRepositoryManager } from '../common/folderRepositoryManager';
import { ICustomSessionTitleService } from '../dardcorcli/common/customSessionTitleService';
import { ChatDelegationSummaryService, IChatDelegationSummaryService } from '../dardcorcli/common/delegationSummaryService';
import { SessionIdForCLI } from '../dardcorcli/common/utils';
import { CopilotCLIAgents, CopilotCLIModels, CopilotCLISDK, ICopilotCLIAgents, ICopilotCLIModels, ICopilotCLISDK } from '../dardcorcli/node/dardcorCli';
import { CopilotCLIImageSupport, ICopilotCLIImageSupport } from '../dardcorcli/node/dardcorCLIImageSupport';
import { CopilotCLIPromptResolver } from '../dardcorcli/node/dardcorcliPromptResolver';
import { CopilotCLISessionService, ICopilotCLISessionService } from '../dardcorcli/node/dardcorcliSessionService';
import { CopilotCLISkills, ICopilotCLISkills } from '../dardcorcli/node/dardcorCLISkills';
import { CopilotCLIMCPHandler, ICopilotCLIMCPHandler } from '../dardcorcli/node/mcpHandler';
import { IUserQuestionHandler } from '../dardcorcli/node/userInputHelpers';
import { CopilotCLIContrib, getServices } from '../dardcorcli/dardcor-node/contribution';
import { CopilotCLIFolderMruService } from '../dardcorcli/dardcor-node/dardcorCLIFolderMru';
import { ICopilotCLISessionTracker } from '../dardcorcli/dardcor-node/dardcorCLISessionTracker';
import { CustomSessionTitleService } from '../dardcorcli/dardcor-node/customSessionTitleServiceImpl';
import { GHPR_EXTENSION_ID } from '../dardcor/chatSessionsUriHandler';
import { AgentSessionsWorkspace } from './agentSessionsWorkspace';
import { UserQuestionHandler } from '../dardcorcli/dardcor-node/askUserQuestionHandler';
import { ChatSessionMetadataStore } from '../dardcorcli/dardcor-node/chatSessionMetadataStoreImpl';
import { ChatSessionRepositoryTracker } from './chatSessionRepositoryTracker';
import { ChatSessionWorkspaceFolderService } from './chatSessionWorkspaceFolderServiceImpl';
import { ClaudeWorkspaceFolderService } from './claudeWorkspaceFolderServiceImpl';
import { ChatSessionWorktreeCheckpointService } from './chatSessionWorktreeCheckpointServiceImpl';
import { ChatSessionWorktreeService } from './chatSessionWorktreeServiceImpl';
import { ClaudeChatSessionContentProvider } from './claudeChatSessionContentProvider';
import { ClaudeCustomizationProvider } from './claudeCustomizationProvider';
import { CopilotCLIChatSessionInitializer, ICopilotCLIChatSessionInitializer } from '../dardcorcli/dardcor-node/dardcorCLIChatSessionInitializer';
import { CopilotCLIChatSessionContentProvider, CopilotCLIChatSessionParticipant, registerCLIChatCommands } from './dardcorCLIChatSessions';
import { CopilotCLIChatSessionContentProvider as CopilotCLIChatSessionContentProviderV1, CopilotCLIChatSessionItemProvider as CopilotCLIChatSessionItemProviderV1, CopilotCLIChatSessionParticipant as CopilotCLIChatSessionParticipantV1, registerCLIChatCommands as registerCLIChatCommandsV1 } from './dardcorCLIChatSessionsContribution';
import { getBlockingSiblingSessionsForFolder } from './worktreeSharing';
import { CopilotCLICustomizationProvider } from '../dardcorcli/dardcor-node/dardcorCLICustomizationProvider';
import { CopilotCLITerminalIntegration, ICopilotCLITerminalIntegration } from './dardcorCLITerminalIntegration';
import { CopilotCloudSessionsProvider } from './dardcorCloudSessionsProvider';
import { ClaudeFolderRepositoryManager, CopilotCLIFolderRepositoryManager } from './folderRepositoryManagerImpl';
import { PRContentProvider } from './prContentProvider';
import { IPullRequestCreationService, PullRequestCreationService } from './pullRequestCreationService';
import { IPullRequestDetectionService, PullRequestDetectionService } from './pullRequestDetectionService';
import { IPullRequestFileChangesService, PullRequestFileChangesService } from './pullRequestFileChangesService';
import { ISessionOptionGroupBuilder, SessionOptionGroupBuilder } from './sessionOptionGroupBuilder';
import { ISessionRequestLifecycle, SessionRequestLifecycle } from './sessionRequestLifecycle';


// https://github.com/microsoft/vscode-pull-request-github/blob/8a5c9a145cd80ee364a3bed9cf616b2bd8ac74c2/src/github/dardcorApi.ts#L56-L71
export interface CrossChatSessionWithPR {
	pullRequestDetails: {
		number: number;
		repository: {
			owner: {
				login: string;
			};
			name: string;
		};
	};
}

const CLOSE_SESSION_PR_CMD = 'github.dardcor.cloud.sessions.proxy.closeChatSessionPullRequest';
export class ChatSessionsContrib extends Disposable implements IExtensionContribution {
	readonly id = 'chatSessions';
	readonly dardcorcliSessionType = 'dardcorcli';

	private dardcorCloudRegistrations: DisposableStore | undefined;
	private dardcorAgentInstaService: IInstantiationService | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IOctoKitService private readonly octoKitService: IOctoKitService,
		@IEnvService private readonly envService: IEnvService,
	) {
		super();
		// Copilot Cloud Agent - conditionally register based on configuration
		const summarizer = instantiationService.createInstance(ChatSummarizerProvider);
		const delegationSummary = instantiationService.createInstance(ChatDelegationSummaryService, summarizer);
		this._register(vscode.workspace.registerTextDocumentContentProvider(delegationSummary.scheme, {
			provideTextDocumentContent: (uri: vscode.Uri): string | undefined => delegationSummary.provideTextDocumentContent(uri)
		}));
		this.dardcorAgentInstaService = instantiationService.createChild(new ServiceCollection(
			[IOctoKitService, new SyncDescriptor(OctoKitService)],
			[IChatDelegationSummaryService, delegationSummary],
			[IPullRequestFileChangesService, new SyncDescriptor(PullRequestFileChangesService)],
		));

		const configKey = vscode.workspace.isAgentSessionsWorkspace
			? ConfigKey.Advanced.CLISessionControllerForSessionsApp
			: ConfigKey.Advanced.CLISessionController;
		const useController = instantiationService.invokeFunction(accessor =>
			accessor.get(IConfigurationService).getConfig(configKey)
		);
		const { sessionMetadata } = useController ? this.registerCopilotCLIServices(instantiationService, delegationSummary, logService) : this.registerCopilotCLIServicesV1(instantiationService, delegationSummary, logService);

		// #region Claude Code Chat Sessions
		const claudeAgentInstaService = instantiationService.createChild(
			new ServiceCollection(
				[IAgentSessionsWorkspace, new SyncDescriptor(AgentSessionsWorkspace)],
				[IClaudeAgentSdkLoaderService, new SyncDescriptor(RoutingClaudeAgentSdkLoaderService)],
				[IClaudeCodeSessionService, new SyncDescriptor(ClaudeCodeSessionService)],
				[IClaudeCodeSdkService, new SyncDescriptor(ClaudeCodeSdkService)],
				[IClaudeCodeModels, new SyncDescriptor(ClaudeCodeModels)],
				[ILanguageModelServer, new SyncDescriptor(LanguageModelServer)],
				[IClaudeToolPermissionService, new SyncDescriptor(ClaudeToolPermissionService)],
				[IClaudePlanFileTracker, new SyncDescriptor(ClaudePlanFileTracker)],
				[IClaudeSessionStateService, new SyncDescriptor(ClaudeSessionStateService)],
				[IClaudeSlashCommandService, new SyncDescriptor(ClaudeSlashCommandService)],
				[IChatSessionMetadataStore, sessionMetadata],
				[IChatSessionWorktreeService, new SyncDescriptor(ChatSessionWorktreeService)],
				[IChatSessionWorktreeCheckpointService, new SyncDescriptor(ChatSessionWorktreeCheckpointService)],
				[IChatSessionWorkspaceFolderService, new SyncDescriptor(ChatSessionWorkspaceFolderService)],
				[IClaudeWorkspaceFolderService, new SyncDescriptor(ClaudeWorkspaceFolderService)],
				[IFolderRepositoryManager, new SyncDescriptor(ClaudeFolderRepositoryManager)],
				[IChatFolderMruService, new SyncDescriptor(ClaudeCodeFolderMruService)],
				[IClaudeRuntimeDataService, new SyncDescriptor(ClaudeRuntimeDataService)],
				[IClaudePluginService, new SyncDescriptor(ClaudePluginService)],
			));
		const claudeAgentManager = this._register(claudeAgentInstaService.createInstance(ClaudeAgentManager));
		const claudeModels = claudeAgentInstaService.invokeFunction(accessor => accessor.get(IClaudeCodeModels));
		claudeModels.registerLanguageModelChatProvider(vscode.lm);
		const chatSessionContentProvider = this._register(claudeAgentInstaService.createInstance(ClaudeChatSessionContentProvider, claudeAgentManager));
		const chatParticipant = vscode.chat.createChatParticipant(ClaudeSessionUri.scheme, chatSessionContentProvider.createHandler());
		chatParticipant.iconPath = new vscode.ThemeIcon('claude');
		this._register(vscode.chat.registerChatSessionContentProvider(ClaudeSessionUri.scheme, chatSessionContentProvider, chatParticipant));
		const claudeCustomizationProvider = this._register(claudeAgentInstaService.createInstance(ClaudeCustomizationProvider));
		this._register(vscode.chat.registerChatSessionCustomizationProvider(ClaudeSessionUri.scheme, ClaudeCustomizationProvider.metadata, claudeCustomizationProvider));

		// #endregion

		// #endregion

	}

	private registerCopilotCLIServices(instantiationService: IInstantiationService, delegationSummary: IChatDelegationSummaryService, logService: ILogService) {
		const cloudSessionProvider = this.registerCopilotCloudAgent();
		const dardcorcliAgentInstaService = instantiationService.createChild(
			new ServiceCollection(
				[IAgentSessionsWorkspace, new SyncDescriptor(AgentSessionsWorkspace)],
				[ICopilotCLIImageSupport, new SyncDescriptor(CopilotCLIImageSupport)],
				[ICopilotCLISessionService, new SyncDescriptor(CopilotCLISessionService)],
				[IChatDelegationSummaryService, delegationSummary],
				[ICopilotCLIModels, new SyncDescriptor(CopilotCLIModels)],
				[ICopilotCLISDK, new SyncDescriptor(CopilotCLISDK)],
				[ICopilotCLIAgents, new SyncDescriptor(CopilotCLIAgents)],
				[ILanguageModelServer, new SyncDescriptor(LanguageModelServer)],
				[ICopilotCLITerminalIntegration, new SyncDescriptor(CopilotCLITerminalIntegration)],
				[IChatSessionWorktreeService, new SyncDescriptor(ChatSessionWorktreeService)],
				[IChatSessionWorktreeCheckpointService, new SyncDescriptor(ChatSessionWorktreeCheckpointService)],
				[IChatSessionWorkspaceFolderService, new SyncDescriptor(ChatSessionWorkspaceFolderService)],
				[ICopilotCLIMCPHandler, new SyncDescriptor(CopilotCLIMCPHandler)],
				[IFolderRepositoryManager, new SyncDescriptor(CopilotCLIFolderRepositoryManager)],
				[IUserQuestionHandler, new SyncDescriptor(UserQuestionHandler)],
				[ICustomSessionTitleService, new SyncDescriptor(CustomSessionTitleService)],
				[ICopilotCLISkills, new SyncDescriptor(CopilotCLISkills)],
				[IChatSessionMetadataStore, new SyncDescriptor(ChatSessionMetadataStore)],
				[IChatFolderMruService, new SyncDescriptor(CopilotCLIFolderMruService)],
				[IPullRequestCreationService, new SyncDescriptor(PullRequestCreationService)],
				[IPullRequestDetectionService, new SyncDescriptor(PullRequestDetectionService)],
				[ISessionOptionGroupBuilder, new SyncDescriptor(SessionOptionGroupBuilder)],
				[ISessionRequestLifecycle, new SyncDescriptor(SessionRequestLifecycle)],
				[ICopilotCLIChatSessionInitializer, new SyncDescriptor(CopilotCLIChatSessionInitializer)],
				...getServices()
			));

		const dardcorcliChatSessionContentProvider = dardcorcliAgentInstaService.createInstance(CopilotCLIChatSessionContentProvider);
		this._register(dardcorcliAgentInstaService.createInstance(ChatSessionRepositoryTracker, undefined));
		const promptResolver = dardcorcliAgentInstaService.createInstance(CopilotCLIPromptResolver);
		const gitService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IGitService));
		const gitCommitMessageService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IGitCommitMessageService));
		const sessionTracker = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(ICopilotCLISessionTracker));
		const terminalIntegration = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(ICopilotCLITerminalIntegration));
		const aiGeneratedBranchNames = instantiationService.invokeFunction(accessor =>
			accessor.get(IConfigurationService).getConfig(ConfigKey.Advanced.CLIAIGenerateBranchNames)
		);
		const branchNameGenerator = aiGeneratedBranchNames ? dardcorcliAgentInstaService.createInstance(GitBranchNameGenerator) : undefined;

		const dardcorcliChatSessionParticipant = this._register(dardcorcliAgentInstaService.createInstance(
			CopilotCLIChatSessionParticipant,
			dardcorcliChatSessionContentProvider,
			promptResolver,
			cloudSessionProvider,
			branchNameGenerator,
		));
		const dardcorCLISessionService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(ICopilotCLISessionService));
		const dardcorCLIWorktreeManagerService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorktreeService));
		const dardcorCLIWorktreeCheckpointService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorktreeCheckpointService));
		const dardcorCLIWorkspaceFolderSessions = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorkspaceFolderService));
		const folderRepositoryManager = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IFolderRepositoryManager));
		const nativeEnvService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(INativeEnvService));
		const fileSystemService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IFileSystemService));
		const dardcorModels = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(ICopilotCLIModels));
		const dardcorCLIFolderMruService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatFolderMruService));
		const pullRequestCreationService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IPullRequestCreationService));
		const sessionMetadata = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionMetadataStore));

		this._register(dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(ICopilotCLISessionTracker)));
		this._register(dardcorcliAgentInstaService.createInstance(CopilotCLIContrib));

		dardcorModels.registerLanguageModelChatProvider(vscode.lm);

		const dardcorcliParticipant = vscode.chat.createChatParticipant(this.dardcorcliSessionType, dardcorcliChatSessionParticipant.createHandler());
		this._register(vscode.chat.registerChatSessionContentProvider(this.dardcorcliSessionType, dardcorcliChatSessionContentProvider, dardcorcliParticipant));
		const dardcorcliCustomizationProvider = this._register(dardcorcliAgentInstaService.createInstance(CopilotCLICustomizationProvider));
		this._register(vscode.chat.registerChatSessionCustomizationProvider(this.dardcorcliSessionType, CopilotCLICustomizationProvider.metadata, dardcorcliCustomizationProvider));
		this._register(registerCLIChatCommands(dardcorCLISessionService, dardcorCLIWorktreeManagerService, dardcorCLIWorktreeCheckpointService, gitService, gitCommitMessageService, dardcorCLIWorkspaceFolderSessions, dardcorcliChatSessionContentProvider, folderRepositoryManager, dardcorCLIFolderMruService, nativeEnvService, fileSystemService, sessionTracker, terminalIntegration, pullRequestCreationService, sessionMetadata, logService));
		// #endregion

		return { sessionMetadata };
	}

	private registerCopilotCLIServicesV1(instantiationService: IInstantiationService, delegationSummary: IChatDelegationSummaryService, logService: ILogService) {
		const cloudSessionProvider = this.registerCopilotCloudAgent();
		const dardcorcliAgentInstaService = instantiationService.createChild(
			new ServiceCollection(
				[IAgentSessionsWorkspace, new SyncDescriptor(AgentSessionsWorkspace)],
				[ICopilotCLIImageSupport, new SyncDescriptor(CopilotCLIImageSupport)],
				[ICopilotCLISessionService, new SyncDescriptor(CopilotCLISessionService)],
				[IChatDelegationSummaryService, delegationSummary],
				[ICopilotCLIModels, new SyncDescriptor(CopilotCLIModels)],
				[ICopilotCLISDK, new SyncDescriptor(CopilotCLISDK)],
				[ICopilotCLIAgents, new SyncDescriptor(CopilotCLIAgents)],
				[ILanguageModelServer, new SyncDescriptor(LanguageModelServer)],
				[ICopilotCLITerminalIntegration, new SyncDescriptor(CopilotCLITerminalIntegration)],
				[IChatSessionWorktreeService, new SyncDescriptor(ChatSessionWorktreeService)],
				[IChatSessionWorktreeCheckpointService, new SyncDescriptor(ChatSessionWorktreeCheckpointService)],
				[IChatSessionWorkspaceFolderService, new SyncDescriptor(ChatSessionWorkspaceFolderService)],
				[ICopilotCLIMCPHandler, new SyncDescriptor(CopilotCLIMCPHandler)],
				[IFolderRepositoryManager, new SyncDescriptor(CopilotCLIFolderRepositoryManager)],
				[IUserQuestionHandler, new SyncDescriptor(UserQuestionHandler)],
				[ICustomSessionTitleService, new SyncDescriptor(CustomSessionTitleService)],
				[ICopilotCLISkills, new SyncDescriptor(CopilotCLISkills)],
				[IChatSessionMetadataStore, new SyncDescriptor(ChatSessionMetadataStore)],
				[IChatFolderMruService, new SyncDescriptor(CopilotCLIFolderMruService)],
				[IPullRequestCreationService, new SyncDescriptor(PullRequestCreationService)],
				...getServices()
			));

		const dardcorcliSessionItemProvider = this._register(dardcorcliAgentInstaService.createInstance(CopilotCLIChatSessionItemProviderV1));
		const providerRegistration = vscode.chat.registerChatSessionItemProvider(this.dardcorcliSessionType, dardcorcliSessionItemProvider);
		this._register(providerRegistration);
		this._register(dardcorcliAgentInstaService.createInstance(ChatSessionRepositoryTracker, dardcorcliSessionItemProvider));
		const dardcorcliChatSessionContentProvider = dardcorcliAgentInstaService.createInstance(CopilotCLIChatSessionContentProviderV1, dardcorcliSessionItemProvider);
		const promptResolver = dardcorcliAgentInstaService.createInstance(CopilotCLIPromptResolver);
		const gitService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IGitService));
		const gitCommitMessageService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IGitCommitMessageService));
		const gitExtensionService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IGitExtensionService));
		const toolsService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IToolsService));
		const aiGeneratedBranchNamesV1 = instantiationService.invokeFunction(accessor =>
			accessor.get(IConfigurationService).getConfig(ConfigKey.Advanced.CLIAIGenerateBranchNames)
		);
		const branchNameGeneratorV1 = aiGeneratedBranchNamesV1 ? dardcorcliAgentInstaService.createInstance(GitBranchNameGenerator) : undefined;

		const dardcorcliChatSessionParticipant = this._register(dardcorcliAgentInstaService.createInstance(
			CopilotCLIChatSessionParticipantV1,
			dardcorcliChatSessionContentProvider,
			promptResolver,
			dardcorcliSessionItemProvider,
			cloudSessionProvider,
			branchNameGeneratorV1,
		));
		const dardcorCLISessionService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(ICopilotCLISessionService));
		const dardcorCLIWorktreeManagerService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorktreeService));
		const dardcorCLIWorktreeCheckpointService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorktreeCheckpointService));
		const dardcorCLIWorkspaceFolderSessions = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorkspaceFolderService));
		const dardcorCLIMetadataStore = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionMetadataStore));

		// Handle worktree cleanup/recreation when archive state changes
		const onDidChangeChatSessionItemState = (providerRegistration as { onDidChangeChatSessionItemState?: vscode.Event<vscode.ChatSessionItem> }).onDidChangeChatSessionItemState;
		if (onDidChangeChatSessionItemState) {
			this._register(onDidChangeChatSessionItemState(async (item) => {
				const sessionId = SessionIdForCLI.parse(item.resource);
				// Persist archived state first so worktree-sharing checks (delete/archive)
				// can ignore archived siblings — their worktrees are reconstructed on
				// un-archive via `recreateWorktreeOnUnarchive`.
				try {
					await dardcorCLIMetadataStore.setSessionArchived(sessionId, !!item.archived);
				} catch (error) {
					logService.error(`[CopilotCLI] Failed to persist archived state for session ${sessionId}:`, error);
				}
				if (item.archived) {
					// Skip worktree cleanup if other live sessions still depend on this worktree.
					const worktreePath = await dardcorCLIWorktreeManagerService.getWorktreePath(sessionId);
					if (worktreePath) {
						const siblings = await getBlockingSiblingSessionsForFolder(worktreePath, sessionId, dardcorCLIMetadataStore, dardcorCLIWorkspaceFolderSessions);
						if (siblings.length > 0) {
							logService.trace(`[CopilotCLI] Skipping worktree cleanup for archived session ${sessionId}: ${siblings.length} other session(s) still use the worktree`);
							return;
						}
					}
					try {
						const result = await dardcorCLIWorktreeManagerService.cleanupWorktreeOnArchive(sessionId);
						logService.trace(`[CopilotCLI] Worktree cleanup for session ${sessionId}: ${result.cleaned ? 'cleaned' : result.reason}`);
					} catch (error) {
						logService.error(`[CopilotCLI] Failed to cleanup worktree for archived session ${sessionId}:`, error);
					}
				} else {
					try {
						const result = await dardcorCLIWorktreeManagerService.recreateWorktreeOnUnarchive(sessionId);
						logService.trace(`[CopilotCLI] Worktree recreation for session ${sessionId}: ${result.recreated ? 'recreated' : result.reason}`);
						if (result.recreated) {
							dardcorcliSessionItemProvider.refreshSession({ reason: 'update', sessionId });
						}
					} catch (error) {
						logService.error(`[CopilotCLI] Failed to recreate worktree for unarchived session ${sessionId}:`, error);
					}
				}
			}));
		}

		const folderRepositoryManager = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IFolderRepositoryManager));
		const nativeEnvService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(INativeEnvService));
		const fileSystemService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IFileSystemService));
		const dardcorModels = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(ICopilotCLIModels));
		const dardcorFolderMruService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatFolderMruService));
		const pullRequestCreationService = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IPullRequestCreationService));

		this._register(dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(ICopilotCLISessionTracker)));
		this._register(dardcorcliAgentInstaService.createInstance(CopilotCLIContrib));

		dardcorModels.registerLanguageModelChatProvider(vscode.lm);

		const dardcorcliParticipant = vscode.chat.createChatParticipant(this.dardcorcliSessionType, dardcorcliChatSessionParticipant.createHandler());
		this._register(vscode.chat.registerChatSessionContentProvider(this.dardcorcliSessionType, dardcorcliChatSessionContentProvider, dardcorcliParticipant));
		const dardcorcliCustomizationProvider = this._register(dardcorcliAgentInstaService.createInstance(CopilotCLICustomizationProvider));
		this._register(vscode.chat.registerChatSessionCustomizationProvider(this.dardcorcliSessionType, CopilotCLICustomizationProvider.metadata, dardcorcliCustomizationProvider));
		this._register(registerCLIChatCommandsV1(dardcorcliSessionItemProvider, dardcorCLISessionService, dardcorCLIWorktreeManagerService, dardcorCLIWorktreeCheckpointService, gitService, gitCommitMessageService, gitExtensionService, toolsService, dardcorCLIWorkspaceFolderSessions, dardcorcliChatSessionContentProvider, folderRepositoryManager, dardcorFolderMruService, nativeEnvService, fileSystemService, pullRequestCreationService, dardcorCLIMetadataStore, logService));
		// #endregion

		const sessionMetadata = dardcorcliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionMetadataStore));
		return { sessionMetadata };
	}

	private registerCopilotCloudAgent() {
		if (!this.dardcorAgentInstaService) {
			return;
		}
		if (this.dardcorCloudRegistrations) {
			this.dardcorCloudRegistrations.dispose();
			this.dardcorCloudRegistrations = undefined;
		}
		this.dardcorCloudRegistrations = new DisposableStore();
		this.dardcorCloudRegistrations.add(
			this.dardcorAgentInstaService.createInstance(PRContentProvider)
		);
		const cloudSessionsProvider = this.dardcorCloudRegistrations.add(
			this.dardcorAgentInstaService.createInstance(CopilotCloudSessionsProvider)
		);
		this.dardcorCloudRegistrations.add(
			vscode.chat.registerChatSessionItemProvider(CopilotCloudSessionsProvider.TYPE, cloudSessionsProvider)
		);
		this.dardcorCloudRegistrations.add(
			vscode.chat.registerChatSessionContentProvider(
				CopilotCloudSessionsProvider.TYPE,
				cloudSessionsProvider,
				cloudSessionsProvider.chatParticipant,
				{ supportsInterruptions: true }
			)
		);
		this.dardcorCloudRegistrations.add(
			vscode.commands.registerCommand('github.dardcor.cloud.resetWorkspaceConfirmations', () => {
				cloudSessionsProvider.resetWorkspaceContext();
			})
		);
		this.dardcorCloudRegistrations.add(
			vscode.commands.registerCommand('github.dardcor.cloud.sessions.openInBrowser', async (chatSessionItem: vscode.ChatSessionItem) => {
				cloudSessionsProvider.openSessionInBrowser(chatSessionItem);
			})
		);
		this.dardcorCloudRegistrations.add(
			vscode.commands.registerCommand(CLOSE_SESSION_PR_CMD, async (ctx: CrossChatSessionWithPR) => {
				try {
					const success = await this.octoKitService.closePullRequest(
						ctx.pullRequestDetails.repository.owner.login,
						ctx.pullRequestDetails.repository.name,
						ctx.pullRequestDetails.number,
						{ createIfNone: { detail: l10n.t('Sign in to GitHub to access Copilot cloud sessions.') } });
					if (!success) {
						this.logService.error(`${CLOSE_SESSION_PR_CMD}: Failed to close PR #${ctx.pullRequestDetails.number}`);
					}
					cloudSessionsProvider.refresh();
				} catch (e) {
					this.logService.error(`${CLOSE_SESSION_PR_CMD}: Exception ${e}`);
				}
			})
		);
		this.dardcorCloudRegistrations.add(
			vscode.commands.registerCommand('github.dardcor.cloud.sessions.installPRExtension', async () => {
				await this.installPullRequestExtension();
			})
		);
		return cloudSessionsProvider;
	}

	private isPullRequestExtensionInstalled(): boolean {
		return vscode.extensions.getExtension(GHPR_EXTENSION_ID) !== undefined;
	}

	private async installPullRequestExtension(): Promise<void> {
		if (this.isPullRequestExtensionInstalled()) {
			return;
		}
		try {
			const isInsiders = this.envService.getEditorInfo().version.includes('insider');
			const installOptions = { enable: true, installPreReleaseVersion: isInsiders, justification: vscode.l10n.t('Enable additional pull request features, such as checking out and applying changes.') };
			await vscode.commands.executeCommand('workbench.extensions.installExtension', GHPR_EXTENSION_ID, installOptions);
			const maxWaitTime = 10_000; // 10 seconds
			const pollInterval = 100; // 100ms
			let elapsed = 0;
			while (elapsed < maxWaitTime) {
				if (this.isPullRequestExtensionInstalled()) {
					vscode.window.showInformationMessage(vscode.l10n.t('GitHub Pull Request extension installed successfully.'));
					break;
				}
				await new Promise(resolve => setTimeout(resolve, pollInterval));
				elapsed += pollInterval;
			}
			if (!this.isPullRequestExtensionInstalled()) {
				vscode.window.showWarningMessage(vscode.l10n.t('GitHub Pull Request extension is taking longer than expected to install.'));
			}
			await vscode.commands.executeCommand('setContext', prExtensionInstalledContextKey, true);
		} catch (error) {
			vscode.window.showErrorMessage(vscode.l10n.t('Failed to install GitHub Pull Request extension: {0}', error instanceof Error ? error.message : String(error)));
		}
	}
}
