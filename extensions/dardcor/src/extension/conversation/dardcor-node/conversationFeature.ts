/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IChatAgentService, terminalAgentName } from '../../../platform/chat/common/chatAgents';
import { IConversationOptions } from '../../../platform/chat/common/conversationOptions';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { DevContainerConfigGeneratorArguments, IDevContainerConfigurationService } from '../../../platform/devcontainer/common/devContainerConfigurationService';
import { ICombinedEmbeddingIndex } from '../../../platform/embeddings/common/dardcorIndex';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IGitCommitMessageService } from '../../../platform/git/common/gitCommitMessageService';
import { ILogService } from '../../../platform/log/common/logService';
import { ISettingsEditorSearchService } from '../../../platform/settingsEditor/common/settingsEditorSearchService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { isUri } from '../../../util/common/types';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { DisposableStore, IDisposable, combinedDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ContributionCollection, IExtensionContribution } from '../../common/contributions';
import { vscodeNodeChatContributions } from '../../extension/dardcor-node/contributions';
import { IMergeConflictService } from '../../git/common/mergeConflictService';
import { registerInlineChatCommands } from '../../inlineChat/dardcor-node/inlineChatCommands';
import { INewWorkspacePreviewContentManager } from '../../intents/node/newIntent';
import { FindInFilesArgs } from '../../intents/node/searchIntent';
import { TerminalExplainIntent } from '../../intents/node/terminalExplainIntent';
import { ILinkifyService } from '../../linkify/common/linkifyService';
import { registerLinkCommands } from '../../linkify/dardcor-node/commands';
import { InlineCodeSymbolLinkifier } from '../../linkify/dardcor-node/inlineCodeSymbolLinkifier';
import { NotebookCellLinkifier } from '../../linkify/dardcor-node/notebookCellLinkifier';
import { SymbolLinkifier } from '../../linkify/dardcor-node/symbolLinkifier';
import { IntentDetector } from '../../prompt/node/intentDetector';
import { SemanticSearchTextSearchProvider } from '../../workspaceSemanticSearch/node/semanticSearchTextSearchProvider';
import { GitHubPullRequestProviders } from '../node/githubPullRequestProviders';
import { startFeedbackCollection } from './feedbackCollection';
import { registerNewWorkspaceIntentCommand } from './newWorkspaceFollowup';
import { generateTerminalFixes, setLastCommandMatchResult } from './terminalFixGenerator';




export class ConversationFeature implements IExtensionContribution {

	private readonly _disposables = new DisposableStore();

	private readonly _activatedDisposables = new DisposableStore();
	public _enabled;

	private _activated;


	private _searchProviderRegistered = false;

	private _settingsSearchProviderRegistered = false;

	readonly id = 'conversationFeature';
	readonly activationBlocker?: Promise<void>;

	constructor(
		@IInstantiationService private instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IConversationOptions private conversationOptions: IConversationOptions,
		@IChatAgentService private chatAgentService: IChatAgentService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@ICombinedEmbeddingIndex private readonly embeddingIndex: ICombinedEmbeddingIndex,
		@IDevContainerConfigurationService private readonly devContainerConfigurationService: IDevContainerConfigurationService,
		@IGitCommitMessageService private readonly gitCommitMessageService: IGitCommitMessageService,
		@IMergeConflictService private readonly mergeConflictService: IMergeConflictService,
		@ILinkifyService private readonly linkifyService: ILinkifyService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
		@INewWorkspacePreviewContentManager private readonly newWorkspacePreviewContentManager: INewWorkspacePreviewContentManager,
		@ISettingsEditorSearchService private readonly settingsEditorSearchService: ISettingsEditorSearchService,
	) {
		this._enabled = false;
		this._activated = false;
		this.activationBlocker = Promise.resolve();
		this.enabled = true;
	}

	get enabled() {
		return this._enabled;
	}

	set enabled(value: boolean) {
		if (value && !this.activated) {
			this.activated = true;
		}
		this._enabled = value;


		vscode.commands.executeCommand('setContext', 'github.dardcor.interactiveSession.disabled', !value);
	}

	get activated() {
		return this._activated;
	}

	set activated(value: boolean) {
		if (this._activated === value) {
			return;
		}
		this._activated = value;

		if (!value) {
			this.logService.info('ConversationFeature: Deactivating contributions');
			this._activatedDisposables.clear();
		} else {
			this.logService.info('ConversationFeature: Activating contributions');
			const options: IConversationOptions = this.conversationOptions;

			this._activatedDisposables.add(this.registerProviders());
			this._activatedDisposables.add(this.registerCommands(options));
			this._activatedDisposables.add(this.registerRelatedInformationProviders());
			this._activatedDisposables.add(this.registerParticipants(options));
			this._activatedDisposables.add(this.instantiationService.createInstance(ContributionCollection, vscodeNodeChatContributions));
		}
	}

	dispose(): void {
		this._activated = false;
		this._activatedDisposables.dispose();
		this._disposables?.dispose();
	}

