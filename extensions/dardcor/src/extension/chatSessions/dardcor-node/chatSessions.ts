/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IExtensionContribution } from '../../common/contributions';
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
import { ChatSessionMetadataStore } from './chatSessionMetadataStoreImpl';
import { AgentSessionsWorkspace } from './agentSessionsWorkspace';
import { ChatSessionWorkspaceFolderService } from './chatSessionWorkspaceFolderServiceImpl';
import { ClaudeWorkspaceFolderService } from './claudeWorkspaceFolderServiceImpl';
import { ChatSessionWorktreeCheckpointService } from './chatSessionWorktreeCheckpointServiceImpl';
import { ChatSessionWorktreeService } from './chatSessionWorktreeServiceImpl';
import { ClaudeChatSessionContentProvider } from './claudeChatSessionContentProvider';
import { ClaudeCustomizationProvider } from './claudeCustomizationProvider';
import { ClaudeFolderRepositoryManager } from './folderRepositoryManagerImpl';
import { LanguageModelServer, ILanguageModelServer } from '../../agents/node/langModelServer';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { SyncDescriptor } from '../../../util/dardcor/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ServiceCollection } from '../../../util/dardcor/platform/instantiation/common/serviceCollection';

export class ChatSessionsContrib extends Disposable implements IExtensionContribution {
	readonly id = 'chatSessions';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

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
				[IChatSessionMetadataStore, new SyncDescriptor(ChatSessionMetadataStore)],
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
	}
}
