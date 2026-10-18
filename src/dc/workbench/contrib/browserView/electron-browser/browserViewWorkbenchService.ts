/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserViewCommandId, BrowserViewStorageScope, IBrowserViewEditorOpenOptions, IBrowserViewInfo, IBrowserViewOwner, IBrowserViewService, IBrowserViewTheme, ipcBrowserViewChannelName } from '../../../../platform/browserView/common/browserView.js';
import { BrowserViewSharingState, IBrowserViewWorkbenchService, IBrowserViewModel, BrowserViewModel, IBrowserViewContextualFilter, IBrowserViewFilterContext, IBrowserViewOpenHandler, IBrowserViewWorkbenchCreateOptions } from '../common/browserView.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { process } from '../../../../base/parts/sandbox/electron-browser/globals.js';
import { ACTIVE_GROUP, AUX_WINDOW_GROUP, IEditorService, PreferredGroup, SIDE_GROUP, USE_MODAL_EDITOR_SETTING, UseModalEditorMode } from '../../../services/editor/common/editorService.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { BrowserEditorInput, IBrowserEditorInputData } from '../common/browserEditorInput.js';
import { IEditorGroup, IEditorGroupsService, preferredSideBySideGroupDirection } from '../../../services/editor/common/editorGroupsService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { ChatConfiguration } from '../../chat/common/constants.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { contrastBorder, descriptionForeground, focusBorder } from '../../../../platform/theme/common/colors/baseColors.js';
import { buttonForeground, buttonBackground, inputPlaceholderForeground } from '../../../../platform/theme/common/colors/inputColors.js';
import { editorWidgetBackground, editorWidgetBorder, editorWidgetForeground, toolbarHoverBackground, widgetShadow } from '../../../../platform/theme/common/colors/editorColors.js';
import { DEFAULT_FONT_FAMILY } from '../../../../base/browser/fonts.js';
import { findGroup } from '../../../services/editor/common/editorGroupFinder.js';
import { ChatEditorInput } from '../../chat/browser/widgetHosts/editor/chatEditorInput.js';
import { IChatWidgetService } from '../../chat/browser/chat.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { URI } from '../../../../base/common/uri.js';
import { isEqual } from '../../../../base/common/resources.js';
import { Schemas } from '../../../../base/common/network.js';
import { getCopilotRootPaths } from '../../../../platform/agentHost/common/copilotHome.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { ITunnelProxyInfo } from '../../../../platform/tunnel/common/tunnelProxy.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { AgentNetworkDomainSettingId } from '../../../../platform/networkFilter/common/settings.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';

export const BrowserMaxHistoryEntriesSettingId = 'workbench.browser.maxHistoryEntries';
export const BrowserRemoteProxyEnabledSettingId = 'workbench.browser.enableRemoteProxy';
export const BrowserNewTabPlacementSettingId = 'workbench.browser.newTabPlacement';
const OPEN_BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;

export type BrowserNewTabPlacement = 'activeGroup' | 'sideGroup' | 'window';

type DedicatedGroupPlacement = Exclude<BrowserNewTabPlacement, 'activeGroup'>;

const browserViewContextMenuCommands = [
	BrowserViewCommandId.GoBack,
	BrowserViewCommandId.GoForward,
	BrowserViewCommandId.Reload,
];

export class BrowserViewWorkbenchService extends Disposable implements IBrowserViewWorkbenchService {
	declare readonly _serviceBrand: undefined;

	private readonly _browserViewService: IBrowserViewService;
	private readonly _known = new Map<string, BrowserEditorInput>();
	private readonly _contextualFilters = new Set<IBrowserViewContextualFilter>();
	private readonly _openHandlers = new Set<IBrowserViewOpenHandler>();
	private readonly _mainWindowId: number;

	private _remoteProxyInfo: ITunnelProxyInfo | undefined;

	private _dedicatedWindowGroupPromise: Promise<IEditorGroup> | undefined;

	private readonly _onDidChangeBrowserViews = this._register(new Emitter<void>());
	readonly onDidChangeBrowserViews: Event<void> = this._onDidChangeBrowserViews.event;

	private static readonly _sharingAvailableContext = ContextKeyExpr.and(
		ChatContextKeys.enabled,
		ContextKeyExpr.has(`config.${ChatConfiguration.AgentEnabled}`),
		ContextKeyExpr.has(`config.workbench.browser.enableChatTools`),
	)!;

	private _isSharingAvailable: boolean = false;

