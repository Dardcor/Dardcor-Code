/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, dispose, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isNative } from '../../../../base/common/platform.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget, IConfigurationChangeEvent, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IUserDataSyncEnablementService, IUserDataSyncService, SyncStatus } from '../../../../platform/userDataSync/common/userDataSync.js';
import { IWindowsConfiguration, IWindowSettings, MenuSettings, MenuStyleConfiguration, TitleBarSetting, TitlebarStyle } from '../../../../platform/window/common/window.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IUserDataSyncWorkbenchService } from '../../../services/userDataSync/common/userDataSync.js';

interface IConfiguration extends IWindowsConfiguration {
	debug?: { console?: { wordWrap?: boolean } };
	editor?: { accessibilitySupport?: 'on' | 'off' | 'auto' };
	security?: { workspace?: { trust?: { enabled?: boolean } }; restrictUNCAccess?: boolean };
	window: IWindowSettings;
	workbench?: { enableExperiments?: boolean };
	telemetry?: { feedback?: { enabled?: boolean } };
	chat?: {
		extensionUnification?: { enabled?: boolean };
		agentHost?: {
			enabled?: boolean;
			claudeAgent?: { enabled?: boolean };
			codexAgent?: { enabled?: boolean };
			byokModels?: { enabled?: boolean };
			otel?: {
				enabled?: boolean;
				exporterType?: string;
				otlpEndpoint?: string;
				captureContent?: boolean;
				outfile?: string;
				dbSpanExporter?: { enabled?: boolean };
			};
		};
		editor?: { codex?: { preferAgentHost?: boolean } };
	};
	_extensionsGallery?: { enablePPE?: boolean };
	accessibility?: { verbosity?: { debug?: boolean } };
}

export class SettingsChangeRelauncher extends Disposable implements IWorkbenchContribution {

	private static SETTINGS = [
		TitleBarSetting.TITLE_BAR_STYLE,
		MenuSettings.MenuStyle,
		'window.nativeTabs',
		'window.nativeFullScreen',
		'window.clickThroughInactive',
		'window.controlsStyle',
		'editor.accessibilitySupport',
		'security.workspace.trust.enabled',
		'workbench.enableExperiments',
		'_extensionsGallery.enablePPE',
		'security.restrictUNCAccess',
		'accessibility.verbosity.debug',
		'telemetry.feedback.enabled',
		'chat.extensionUnification.enabled',
		'chat.agentHost.claudeAgent.enabled',
		'chat.agentHost.byokModels.enabled',
		'chat.editor.codex.preferAgentHost',
		'chat.agentHost.otel.enabled',
		'chat.agentHost.otel.exporterType',
		'chat.agentHost.otel.otlpEndpoint',
		'chat.agentHost.otel.captureContent',
		'chat.agentHost.otel.outfile',
		'chat.agentHost.otel.dbSpanExporter.enabled'
	];

	private readonly titleBarStyle = new ChangeObserver<TitlebarStyle>('string');
	private readonly menuStyle = new ChangeObserver<MenuStyleConfiguration>('string');
	private readonly nativeTabs = new ChangeObserver('boolean');
	private readonly nativeFullScreen = new ChangeObserver('boolean');
	private readonly clickThroughInactive = new ChangeObserver('boolean');
	private readonly controlsStyle = new ChangeObserver('string');
	private accessibilitySupport: 'on' | 'off' | 'auto' | undefined;
	private readonly workspaceTrustEnabled = new ChangeObserver('boolean');
	private readonly experimentsEnabled = new ChangeObserver('boolean');
	private readonly enablePPEExtensionsGallery = new ChangeObserver('boolean');
	private readonly restrictUNCAccess = new ChangeObserver('boolean');
	private readonly accessibilityVerbosityDebug = new ChangeObserver('boolean');
	private readonly telemetryFeedbackEnabled = new ChangeObserver('boolean');
	private readonly extensionUnificationEnabled = new ChangeObserver('boolean');
	private readonly agentHostClaudeAgentEnabled = new ChangeObserver('boolean');
	private readonly agentHostByokModelsEnabled = new ChangeObserver('boolean');
	private readonly editorCodexPreferAgentHost = new ChangeObserver('boolean');
	private readonly agentHostOTelEnabled = new ChangeObserver('boolean');
	private readonly agentHostOTelExporterType = new ChangeObserver('string');
	private readonly agentHostOTelOtlpEndpoint = new ChangeObserver('string');
	private readonly agentHostOTelCaptureContent = new ChangeObserver('boolean');
	private readonly agentHostOTelOutfile = new ChangeObserver('string');
	private readonly agentHostOTelDbSpanExporterEnabled = new ChangeObserver('boolean');

