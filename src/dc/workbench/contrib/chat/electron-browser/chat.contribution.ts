/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { resolve } from '../../../../base/common/path.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { ipcRenderer } from '../../../../base/parts/sandbox/electron-browser/globals.js';
import { localize } from '../../../../nls.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ILocalGitService } from '../../../../platform/git/common/localGitService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { registerSharedProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService, ShutdownReason } from '../../../services/lifecycle/common/lifecycle.js';
import { ACTION_ID_NEW_CHAT, CHAT_OPEN_ACTION_ID, IChatViewOpenOptions } from '../browser/actions/chatActions.js';
import './codexCustomizationSettings.contribution.js';
import { ChatViewPaneTarget, IChatWidgetService } from '../browser/chat.js';
import { ChatContextKeys } from '../common/actions/chatContextKeys.js';
import { IChatService } from '../common/chatService/chatService.js';
import { ChatModeKind } from '../common/constants.js';
import { IPluginGitService } from '../common/plugins/pluginGitService.js';
import { registerChatDeveloperActions } from './actions/chatDeveloperActions.js';
import { registerChatExportZipAction } from './actions/chatExportZip.js';
import { registerExportAgentTracesDbAction } from './actions/exportAgentTracesDb.js';
import { registerInstallDictationModelAction } from './actions/installDictationModelAction.js';
import { confirmSessionShutdown, getEffectiveSessionShutdownReason, shouldWarnForInFlightSessionShutdown } from './chatLifecycle.js';
import { HoldToVoiceChatInChatViewAction, InlineVoiceChatAction, KeywordActivationContribution, QuickVoiceChatAction, ReadChatResponseAloud, StartVoiceChatAction, StopListeningAction, StopListeningAndSubmitAction, StopReadAloud, StopReadChatItemAloud, VoiceChatInChatViewAction } from './actions/voiceChatActions.js';
import { NativeBuiltinToolsContribution } from './builtInTools/tools.js';
import { NativePluginGitCommandService } from './pluginGitCommandService.js';

registerSingleton(IPluginGitService, NativePluginGitCommandService, InstantiationType.Delayed);
registerSharedProcessRemoteService(ILocalGitService, 'localGit');

class ChatCommandLineHandler extends Disposable {

	static readonly ID = 'workbench.contrib.chatCommandLineHandler';

	constructor(
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkspaceTrustRequestService private readonly workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@ILogService private readonly logService: ILogService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners() {
		const handleChatRequest = (_: unknown, ...args: unknown[]) => {
			const chatArgs = args[0] as typeof this.environmentService.args.chat;
			this.logService.trace('vscode:handleChatRequest', chatArgs);

			this.prompt(chatArgs).catch(err => this.logService.error('vscode:handleChatRequest failed', err));
		};
		ipcRenderer.on('vscode:handleChatRequest', handleChatRequest);
		this._register({ dispose: () => ipcRenderer.removeListener('vscode:handleChatRequest', handleChatRequest) });

		const handleOpenChatSession = (_: unknown, ...args: unknown[]) => {
			const sessionUriString = args[0] as string;
			this.logService.trace('vscode:openChatSession', sessionUriString);

			const sessionResource = URI.parse(sessionUriString);
			Promise.resolve(this.chatWidgetService.openSession(sessionResource, ChatViewPaneTarget))
				.catch(err => this.logService.error('vscode:openChatSession failed', err));
		};
		ipcRenderer.on('vscode:openChatSession', handleOpenChatSession);
		this._register({ dispose: () => ipcRenderer.removeListener('vscode:openChatSession', handleOpenChatSession) });
	}

	private async prompt(args: typeof this.environmentService.args.chat): Promise<void> {
		if (!Array.isArray(args?._)) {
			return;
		}

		const trusted = await this.workspaceTrustRequestService.requestWorkspaceTrust({
			message: localize('copilotWorkspaceTrust', "AI features are currently only supported in trusted workspaces.")
		});

		if (!trusted) {
			return;
		}

		const opts: IChatViewOpenOptions = {
			query: args._.length > 0 ? args._.join(' ') : '',
			mode: args.mode ?? ChatModeKind.Agent,
			attachFiles: args['add-file']?.map(file => URI.file(resolve(file))),
		};

		if (args.maximize) {
			const location = this.contextKeyService.getContextKeyValue<ViewContainerLocation>(ChatContextKeys.panelLocation.key);
			if (location === ViewContainerLocation.AuxiliaryBar) {
				this.layoutService.setAuxiliaryBarMaximized(true);
			} else if (location === ViewContainerLocation.Panel && !this.layoutService.isPanelMaximized()) {
				this.layoutService.toggleMaximizedPanel();
			}
		}

		await this.commandService.executeCommand(ACTION_ID_NEW_CHAT);
		await this.commandService.executeCommand(CHAT_OPEN_ACTION_ID, opts);
	}
}

class ChatSuspendThrottlingHandler extends Disposable {