	private readonly _onDidChangeSharingAvailable = this._register(new Emitter<boolean>());
	readonly onDidChangeSharingAvailable: Event<boolean> = this._onDidChangeSharingAvailable.event;

	get isSharingAvailable(): boolean {
		return this._isSharingAvailable;
	}

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceTrustEnablementService private readonly workspaceTrustEnablementService: IWorkspaceTrustEnablementService,
		@ILogService private readonly logService: ILogService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@IThemeService private readonly themeService: IThemeService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		const channel = mainProcessService.getChannel(ipcBrowserViewChannelName);
		this._browserViewService = ProxyChannel.toService<IBrowserViewService>(channel);
		this._mainWindowId = mainWindow.vscodeWindowId;

		this._updateWindowConfiguration();
		const chatEnabledKeys = new Set(ChatContextKeys.enabled.keys());
		this._register(this.keybindingService.onDidUpdateKeybindings(() => this._updateWindowConfiguration()));
		this._register(this.themeService.onDidColorThemeChange(() => this._updateWindowConfiguration()));
		this._register(this.accessibilityService.onDidChangeReducedMotion(() => this._updateWindowConfiguration()));
		this._register(this.workspaceTrustManagementService.onDidChangeTrustedFolders(() => this._updateWindowConfiguration()));
		this._register(this.workspaceTrustManagementService.onDidChangeTrust(() => this._updateWindowConfiguration()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this._updateWindowConfiguration()));
		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(chatEnabledKeys)) {
				this._updateWindowConfiguration();
			}
		}));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(AgentNetworkDomainSettingId.NetworkFilter)
				&& this.configurationService.getValue<boolean>(AgentNetworkDomainSettingId.NetworkFilter)
				&& [...this._known.values()].some(input => input.model?.sharingState === BrowserViewSharingState.Shared && !input.model.isDirectlyShareable)
			) {
				this.notificationService.info(localize('browser.networkFilteringEnabled', "Agent access to browser tabs was revoked because network filtering was enabled."));
			}
			if (e.affectsConfiguration(BrowserMaxHistoryEntriesSettingId) || e.affectsConfiguration(BrowserRemoteProxyEnabledSettingId)) {
				this._updateWindowConfiguration();
			}
		}));

		this._isSharingAvailable = this._computeSharingAvailable();
		const sharingKeys = new Set(BrowserViewWorkbenchService._sharingAvailableContext.keys());
		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(sharingKeys)) {
				const was = this._isSharingAvailable;
				this._isSharingAvailable = this._computeSharingAvailable();
				if (was !== this._isSharingAvailable) {
					this._onDidChangeSharingAvailable.fire(this._isSharingAvailable);
				}
			}
		}));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.browser.enableChatTools') || e.affectsConfiguration(ChatConfiguration.AgentEnabled)) {
				const was = this._isSharingAvailable;
				this._isSharingAvailable = this._computeSharingAvailable();
				if (was !== this._isSharingAvailable) {
					this._onDidChangeSharingAvailable.fire(this._isSharingAvailable);
				}
			}
		}));

		void this._initializeExistingViews().catch(e => {
			this.logService.error('[BrowserViewWorkbenchService] Failed to initialize existing browser views.', e);
		});

		this._register(this._browserViewService.onDidCreateBrowserView(e => {
			if (e.info.host.windowId !== this._mainWindowId) {
				return;
			}

			this._createModel(e.info, e.initialUrl);

			const editor = this._known.get(e.info.id);
			if (editor && e.editorOpenRequest) {
				void this._openEditorForCreatedView(editor, e.info.owner, e.editorOpenRequest).catch(error => {
					this.logService.error('[BrowserViewWorkbenchService] Failed to open editor for created browser view.', error);
				});
			}
		}));
	}

	private _computeSharingAvailable(): boolean {
		const configEnabled = this.configurationService.getValue<boolean>('workbench.browser.enableChatTools') !== false;
		const agentEnabled = this.configurationService.getValue<boolean>(ChatConfiguration.AgentEnabled) !== false;
		if (!configEnabled || !agentEnabled) {
			return false;
		}
		return this.contextKeyService.contextMatchesRules(BrowserViewWorkbenchService._sharingAvailableContext);
	}

	willUseRemoteProxy(): boolean {
		if (!this.environmentService.remoteAuthority) {
			return false;
		}
		if (!this.configurationService.getValue<boolean>(BrowserRemoteProxyEnabledSettingId)) {
			return false;
		}
		return true;
	}

	setRemoteProxyInfo(info: ITunnelProxyInfo | undefined): void {
		this._remoteProxyInfo = info;
		this._updateWindowConfiguration();
	}

	getKnownBrowserViews(): Map<string, BrowserEditorInput> {
		return this._known;
	}

	registerContextualFilter(filter: IBrowserViewContextualFilter): IDisposable {
		this._contextualFilters.add(filter);
		const changeListener = filter.onDidChange?.(() => this._onDidChangeBrowserViews.fire());
		this._onDidChangeBrowserViews.fire();
		return toDisposable(() => {
			this._contextualFilters.delete(filter);
			changeListener?.dispose();
			this._onDidChangeBrowserViews.fire();
		});
	}

	getContextualBrowserViews(context?: IBrowserViewFilterContext): Map<string, BrowserEditorInput> {
		if (this._contextualFilters.size === 0) {
			return this._known;
		}
		const filters = [...this._contextualFilters];
		const result = new Map<string, BrowserEditorInput>();
		for (const [id, input] of this._known) {
			if (filters.every(filter => filter.include(input, { ...context }))) {
				result.set(id, input);
			}
		}
		return result;
	}

	async getPreferredGroup(preferredGroup?: PreferredGroup): Promise<PreferredGroup | undefined> {
		if (preferredGroup === SIDE_GROUP) {
			return this._getOrCreateDedicatedGroup('sideGroup');
		}

		if (preferredGroup !== undefined && preferredGroup !== ACTIVE_GROUP) {
			return preferredGroup;
		}

		const placement = this.configurationService.getValue<BrowserNewTabPlacement>(BrowserNewTabPlacementSettingId);
		if (placement === 'sideGroup' || placement === 'window') {
			return this._getOrCreateDedicatedGroup(placement);
		}

		if (this.configurationService.getValue<UseModalEditorMode>(USE_MODAL_EDITOR_SETTING) === 'all') {
			return this.editorGroupsService.mainPart.activeGroup;
		}

		return preferredGroup;
	}

	private _getOrCreateDedicatedGroup(placement: DedicatedGroupPlacement): IEditorGroup | Promise<IEditorGroup> {
		const existing = this._findDedicatedGroup(placement);
		if (existing) {
			return existing;
		}

		if (placement === 'sideGroup') {
			const direction = preferredSideBySideGroupDirection(this.configurationService);
			const group = this.editorGroupsService.addGroup(this.editorGroupsService.activeGroup, direction);
			group.lock(true);
			return group;
		}

		if (!this._dedicatedWindowGroupPromise) {
			this._dedicatedWindowGroupPromise = this.editorGroupsService.createAuxiliaryEditorPart()
				.then(part => {
					part.activeGroup.lock(true);
					return part.activeGroup;
				})
				.finally(() => this._dedicatedWindowGroupPromise = undefined);
		}
		return this._dedicatedWindowGroupPromise;
	}

	private _findDedicatedGroup(placement: DedicatedGroupPlacement): IEditorGroup | undefined {
		const mainPart = this.editorGroupsService.mainPart;
		for (const group of this.editorGroupsService.groups) {
			if (!group.isLocked) {
				continue;
			}
			if (group.editors.length > 0 && !group.editors.some(editor => editor instanceof BrowserEditorInput)) {
				continue;
			}
			const inMainPart = this.editorGroupsService.getPart(group) === mainPart;
			const matchesPlacement = placement === 'sideGroup' ? inMainPart : !inMainPart;
			if (matchesPlacement) {
				return group;
			}
		}
		return undefined;
	}

	registerOpenHandler(handler: IBrowserViewOpenHandler): IDisposable {
		this._openHandlers.add(handler);
		return toDisposable(() => {
			this._openHandlers.delete(handler);
		});
	}

	async createBrowserView(options: IBrowserViewWorkbenchCreateOptions, editorOpenOptions?: IBrowserViewEditorOpenOptions): Promise<BrowserEditorInput> {
		const input = this._getOrCreateLazy({
			id: generateUuid(),
			associatedResource: options.associatedResource,
			url: options.initialUrl
		}, undefined, { ...options, initialUrl: undefined });
		const model = await input.resolve();
		if (editorOpenOptions) {
			void this._openEditorForCreatedView(input, options.owner, editorOpenOptions).catch(error => {
				this.logService.error('[BrowserViewWorkbenchService] Failed to open editor for created browser view.', error);
			});
		}
		const initialUrl = options.initialUrl;
		if (initialUrl) {
			const didNavigate = await raceTimeout((async () => {
				await model.loadURL(initialUrl);
				return true;
			})(), OPEN_BROWSER_NAVIGATION_TIMEOUT_MS);
			if (!didNavigate) {
				throw new Error(`Navigation to ${initialUrl} timed out after ${OPEN_BROWSER_NAVIGATION_TIMEOUT_MS} ms. The page (ID: ${input.id}) is open and can be reused.`);
			}
		}
		return input;
	}

	getOrCreateLazy(data: IBrowserEditorInputData): BrowserEditorInput {
		return this._getOrCreateLazy(data);
	}

	private _getOrCreateLazy(data: IBrowserEditorInputData, model?: IBrowserViewModel, createOptions?: IBrowserViewWorkbenchCreateOptions): BrowserEditorInput {
		const { id, associatedResource } = data;
		if (!this._known.has(id)) {
			const input = this.instantiationService.createInstance(BrowserEditorInput, data, async () => {
				const info = await this._browserViewService.getOrCreateBrowserView(
					id,
					{
						host: {
							windowId: this._mainWindowId
						},
						owner: createOptions?.owner ?? { type: 'user' },
						associatedResource,
						session: createOptions?.session ?? { scope: await this._resolveStorageScope() },
						initialAudiences: createOptions?.initialAudiences,
						initialUrl: createOptions ? createOptions.initialUrl : data.url,
						openSource: createOptions?.openSource
					}
				);
				return this._createModel(info);
			});
			input.onWillDispose(() => {
				this._known.delete(id);
				this._onDidChangeBrowserViews.fire();
			});
			if (model) {
				input.model = model;
			}
			this._known.set(id, input);
			this._onDidChangeBrowserViews.fire();
		}

		return this._known.get(id)!;
	}

	async clearGlobalStorage(): Promise<void> {
		return this._browserViewService.clearGlobalStorage();
	}

	async clearWorkspaceStorage(): Promise<void> {
		const workspaceId = this.workspaceContextService.getWorkspace().id;
		return this._browserViewService.clearWorkspaceStorage(workspaceId);
	}

	private async _resolveStorageScope(): Promise<BrowserViewStorageScope> {
		let dataStorage = this.configurationService.getValue<BrowserViewStorageScope | 'default'>(
			'workbench.browser.dataStorage'
		) ?? 'default';

		await this.workspaceTrustManagementService.workspaceTrustInitialized;

		const isWorkspaceUntrusted =
			this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY &&
			!this.workspaceTrustManagementService.isWorkspaceTrusted();

		if (isWorkspaceUntrusted) {
			dataStorage = BrowserViewStorageScope.Ephemeral;
		} else if (dataStorage === 'default') {
			dataStorage = this.environmentService.remoteAuthority
				? BrowserViewStorageScope.Workspace
				: BrowserViewStorageScope.Global;
		}

		return dataStorage;
	}

	private async _initializeExistingViews(): Promise<void> {
		const views = await this._browserViewService.getBrowserViews(this._mainWindowId);
		for (const info of views) {
			this._createModel(info);
		}
	}

	private _createModel(info: IBrowserViewInfo, initialUrl?: string): IBrowserViewModel {
		const associatedResource = URI.revive(info.associatedResource);
		const input = this._known.get(info.id);
		const existing = input?.model;
		if (existing) {
			return existing;
		}

		const state = input
			? {
				...info.state,
				url: input.url ?? info.state.url,
				title: input.title ?? info.state.title,
				lastFavicon: input.favicon ?? info.state.lastFavicon
			}
			: initialUrl
				? { ...info.state, url: initialUrl }
				: info.state;
		const model = this.instantiationService.createInstance(BrowserViewModel, info.id, info.host, info.owner, associatedResource, state, this._browserViewService);

		this._getOrCreateLazy({ id: info.id, associatedResource, url: initialUrl }, model).model = model;

		this._onDidChangeBrowserViews.fire();

		return model;
	}

	private async _openEditorForCreatedView(view: BrowserEditorInput, owner: IBrowserViewOwner, options: IBrowserViewEditorOpenOptions): Promise<void> {
		for (const handler of this._openHandlers) {
			if (!handler.shouldOpenEditor(view, owner, options)) {
				return;
			}
		}

		let targetGroup: PreferredGroup | undefined;
		if (options.auxiliaryWindow) {
			targetGroup = AUX_WINDOW_GROUP;
		} else if (options.parentViewId) {
			targetGroup = this._findEditorGroupForView(options.parentViewId);
			if (targetGroup === undefined) {
				return;
			}
		} else {
			targetGroup = await this.getPreferredGroup();
		}

		const editorOptions = {
			inactive: options.background,
			preserveFocus: options.preserveFocus,
			pinned: options.pinned,
			auxiliary: options.auxiliaryWindow
				? { bounds: options.auxiliaryWindow, compact: true }
				: undefined,
		};

		const [group] = await this.instantiationService.invokeFunction(findGroup, { editor: view, options: editorOptions }, targetGroup);
		if (owner.type === 'agent') {
			const sessionResource = URI.parse(owner.sessionId);
			const widget = this.chatWidgetService.getWidgetBySessionResource(sessionResource);
			const isWidgetVisible = !!widget && widget.domNode.offsetParent !== null;
			const activeIsSameSession = group.activeEditor instanceof ChatEditorInput
				&& isEqual(group.activeEditor.sessionResource, sessionResource);
			if (!isWidgetVisible || activeIsSameSession) {
				editorOptions.inactive = true;
			}
		}

		void this.editorService.openEditor(view, editorOptions, group);
	}

	private _findEditorGroupForView(viewId: string): number | undefined {
		for (const group of this.editorGroupsService.groups) {
			for (const editor of group.editors) {
				if (editor instanceof BrowserEditorInput && editor.id === viewId) {
					return group.id;
				}
			}
		}
		return undefined;
	}

	private _updateWindowConfiguration(): void {
		void this._browserViewService.updateWindowConfiguration(this._mainWindowId, {
			theme: this._getTheme(),
			keybindings: this._getKeybindings(),
			aiFeaturesDisabled: !this.contextKeyService.contextMatchesRules(ChatContextKeys.enabled),
			maxHistoryEntries: this.configurationService.getValue<number>(BrowserMaxHistoryEntriesSettingId),
			proxyInfo: this._remoteProxyInfo,
			trustedFileRoots: this._getTrustedFileRoots(),
			trustAllFiles: !this.workspaceTrustEnablementService.isWorkspaceTrustEnabled(),
		});
	}

	private _getKeybindings(): { [commandId: string]: string } {
		const keybindings: { [commandId: string]: string } = Object.create(null);
		for (const commandId of browserViewContextMenuCommands) {
			const binding = this.keybindingService.lookupKeybinding(commandId);
			const accelerator = binding?.getElectronAccelerator();
			if (accelerator) {
				keybindings[commandId] = accelerator;
			}
		}
		return keybindings;
	}

	private _getTheme(): IBrowserViewTheme {
		const theme = this.themeService.getColorTheme();
		return {
			focusBorder: theme.getColor(focusBorder)?.toString(),
			buttonBackground: theme.getColor(buttonBackground)?.toString(),
			buttonForeground: theme.getColor(buttonForeground)?.toString(),
			widgetBackground: theme.getColor(editorWidgetBackground)?.toString(),
			widgetForeground: theme.getColor(editorWidgetForeground)?.toString(),
			widgetBorder: theme.getColor(editorWidgetBorder)?.toString(),
			widgetShadow: theme.getColor(widgetShadow)?.toString(),
			contrastBorder: theme.getColor(contrastBorder)?.toString(),
			descriptionForeground: theme.getColor(descriptionForeground)?.toString(),
			inputPlaceholderForeground: theme.getColor(inputPlaceholderForeground)?.toString(),
			toolbarHoverBackground: theme.getColor(toolbarHoverBackground)?.toString(),
			font: DEFAULT_FONT_FAMILY,
			reducedMotion: this.accessibilityService.isMotionReduced(),
		};
	}

	private _getTrustedFileRoots(): string[] {
		const roots = new Set(getCopilotRootPaths(this.environmentService.userHome.fsPath, process.env));
		if (this.workspaceTrustManagementService.isWorkspaceTrusted()) {
			for (const folder of this.workspaceContextService.getWorkspace().folders) {
				if (folder.uri.scheme === Schemas.file) {
					roots.add(folder.uri.fsPath);
				}
			}
		}
		for (const uri of this.workspaceTrustManagementService.getTrustedUris()) {
			if (uri.scheme === Schemas.file) {
				roots.add(uri.fsPath);
			}
		}
		return [...roots];
	}
}