	constructor(
		@IHostService private readonly hostService: IHostService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IUserDataSyncEnablementService private readonly userDataSyncEnablementService: IUserDataSyncEnablementService,
		@IUserDataSyncWorkbenchService userDataSyncWorkbenchService: IUserDataSyncWorkbenchService,
		@IProductService private readonly productService: IProductService,
		@IDialogService private readonly dialogService: IDialogService
	) {
		super();

		this.update(false);
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationChange(e)));
		this._register(userDataSyncWorkbenchService.onDidTurnOnSync(e => this.update(true)));
	}

	private onConfigurationChange(e: IConfigurationChangeEvent): void {
		if (e && !SettingsChangeRelauncher.SETTINGS.some(key => e.affectsConfiguration(key))) {
			return;
		}

		if (this.isTurningOnSyncInProgress()) {
			return;
		}

		this.update(e.source !== ConfigurationTarget.DEFAULT );
	}

	private isTurningOnSyncInProgress(): boolean {
		return !this.userDataSyncEnablementService.isEnabled() && this.userDataSyncService.status === SyncStatus.Syncing;
	}

	private update(askToRelaunch: boolean): void {
		let changed = false;

		function processChanged(didChange: boolean) {
			changed = changed || didChange;
		}

		const config = this.configurationService.getValue<IConfiguration>();
		if (isNative) {

			processChanged((config.window.titleBarStyle === TitlebarStyle.NATIVE || config.window.titleBarStyle === TitlebarStyle.CUSTOM) && this.titleBarStyle.handleChange(config.window?.titleBarStyle));

			processChanged(!isMacintosh && this.menuStyle.handleChange(config.window?.menuStyle));

			processChanged(isMacintosh && this.nativeTabs.handleChange(config.window?.nativeTabs));

			processChanged(isMacintosh && this.nativeFullScreen.handleChange(config.window?.nativeFullScreen));

			processChanged(isMacintosh && this.clickThroughInactive.handleChange(config.window?.clickThroughInactive));

			processChanged(!isMacintosh && this.controlsStyle.handleChange(config.window?.controlsStyle));

			if (isLinux && typeof config.editor?.accessibilitySupport === 'string' && config.editor.accessibilitySupport !== this.accessibilitySupport) {
				this.accessibilitySupport = config.editor.accessibilitySupport;
				if (this.accessibilitySupport === 'on') {
					changed = true;
				}
			}

			processChanged(this.workspaceTrustEnabled.handleChange(config?.security?.workspace?.trust?.enabled));

			processChanged(this.restrictUNCAccess.handleChange(config?.security?.restrictUNCAccess));

			processChanged(this.accessibilityVerbosityDebug.handleChange(config?.accessibility?.verbosity?.debug));
		}

		processChanged(this.experimentsEnabled.handleChange(config.workbench?.enableExperiments));

		processChanged(this.productService.quality !== 'stable' && this.enablePPEExtensionsGallery.handleChange(config._extensionsGallery?.enablePPE));

		processChanged(this.telemetryFeedbackEnabled.handleChange(config.telemetry?.feedback?.enabled));

		processChanged(this.extensionUnificationEnabled.handleChange(config.chat?.extensionUnification?.enabled) && config.chat?.extensionUnification?.enabled === true);

		processChanged(this.agentHostByokModelsEnabled.handleChange(config.chat?.agentHost?.byokModels?.enabled));

		processChanged(this.agentHostClaudeAgentEnabled.handleChange(config.chat?.agentHost?.claudeAgent?.enabled));
		processChanged(this.editorCodexPreferAgentHost.handleChange(config.chat?.editor?.codex?.preferAgentHost));

		processChanged(this.agentHostOTelEnabled.handleChange(config.chat?.agentHost?.otel?.enabled));
		processChanged(this.agentHostOTelExporterType.handleChange(config.chat?.agentHost?.otel?.exporterType));
		processChanged(this.agentHostOTelOtlpEndpoint.handleChange(config.chat?.agentHost?.otel?.otlpEndpoint));
		processChanged(this.agentHostOTelCaptureContent.handleChange(config.chat?.agentHost?.otel?.captureContent));
		processChanged(this.agentHostOTelOutfile.handleChange(config.chat?.agentHost?.otel?.outfile));
		processChanged(this.agentHostOTelDbSpanExporterEnabled.handleChange(config.chat?.agentHost?.otel?.dbSpanExporter?.enabled));

		if (askToRelaunch && changed && this.hostService.hasFocus) {
			this.doConfirm(
				isNative ?
					localize('relaunchSettingMessage', "A setting has changed that requires a restart to take effect.") :
					localize('relaunchSettingMessageWeb', "A setting has changed that requires a reload to take effect."),
				isNative ?
					localize('relaunchSettingDetail', "Press the restart button to restart {0} and enable the setting.", this.productService.nameLong) :
					localize('relaunchSettingDetailWeb', "Press the reload button to reload {0} and enable the setting.", this.productService.nameLong),
				isNative ?
					localize({ key: 'restart', comment: ['&& denotes a mnemonic'] }, "&&Restart") :
					localize({ key: 'restartWeb', comment: ['&& denotes a mnemonic'] }, "&&Reload"),
				() => this.hostService.restart()
			);
		}
	}

	private async doConfirm(message: string, detail: string, primaryButton: string, confirmedFn: () => void): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message, detail, primaryButton });
		if (confirmed) {
			confirmedFn();
		}
	}
}