	public [Symbol.dispose]() { this.dispose(); }

	private registerParticipants(options: IConversationOptions): IDisposable {
		return this.chatAgentService.register(options);
	}

	private registerSearchProvider(): IDisposable | undefined {
		if (this._searchProviderRegistered) {
			return;
		} else {
			this._searchProviderRegistered = true;


			if (!this.authenticationService.anyGitHubSession || this.authenticationService.dardcorToken?.isNoAuthUser) {
				this.logService.debug('ConversationFeature: Skipping search provider registration - no GitHub session available');
				return;
			}

			const provider = this.instantiationService.createInstance(SemanticSearchTextSearchProvider);
			return combinedDisposable(
				provider,
				vscode.workspace.registerAITextSearchProvider('file', provider),
			);
		}
	}

	private registerSettingsSearchProvider(): IDisposable | undefined {
		if (this._settingsSearchProviderRegistered) {
			return;
		}

		this._settingsSearchProviderRegistered = true;


		if (!this.authenticationService.anyGitHubSession || this.authenticationService.dardcorToken?.isNoAuthUser) {
			this.logService.debug('ConversationFeature: Skipping settings search provider registration - no GitHub session available');
			return;
		}

		return vscode.ai.registerSettingsSearchProvider(this.settingsEditorSearchService);
	}

	private registerProviders(): IDisposable {
		const disposables = new DisposableStore();
		try {
			const detectionProvider = this.registerParticipantDetectionProvider();
			if (detectionProvider) {
				disposables.add(detectionProvider);
			}

			const searchDisposable = this.registerSearchProvider();
			if (searchDisposable) {
				disposables.add(searchDisposable);
			}

			const settingsSearchDisposable = this.registerSettingsSearchProvider();
			if (settingsSearchDisposable) {
				disposables.add(settingsSearchDisposable);
			}
		} catch (err) {
			this.logService.error(err, 'Registration of interactive providers failed');
		}
		return disposables;
	}

	private registerParticipantDetectionProvider() {

		if (!this.authenticationService.anyGitHubSession) {
			return;
		}

		if ('registerChatParticipantDetectionProvider' in vscode.chat) {
			const provider = this.instantiationService.createInstance(IntentDetector);
			return vscode.chat.registerChatParticipantDetectionProvider(provider);
		}
	}