	static readonly ID = 'workbench.contrib.chatSuspendThrottlingHandler';

	constructor(
		@INativeHostService nativeHostService: INativeHostService,
		@IChatService chatService: IChatService,
	) {
		super();

		this._register(autorun(reader => {
			const running = chatService.requestInProgressObs.read(reader);

			nativeHostService.setBackgroundThrottling(!running);
		}));
	}
}

class ChatLifecycleHandler extends Disposable {

	static readonly ID = 'workbench.contrib.chatLifecycleHandler';

	constructor(
		@ILifecycleService lifecycleService: ILifecycleService,
		@IDialogService private readonly dialogService: IDialogService,
		@IChatWidgetService private readonly widgetService: IChatWidgetService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IExtensionService extensionService: IExtensionService,
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IChatService private readonly chatService: IChatService,
	) {
		super();

		this._register(lifecycleService.onBeforeShutdown(e => {
			e.veto(this.shouldVetoShutdown(e.reason), 'veto.chat');
		}));

		this._register(extensionService.onWillStop(e => {
			e.veto(this.hasSessionThatWillStop(ShutdownReason.CLOSE), localize('chatRequestInProgress', "A session is in progress."));
		}));
	}

	private hasSessionThatWillStop(reason: ShutdownReason): boolean {
		if (this.chatEntitlementService.sentiment.hidden) {
			return false;
		}

		if (shouldWarnForInFlightSessionShutdown(this.chatService.getPendingRequestSessionTypes(), reason)) {
			return true;
		}

		return false;
	}

	private async shouldVetoShutdown(reason: ShutdownReason): Promise<boolean> {
		if (this.environmentService.enableSmokeTestDriver) {
			return false;
		}

		const windowCount = reason === ShutdownReason.CLOSE ? await this.nativeHostService.getWindowCount() : 0;
		const effectiveReason = getEffectiveSessionShutdownReason(reason, windowCount, isMacintosh);
		if (!this.hasSessionThatWillStop(effectiveReason)) {
			return false;
		}

		if (ChatContextKeys.skipChatRequestInProgressMessage.getValue(this.contextKeyService) === true) {
			return false;
		}

		this.widgetService.revealWidget();
		return !await confirmSessionShutdown(this.dialogService, effectiveReason);
	}
}

registerAction2(StartVoiceChatAction);

registerAction2(VoiceChatInChatViewAction);
registerAction2(HoldToVoiceChatInChatViewAction);
registerAction2(QuickVoiceChatAction);
registerAction2(InlineVoiceChatAction);

registerAction2(StopListeningAction);
registerAction2(StopListeningAndSubmitAction);

registerAction2(ReadChatResponseAloud);
registerAction2(StopReadChatItemAloud);
registerAction2(StopReadAloud);

registerChatDeveloperActions();
registerChatExportZipAction();
registerExportAgentTracesDbAction();
registerInstallDictationModelAction();

registerWorkbenchContribution2(KeywordActivationContribution.ID, KeywordActivationContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(NativeBuiltinToolsContribution.ID, NativeBuiltinToolsContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChatCommandLineHandler.ID, ChatCommandLineHandler, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ChatSuspendThrottlingHandler.ID, ChatSuspendThrottlingHandler, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ChatLifecycleHandler.ID, ChatLifecycleHandler, WorkbenchPhase.AfterRestored);