interface TypeNameToType {
	readonly boolean: boolean;
	readonly string: string;
}

class ChangeObserver<T> {

	static create<TTypeName extends 'boolean' | 'string'>(typeName: TTypeName): ChangeObserver<TypeNameToType[TTypeName]> {
		return new ChangeObserver(typeName);
	}

	constructor(private readonly typeName: string) { }

	private lastValue: T | undefined = undefined;

	handleChange(value: T | undefined): boolean {
		if (typeof value === this.typeName && value !== this.lastValue) {
			this.lastValue = value;
			return true;
		}

		return false;
	}
}

export class WorkspaceChangeExtHostRelauncher extends Disposable implements IWorkbenchContribution {

	private firstFolderResource?: URI;
	private extensionHostRestarter: RunOnceScheduler;

	private onDidChangeWorkspaceFoldersUnbind: IDisposable | undefined;

	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IExtensionService extensionService: IExtensionService,
		@IHostService hostService: IHostService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
	) {
		super();

		this.extensionHostRestarter = this._register(new RunOnceScheduler(async () => {
			if (!!environmentService.extensionTestsLocationURI) {
				return;
			}

			if (environmentService.remoteAuthority) {
				hostService.reload();
			} else if (isNative) {
				const stopped = await extensionService.stopExtensionHosts(localize('restartExtensionHost.reason', "Changing workspace folders"));
				if (stopped) {
					extensionService.startExtensionHosts();
				}
			}
		}, 10));

		this.contextService.getCompleteWorkspace()
			.then(workspace => {
				this.firstFolderResource = workspace.folders.length > 0 ? workspace.folders[0].uri : undefined;
				this.handleWorkbenchState();
				this._register(this.contextService.onDidChangeWorkbenchState(() => setTimeout(() => this.handleWorkbenchState())));
			});

		this._register(toDisposable(() => {
			this.onDidChangeWorkspaceFoldersUnbind?.dispose();
		}));
	}

	private handleWorkbenchState(): void {

		if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {

			const workspace = this.contextService.getWorkspace();
			this.firstFolderResource = workspace.folders.length > 0 ? workspace.folders[0].uri : undefined;

			if (!this.onDidChangeWorkspaceFoldersUnbind) {
				this.onDidChangeWorkspaceFoldersUnbind = this.contextService.onDidChangeWorkspaceFolders(() => this.onDidChangeWorkspaceFolders());
			}
		}

		else {
			dispose(this.onDidChangeWorkspaceFoldersUnbind);
			this.onDidChangeWorkspaceFoldersUnbind = undefined;
		}
	}

	private onDidChangeWorkspaceFolders(): void {
		const workspace = this.contextService.getWorkspace();

		const newFirstFolderResource = workspace.folders.length > 0 ? workspace.folders[0].uri : undefined;
		if (!isEqual(this.firstFolderResource, newFirstFolderResource)) {
			this.firstFolderResource = newFirstFolderResource;

			this.extensionHostRestarter.schedule();
		}
	}
}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(SettingsChangeRelauncher, LifecyclePhase.Restored);
workbenchRegistry.registerWorkbenchContribution(WorkspaceChangeExtHostRelauncher, LifecyclePhase.Restored);