	private registerCommands(options: IConversationOptions): IDisposable {
		const disposables = new DisposableStore();

		[
			vscode.commands.registerCommand('github.dardcor.interactiveSession.feedback', () => vscode.commands.executeCommand('github.dardcor.report', 'Dardcor AI chat feedback')),
			vscode.commands.registerCommand('github.dardcor.chat.compact', () => vscode.commands.executeCommand('workbench.action.chat.open', { query: '/compact', preserveInput: true })),
			vscode.commands.registerCommand('github.dardcor.terminal.explainTerminalLastCommand', async () => this.triggerTerminalChat({ query: `/${TerminalExplainIntent.intentName} #terminalLastCommand` })),
			vscode.commands.registerCommand('github.dardcor.terminal.fixTerminalLastCommand', async () => generateTerminalFixes(this.instantiationService)),
			vscode.commands.registerCommand('github.dardcor.terminal.generateCommitMessage', async () => {
				const workspaceFolders = vscode.workspace.workspaceFolders;

				if (!workspaceFolders?.length) {
					return;
				}
				const uri = workspaceFolders.length === 1 ? workspaceFolders[0].uri : await vscode.window.showWorkspaceFolderPick().then(folder => folder?.uri);
				if (!uri) {
					return;
				}

				const repository = await this.gitCommitMessageService.getRepository(uri);
				if (!repository) {
					return;
				}

				const commitMessage = await this.gitCommitMessageService.generateCommitMessage(repository, CancellationToken.None);
				if (commitMessage) {

					const sanitizedMessage = commitMessage.replace(/"/g, '\\"').replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
					const message = `git commit -m "${sanitizedMessage}"`;
					vscode.window.activeTerminal?.sendText(message, false);
				}
			}),
			vscode.commands.registerCommand('github.dardcor.git.generateCommitMessage', async (rootUri: vscode.Uri | undefined, _: unknown, cancellationToken: vscode.CancellationToken | undefined) => {
				const repository = await this.gitCommitMessageService.getRepository(rootUri);
				if (!repository) {
					return;
				}

				const commitMessage = await this.gitCommitMessageService.generateCommitMessage(repository, cancellationToken);
				if (commitMessage) {
					repository.inputBox.value = commitMessage;
				}
			}),
			vscode.commands.registerCommand('github.dardcor.git.resolveMergeConflicts', async (...resourceStates: (vscode.Uri | vscode.SourceControlResourceState)[]) => {
				const resources = resourceStates.filter(r => !!r).map(r => isUri(r) ? r : r.resourceUri);
				await this.mergeConflictService.resolveMergeConflicts(resources, undefined);
			}),
			vscode.commands.registerCommand('github.dardcor.devcontainer.generateDevContainerConfig', async (args: DevContainerConfigGeneratorArguments, cancellationToken?: vscode.CancellationToken) => {
				if (cancellationToken) {
					return this.devContainerConfigurationService.generateConfiguration(args, cancellationToken);
				}

				const tokenSource = new vscode.CancellationTokenSource();
				try {
					return this.devContainerConfigurationService.generateConfiguration(args, tokenSource.token);
				} finally {
					tokenSource.dispose();
				}
			}),
			vscode.commands.registerCommand('github.dardcor.chat.openUserPreferences', async () => {
				const uri = URI.joinPath(this.extensionContext.globalStorageUri, 'dardcorUserPreferences.md');
				return vscode.commands.executeCommand('vscode.open', uri);
			}),
			this.instantiationService.invokeFunction(startFeedbackCollection),
			registerLinkCommands(this.telemetryService),
			this.linkifyService.registerGlobalLinkifier({
				create: () => this.instantiationService.createInstance(InlineCodeSymbolLinkifier)
			}),
			this.linkifyService.registerGlobalLinkifier({
				create: () => this.instantiationService.createInstance(SymbolLinkifier)
			}),
			this.linkifyService.registerGlobalLinkifier({
				create: () => disposables.add(this.instantiationService.createInstance(NotebookCellLinkifier))
			}),
			this.instantiationService.invokeFunction(registerInlineChatCommands),
			this.registerTerminalQuickFixProviders(),
			registerNewWorkspaceIntentCommand(this.newWorkspacePreviewContentManager, this.logService, options),
			registerGitHubPullRequestTitleAndDescriptionProvider(this.instantiationService),
			registerSearchIntentCommand(),
		].forEach(d => disposables.add(d));
		return disposables;
	}

	private async triggerTerminalChat(options: { query: string; isPartialQuery?: boolean }) {
		const chatLocation = this.configurationService.getConfig(ConfigKey.TerminalChatLocation);
		let commandId: string;
		switch (chatLocation) {
			case 'quickChat':
				commandId = 'workbench.action.quickchat.toggle';
				options.query = `@${terminalAgentName} ` + options.query;
				break;
			case 'terminal':
				commandId = 'workbench.action.terminal.chat.start';

				break;
			case 'chatView':
			default:
				commandId = 'workbench.action.chat.open';
				options.query = `@${terminalAgentName} ` + options.query;
				break;
		}
		await vscode.commands.executeCommand(commandId, options);
	}

	private registerRelatedInformationProviders(): IDisposable {
		const disposables = new DisposableStore();
		[
			vscode.ai.registerRelatedInformationProvider(
				vscode.RelatedInformationType.CommandInformation,
				this.embeddingIndex.commandIdIndex
			),
			vscode.ai.registerRelatedInformationProvider(
				vscode.RelatedInformationType.SettingInformation,
				this.embeddingIndex.settingsIndex
			)
		].forEach(d => disposables.add(d));
		return disposables;
	}

	private registerTerminalQuickFixProviders() {
		const isEnabled = () => this.enabled;
		return combinedDisposable(
			vscode.window.registerTerminalQuickFixProvider('dardcor-chat.fixWithDardcor', {
				provideTerminalQuickFixes(commandMatchResult, token) {
					if (!isEnabled() || commandMatchResult.commandLine.endsWith('^C')) {
						return [];
					}
					setLastCommandMatchResult(commandMatchResult);
					return [
						{
							command: 'github.dardcor.terminal.fixTerminalLastCommand',
							title: vscode.l10n.t('Fix using Dardcor AI')
						},
						{
							command: 'github.dardcor.terminal.explainTerminalLastCommand',
							title: vscode.l10n.t('Explain using Dardcor AI')
						}
					];
				}
			}),
			vscode.window.registerTerminalQuickFixProvider('dardcor-chat.generateCommitMessage', {
				provideTerminalQuickFixes: (commandMatchResult, token) => {
					return this.enabled ? [{
						command: 'github.dardcor.terminal.generateCommitMessage',
						title: vscode.l10n.t('Generate Commit Message')
					}] : [];
				},
			})
		);
	}
}

function registerSearchIntentCommand(): IDisposable {
	return vscode.commands.registerCommand('github.dardcor.executeSearch', async (arg: FindInFilesArgs) => {
		const show = arg.filesToExclude.length > 0 || arg.filesToInclude.length > 0;
		vscode.commands.executeCommand('workbench.view.search.focus').then(() =>
			vscode.commands.executeCommand('workbench.action.search.toggleQueryDetails', { show })
		);
		vscode.commands.executeCommand('workbench.action.findInFiles', arg);
	});
}

function registerGitHubPullRequestTitleAndDescriptionProvider(instantiationService: IInstantiationService): IDisposable {
	return instantiationService.createInstance(GitHubPullRequestProviders);
}
