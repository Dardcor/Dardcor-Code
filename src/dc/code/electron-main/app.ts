/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow, desktopCapturer, Details, globalShortcut, GPUFeatureStatus, powerMonitor, protocol, screen as electronScreen, session, Session, systemPreferences, WebFrameMain } from 'electron';
import { validatedIpcMain } from '../../base/parts/ipc/electron-main/ipcMain.js';
import { execFileSync, fork, spawn, ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { existsSync, cpSync, statSync } from 'fs';
import { homedir, hostname, release } from 'os';
import { initWindowsVersionInfo } from '../../base/node/windowsVersion.js';
import { VSBuffer } from '../../base/common/buffer.js';
import { toErrorMessage } from '../../base/common/errorMessage.js';
import { Event } from '../../base/common/event.js';
import { parse } from '../../base/common/jsonc.js';
import { getPathLabel } from '../../base/common/labels.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../base/common/lifecycle.js';
import { Schemas, VSCODE_AUTHORITY } from '../../base/common/network.js';
import { dirname, join, posix } from '../../base/common/path.js';
import { IProcessEnvironment, isLinux, isLinuxSnap, isMacintosh, isWindows, OS } from '../../base/common/platform.js';
import { assertType } from '../../base/common/types.js';
import { URI } from '../../base/common/uri.js';
import { generateUuid } from '../../base/common/uuid.js';
import { registerContextMenuListener } from '../../base/parts/contextmenu/electron-main/contextmenu.js';
import { getDelayedChannel, ProxyChannel, StaticRouter } from '../../base/parts/ipc/common/ipc.js';
import { Server as ElectronIPCServer } from '../../base/parts/ipc/electron-main/ipc.electron.js';
import { Client as MessagePortClient } from '../../base/parts/ipc/electron-main/ipc.mp.js';
import { Server as NodeIPCServer } from '../../base/parts/ipc/node/ipc.net.js';
import { IProxyAuthService, ProxyAuthService } from '../../platform/native/electron-main/auth.js';
import { localize } from '../../nls.js';
import { addUNCHostToAllowlist, disableUNCAccessRestrictions } from '../../base/node/unc.js';
import { IBackupMainService } from '../../platform/backup/electron-main/backup.js';
import { BackupMainService } from '../../platform/backup/electron-main/backupMainService.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { ElectronExtensionHostDebugBroadcastChannel } from '../../platform/debug/electron-main/extensionHostDebugIpc.js';
import { IDiagnosticsService, IGPULogMessage } from '../../platform/diagnostics/common/diagnostics.js';
import { DiagnosticsMainService, IDiagnosticsMainService } from '../../platform/diagnostics/electron-main/diagnosticsMainService.js';
import { DialogMainService, IDialogMainService } from '../../platform/dialogs/electron-main/dialogMainService.js';
import { IEncryptionMainService } from '../../platform/encryption/common/encryptionService.js';
import { EncryptionMainService } from '../../platform/encryption/electron-main/encryptionMainService.js';
import { ipcBrowserViewChannelName } from '../../platform/browserView/common/browserView.js';
import { ipcBrowserViewGroupChannelName } from '../../platform/browserView/common/browserViewGroup.js';
import { BrowserViewMainService, IBrowserViewMainService } from '../../platform/browserView/electron-main/browserViewMainService.js';
import { BrowserViewGroupMainService, IBrowserViewGroupMainService } from '../../platform/browserView/electron-main/browserViewGroupMainService.js';
import { NativeParsedArgs } from '../../platform/environment/common/argv.js';
import { IEnvironmentMainService } from '../../platform/environment/electron-main/environmentMainService.js';
import { isLaunchedFromCli } from '../../platform/environment/node/argvHelper.js';
import { getResolvedShellEnv } from '../../platform/shell/node/shellEnv.js';
import { IExtensionHostStarter, ipcExtensionHostStarterChannelName } from '../../platform/extensions/common/extensionHostStarter.js';
import { ExtensionHostStarter } from '../../platform/extensions/electron-main/extensionHostStarter.js';
import { IExternalTerminalMainService } from '../../platform/externalTerminal/electron-main/externalTerminal.js';
import { LinuxExternalTerminalService, MacExternalTerminalService, WindowsExternalTerminalService } from '../../platform/externalTerminal/node/externalTerminalService.js';
import { ISandboxHelperMainService } from '../../platform/sandbox/electron-main/sandboxHelperService.js';
import { SandboxHelperService } from '../../platform/sandbox/node/sandboxHelper.js';
import { LOCAL_FILE_SYSTEM_CHANNEL_NAME } from '../../platform/files/common/diskFileSystemProviderClient.js';
import { IFileService } from '../../platform/files/common/files.js';
import { DiskFileSystemProviderChannel } from '../../platform/files/electron-main/diskFileSystemProviderServer.js';
import { DiskFileSystemProvider } from '../../platform/files/node/diskFileSystemProvider.js';
import { SyncDescriptor } from '../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { ProcessMainService } from '../../platform/process/electron-main/processMainService.js';
import { IKeyboardLayoutMainService, KeyboardLayoutMainService } from '../../platform/keyboardLayout/electron-main/keyboardLayoutMainService.js';
import { ILaunchMainService, LaunchMainService } from '../../platform/launch/electron-main/launchMainService.js';
import { ILifecycleMainService, LifecycleMainPhase, ShutdownReason } from '../../platform/lifecycle/electron-main/lifecycleMainService.js';
import { ILoggerService, ILogService } from '../../platform/log/common/log.js';
import { IMenubarMainService, MenubarMainService } from '../../platform/menubar/electron-main/menubarMainService.js';
import type { IOSProxyConfig } from '../../platform/native/common/native.js';
import { INativeHostMainService, NativeHostMainService } from '../../platform/native/electron-main/nativeHostMainService.js';
import { GlobalKeybindingsMainService, IGlobalKeybindingsMainService } from '../../platform/globalKeybindings/electron-main/globalKeybindingsMainService.js';
import { IMeteredConnectionService } from '../../platform/meteredConnection/common/meteredConnection.js';
import { METERED_CONNECTION_CHANNEL } from '../../platform/meteredConnection/common/meteredConnectionIpc.js';
import { MeteredConnectionChannel } from '../../platform/meteredConnection/electron-main/meteredConnectionChannel.js';
import { MeteredConnectionMainService } from '../../platform/meteredConnection/electron-main/meteredConnectionMainService.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { getRemoteAuthority } from '../../platform/remote/common/remoteHosts.js';
import { SharedProcess } from '../../platform/sharedProcess/electron-main/sharedProcess.js';
import { ISignService } from '../../platform/sign/common/sign.js';
import { IStateService } from '../../platform/state/node/state.js';
import { StorageDatabaseChannel } from '../../platform/storage/electron-main/storageIpc.js';
import { ApplicationStorageMainService, IApplicationStorageMainService, IStorageMainService, StorageMainService } from '../../platform/storage/electron-main/storageMainService.js';
import { resolveCommonProperties } from '../../platform/telemetry/common/commonProperties.js';
import { ITelemetryService, TelemetryLevel } from '../../platform/telemetry/common/telemetry.js';
import { TelemetryAppenderClient } from '../../platform/telemetry/common/telemetryIpc.js';
import { ITelemetryServiceConfig, TelemetryService } from '../../platform/telemetry/common/telemetryService.js';
import { getPiiPathsFromEnvironment, getTelemetryLevel, isInternalTelemetry, NullTelemetryService, supportsTelemetry } from '../../platform/telemetry/common/telemetryUtils.js';
import { IUpdateService } from '../../platform/update/common/update.js';
import { UpdateChannel } from '../../platform/update/common/updateIpc.js';
import { NotAvailableUpdateDialog } from '../../platform/update/electron-main/notAvailableUpdateDialog.js';
import { DarwinUpdateService } from '../../platform/update/electron-main/updateService.darwin.js';
import { LinuxUpdateService } from '../../platform/update/electron-main/updateService.linux.js';
import { SnapUpdateService } from '../../platform/update/electron-main/updateService.snap.js';
import { Win32UpdateService } from '../../platform/update/electron-main/updateService.win32.js';
import { isInnoSetupInstall } from '../../platform/update/electron-main/win32UpdateType.js';
import { IOpenURLOptions, IURLService } from '../../platform/url/common/url.js';
import { URLHandlerChannelClient, URLHandlerRouter } from '../../platform/url/common/urlIpc.js';
import { NativeURLService } from '../../platform/url/common/urlService.js';
import { ElectronURLListener } from '../../platform/url/electron-main/electronUrlListener.js';
import { IWebviewManagerService } from '../../platform/webview/common/webviewManagerService.js';
import { WebviewMainService } from '../../platform/webview/electron-main/webviewMainService.js';
import { isFolderToOpen, isWorkspaceToOpen, IWindowOpenable } from '../../platform/window/common/window.js';
import { getAllWindowsExcludingOffscreen, IWindowsMainService, OpenContext } from '../../platform/windows/electron-main/windows.js';
import { ICodeWindow } from '../../platform/window/electron-main/window.js';
import { WindowsMainService } from '../../platform/windows/electron-main/windowsMainService.js';
import { ActiveWindowManager } from '../../platform/windows/node/windowTracker.js';
import { hasWorkspaceFileExtension } from '../../platform/workspace/common/workspace.js';
import { IWorkspacesService } from '../../platform/workspaces/common/workspaces.js';
import { IWorkspacesHistoryMainService, WorkspacesHistoryMainService } from '../../platform/workspaces/electron-main/workspacesHistoryMainService.js';
import { WorkspacesMainService } from '../../platform/workspaces/electron-main/workspacesMainService.js';
import { IWorkspacesManagementMainService, WorkspacesManagementMainService } from '../../platform/workspaces/electron-main/workspacesManagementMainService.js';
import { IPolicyService } from '../../platform/policy/common/policy.js';
import { INativeManagedSettingsService, IFileManagedSettingsService } from '../../platform/policy/common/copilotManagedSettings.js';
import { NativeManagedSettingsChannel } from '../../platform/policy/common/nativeManagedSettingsIpc.js';
import { FileManagedSettingsChannel } from '../../platform/policy/common/fileManagedSettingsIpc.js';
import { PolicyChannel } from '../../platform/policy/common/policyIpc.js';
import { IUserDataProfilesMainService } from '../../platform/userDataProfile/electron-main/userDataProfile.js';
import { IExtensionsProfileScannerService } from '../../platform/extensionManagement/common/extensionsProfileScannerService.js';
import { IExtensionsScannerService } from '../../platform/extensionManagement/common/extensionsScannerService.js';
import { ExtensionsScannerService } from '../../platform/extensionManagement/node/extensionsScannerService.js';
import { UserDataProfilesHandler } from '../../platform/userDataProfile/electron-main/userDataProfilesHandler.js';
import { ProfileStorageChangesListenerChannel } from '../../platform/userDataProfile/electron-main/userDataProfileStorageIpc.js';
import { Promises, RunOnceScheduler, runWhenGlobalIdle } from '../../base/common/async.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { resolveMachineId, resolveSqmId, resolveDevDeviceId, validateDevDeviceId } from '../../platform/telemetry/electron-main/telemetryUtils.js';
import { ExtensionsProfileScannerService } from '../../platform/extensionManagement/node/extensionsProfileScannerService.js';
import { LoggerChannel } from '../../platform/log/electron-main/logIpc.js';
import { ILoggerMainService } from '../../platform/log/electron-main/loggerService.js';
import { IInitialProtocolUrls, IProtocolUrl } from '../../platform/url/electron-main/url.js';
import { IUtilityProcessWorkerMainService, UtilityProcessWorkerMainService } from '../../platform/utilityProcess/electron-main/utilityProcessWorkerMainService.js';
import { ipcUtilityProcessWorkerChannelName } from '../../platform/utilityProcess/common/utilityProcessWorkerService.js';
import { ILocalPtyService, LocalReconnectConstants, TerminalIpcChannels, TerminalSettingId } from '../../platform/terminal/common/terminal.js';
import { ElectronPtyHostStarter } from '../../platform/terminal/electron-main/electronPtyHostStarter.js';
import { PtyHostService } from '../../platform/terminal/node/ptyHostService.js';
import { ElectronAgentHostStarter } from '../../platform/agentHost/electron-main/electronAgentHostStarter.js';
import { AgentHostProcessManager } from '../../platform/agentHost/node/agentHostService.js';
import { NODE_REMOTE_RESOURCE_CHANNEL_NAME, NODE_REMOTE_RESOURCE_IPC_METHOD_NAME, NodeRemoteResourceResponse, NodeRemoteResourceRouter } from '../../platform/remote/common/electronRemoteResources.js';
import { Lazy } from '../../base/common/lazy.js';
import { IAuxiliaryWindowsMainService } from '../../platform/auxiliaryWindow/electron-main/auxiliaryWindows.js';
import { AuxiliaryWindowsMainService } from '../../platform/auxiliaryWindow/electron-main/auxiliaryWindowsMainService.js';
import { normalizeNFC } from '../../base/common/normalization.js';
import { ICSSDevelopmentService, CSSDevelopmentService } from '../../platform/cssDev/node/cssDevService.js';
import { INativeMcpDiscoveryHelperService, NativeMcpDiscoveryHelperChannelName } from '../../platform/mcp/common/nativeMcpDiscoveryHelper.js';
import { NativeMcpDiscoveryHelperService } from '../../platform/mcp/node/nativeMcpDiscoveryHelperService.js';
import { IMcpGatewayService, McpGatewayChannelName } from '../../platform/mcp/common/mcpGateway.js';
import { McpGatewayService } from '../../platform/mcp/node/mcpGatewayService.js';
import { McpGatewayChannel } from '../../platform/mcp/node/mcpGatewayChannel.js';
import { IWebContentExtractorService } from '../../platform/webContentExtractor/common/webContentExtractor.js';
import { NativeWebContentExtractorService } from '../../platform/webContentExtractor/electron-main/webContentExtractorService.js';
import { AgentNetworkFilterService, IAgentNetworkFilterService } from '../../platform/networkFilter/common/networkFilterService.js';
import { ITerminalSandboxService, NullTerminalSandboxService } from '../../platform/sandbox/common/terminalSandboxService.js';
import ErrorTelemetry from '../../platform/telemetry/electron-main/errorTelemetry.js';

type OSProxyConfigEvent = {
	readonly success: boolean;
	readonly durationMs: number;
	readonly platformKind?: string;
	readonly autoDetect?: boolean;
	readonly httpProxyEnvironmentState?: string;
	readonly httpsProxyEnvironmentState?: string;
	readonly allProxyEnvironmentState?: string;
	readonly noProxyEnvironmentState?: string;
	readonly wpadDhcpState?: string;
	readonly wpadDnsState?: string;
	readonly configuredPacState?: string;
	readonly hasConfiguredPac?: boolean;
	readonly hasLoadedPac?: boolean;
	readonly pacSource?: string;
	readonly pacScriptCharacterCount?: number;
	readonly pacScriptLineCount?: number;
	readonly pacScriptReturnCount?: number;
	readonly hasHttpProxy?: boolean;
	readonly hasHttpsProxy?: boolean;
	readonly hasSocksProxy?: boolean;
	readonly hasBypassRules?: boolean;
	readonly excludeSimpleHostnames?: boolean;
};

type OSProxyConfigClassification = {
	success: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Whether reading the operating system proxy configuration completed successfully.' };
	durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Wall-clock duration of the operating system proxy configuration read in milliseconds.' };
	platformKind?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The operating system proxy configuration source (windows, macos, linux, unknown, or none).' };
	autoDetect?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether automatic proxy discovery is enabled.' };
	httpProxyEnvironmentState?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the effective HTTP proxy environment variable is unset, configured, or invalid. The variable name and value are not collected.' };
	httpsProxyEnvironmentState?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the effective HTTPS proxy environment variable is unset, configured, or invalid. The variable name and value are not collected.' };
	allProxyEnvironmentState?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the effective all-proxy environment variable is unset, configured, or invalid. The variable name and value are not collected.' };
	noProxyEnvironmentState?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the effective no-proxy environment variable is unset, configured, or invalid. The variable name and value are not collected.' };
	wpadDhcpState?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The DHCP WPAD inspection state. Discovered URLs and errors are not collected.' };
	wpadDnsState?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The DNS WPAD inspection state. Discovered URLs and errors are not collected.' };
	configuredPacState?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The configured PAC inspection state. Configured URLs and errors are not collected.' };
	hasConfiguredPac?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether the operating system has a PAC URL configured. The URL is not collected.' };
	hasLoadedPac?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether a PAC script was discovered and loaded. The URL and script contents are not collected.' };
	pacSource?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'How the loaded PAC script was selected (wpad-dhcp, wpad-dns, configured, unknown, or none).' };
	pacScriptCharacterCount?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Number of characters in the loaded PAC script. The script contents are not collected.' };
	pacScriptLineCount?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Number of lines in the loaded PAC script. The script contents are not collected.' };
	pacScriptReturnCount?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Number of return keyword occurrences in the loaded PAC script. The script contents are not collected.' };
	hasHttpProxy?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether normalized static HTTP proxy settings are present. Proxy addresses are not collected.' };
	hasHttpsProxy?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether normalized static HTTPS proxy settings are present. Proxy addresses are not collected.' };
	hasSocksProxy?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether normalized static SOCKS proxy settings are present. Proxy addresses are not collected.' };
	hasBypassRules?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether operating system proxy bypass rules are present. Bypass entries are not collected.' };
	excludeSimpleHostnames?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether macOS excludes simple hostnames from proxying. Undefined on other platforms.' };
	owner: 'chrmarti';
	comment: 'Tracks categorized operating system proxy configuration after startup without collecting proxy addresses, URLs, scripts, bypass entries, or error text.';
};

export class CodeApplication extends Disposable {

	private static readonly SECURITY_PROTOCOL_HANDLING_CONFIRMATION_SETTING_KEY = {
		[Schemas.file]: 'security.promptForLocalFileProtocolHandling' as const,
		[Schemas.vscodeRemote]: 'security.promptForRemoteFileProtocolHandling' as const
	};

	private windowsMainService: IWindowsMainService | undefined;
	private auxiliaryWindowsMainService: IAuxiliaryWindowsMainService | undefined;
	private nativeHostMainService: INativeHostMainService | undefined;

	constructor(
		private readonly mainProcessNodeIpcServer: NodeIPCServer,
		private readonly userEnv: IProcessEnvironment,
		@IInstantiationService private readonly mainInstantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@ILoggerService private readonly loggerService: ILoggerService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStateService private readonly stateService: IStateService,
		@IFileService private readonly fileService: IFileService,
		@IProductService private readonly productService: IProductService,
		@IUserDataProfilesMainService private readonly userDataProfilesMainService: IUserDataProfilesMainService
	) {
		super();

		this.configureSession();
		this.registerListeners();
	}

	private configureSession(): void {


		const isUrlFromWindow = (requestingUrl?: string | undefined) => requestingUrl?.startsWith(`${Schemas.vscodeFileResource}://${VSCODE_AUTHORITY}`);
		const isUrlFromWebview = (requestingUrl: string | undefined) => requestingUrl?.startsWith(`${Schemas.vscodeWebview}://`);
		const isUrlFromAuxiliaryWindow = (webContents: Electron.WebContents | null, requestingUrl: string | undefined, isMainFrame: boolean) =>
			isMainFrame && requestingUrl === 'about:blank' && !!(webContents && this.auxiliaryWindowsMainService?.getWindowByWebContents(webContents));
		const isRequestFromWindow = (webContents: Electron.WebContents | null, requestingUrl: string | undefined, isMainFrame: boolean) =>
			isUrlFromWindow(requestingUrl) || isUrlFromAuxiliaryWindow(webContents, requestingUrl, isMainFrame);

		const alwaysAllowedPermissions = new Set(['pointerLock', 'notifications']);

		const allowedPermissionsInWebview = new Set([
			...alwaysAllowedPermissions,
			'clipboard-read',
			'clipboard-sanitized-write',
			'deprecated-sync-clipboard-read',
		]);

		const allowedPermissionsInCore = new Set([
			...alwaysAllowedPermissions,
			'media',
			'local-fonts',
			'deprecated-sync-clipboard-read',
		]);

		session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
			if (isUrlFromWebview(details.requestingUrl)) {
				return callback(allowedPermissionsInWebview.has(permission));
			}
			if (isRequestFromWindow(webContents, details.requestingUrl, details.isMainFrame)) {
				return callback(allowedPermissionsInCore.has(permission));
			}
			return callback(false);
		});

		session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
			if (isUrlFromWebview(details.requestingUrl)) {
				return allowedPermissionsInWebview.has(permission);
			}
			if (isRequestFromWindow(webContents, details.requestingUrl, details.isMainFrame)) {
				return allowedPermissionsInCore.has(permission);
			}
			return false;
		});

		let cachedScreenSources: Electron.DesktopCapturerSource[] | undefined;
		const invalidateScreenSourceCache = () => {
			cachedScreenSources = undefined;
		};
		electronScreen.on('display-added', invalidateScreenSourceCache);
		electronScreen.on('display-removed', invalidateScreenSourceCache);
		electronScreen.on('display-metrics-changed', invalidateScreenSourceCache);
		this._register(toDisposable(() => {
			electronScreen.off('display-added', invalidateScreenSourceCache);
			electronScreen.off('display-removed', invalidateScreenSourceCache);
			electronScreen.off('display-metrics-changed', invalidateScreenSourceCache);
		}));
		session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
			try {
				const frame = request.frame;
				const win = frame ? BrowserWindow.getAllWindows().find(w => w.webContents.mainFrame === frame) : undefined;

				const displays = electronScreen.getAllDisplays();
				let targetDisplay = displays[0];
				if (win) {
					const winBounds = win.getBounds();
					targetDisplay = electronScreen.getDisplayNearestPoint({
						x: winBounds.x + winBounds.width / 2,
						y: winBounds.y + winBounds.height / 2,
					});
				}

				if (!cachedScreenSources) {
					cachedScreenSources = await desktopCapturer.getSources({
						types: ['screen'],
						thumbnailSize: { width: 0, height: 0 },
					});
				}

				let match = cachedScreenSources.find(s => s.display_id === String(targetDisplay.id));
				if (!match) {
					cachedScreenSources = await desktopCapturer.getSources({
						types: ['screen'],
						thumbnailSize: { width: 0, height: 0 },
					});
					match = cachedScreenSources.find(s => s.display_id === String(targetDisplay.id));
				}

				const chosen = match ?? cachedScreenSources[0];
				if (!chosen) {
					callback({});
					return;
				}
				callback({ video: chosen });
			} catch {
				callback({});
			}
		});



		const supportedSvgSchemes = new Set([Schemas.file, Schemas.vscodeFileResource, Schemas.vscodeRemoteResource, Schemas.vscodeManagedRemoteResource, 'devtools']);

		const isSafeFrame = (requestFrame: WebFrameMain | null | undefined): boolean => {
			for (let frame: WebFrameMain | null | undefined = requestFrame; frame; frame = frame.parent) {
				if (frame.isDestroyed()) {
					return false;
				}
				if (frame.url.startsWith(`${Schemas.vscodeWebview}://`)) {
					return true;
				}
			}
			return false;
		};

		const isSvgRequestFromSafeContext = (details: Electron.OnBeforeRequestListenerDetails | Electron.OnHeadersReceivedListenerDetails): boolean => {
			return details.resourceType === 'xhr' || isSafeFrame(details.frame);
		};

		const isAllowedVsCodeFileRequest = (details: Electron.OnBeforeRequestListenerDetails) => {
			const frame = details.frame;
			if (!frame || frame.isDestroyed() || !this.windowsMainService) {
				return false;
			}

			const windows = getAllWindowsExcludingOffscreen();
			for (const window of windows) {
				if (frame.processId === window.webContents.mainFrame.processId) {
					return true;
				}
			}

			return false;
		};

		const isAllowedWebviewRequest = (uri: URI, details: Electron.OnBeforeRequestListenerDetails): boolean => {
			if (uri.path !== '/index.html') {
				return true;
			}

			const frame = details.frame;
			if (!frame || frame.isDestroyed() || !this.windowsMainService) {
				return false;
			}

			for (const window of this.windowsMainService.getWindows()) {
				if (window.win) {
					if (frame.processId === window.win.webContents.mainFrame.processId) {
						return true;
					}
				}
			}

			return false;
		};

		session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
			const uri = URI.parse(details.url);
			if (uri.scheme === Schemas.vscodeWebview) {
				if (!isAllowedWebviewRequest(uri, details)) {
					this.logService.error('Blocked vscode-webview request', details.url);
					return callback({ cancel: true });
				}
			}

			if (uri.scheme === Schemas.vscodeFileResource) {
				if (!isAllowedVsCodeFileRequest(details)) {
					this.logService.error('Blocked vscode-file request', details.url);
					return callback({ cancel: true });
				}
			}

			if (uri.path.endsWith('.svg')) {
				const isSafeResourceUrl = supportedSvgSchemes.has(uri.scheme);
				if (!isSafeResourceUrl) {
					return callback({ cancel: !isSvgRequestFromSafeContext(details) });
				}
			}

			return callback({ cancel: false });
		});

		session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
			const responseHeaders = details.responseHeaders as Record<string, (string) | (string[])>;
			const contentTypes = (responseHeaders['content-type'] || responseHeaders['Content-Type']);

			if (contentTypes && Array.isArray(contentTypes)) {
				const uri = URI.parse(details.url);
				if (uri.path.endsWith('.svg')) {
					if (supportedSvgSchemes.has(uri.scheme)) {
						responseHeaders['Content-Type'] = ['image/svg+xml'];

						return callback({ cancel: false, responseHeaders });
					}
				}

				if (!uri.path.endsWith(Schemas.vscodeRemoteResource) && contentTypes.some(contentType => contentType.toLowerCase().includes('image/svg'))) {
					return callback({ cancel: !isSvgRequestFromSafeContext(details) });
				}
			}

			return callback({ cancel: false });
		});



		session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
			if (details.url.startsWith('http://127.0.0.1:25128') || details.url.startsWith('http://localhost:25128')) {
				const responseHeaders = details.responseHeaders ?? Object.create(null);
				responseHeaders['Access-Control-Allow-Origin'] = ['*'];
				responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD'];
				responseHeaders['Access-Control-Allow-Headers'] = ['*'];
				responseHeaders['Access-Control-Allow-Private-Network'] = ['true'];
				responseHeaders['Access-Control-Expose-Headers'] = ['*'];
				return callback({ cancel: false, responseHeaders });
			}

			if (details.url.startsWith('https://vscode.download.prss.microsoft.com/')) {
				const responseHeaders = details.responseHeaders ?? Object.create(null);

				if (responseHeaders['Access-Control-Allow-Origin'] === undefined) {
					responseHeaders['Access-Control-Allow-Origin'] = ['*'];
					return callback({ cancel: false, responseHeaders });
				}
			}

			return callback({ cancel: false });
		});



		type SessionWithCodeCachePathSupport = Session & {
			setCodeCachePath?(path: string): void;
		};

		const defaultSession = session.defaultSession as unknown as SessionWithCodeCachePathSupport;
		if (typeof defaultSession.setCodeCachePath === 'function' && this.environmentMainService.codeCachePath) {
			defaultSession.setCodeCachePath(join(this.environmentMainService.codeCachePath, 'chrome'));
		}



		if (isWindows) {
			if (this.configurationService.getValue('security.restrictUNCAccess') === false) {
				disableUNCAccessRestrictions();
			} else {
				addUNCHostToAllowlist(this.configurationService.getValue('security.allowedUNCHosts'));
			}
		}

	}

	private registerListeners(): void {

		Event.once(this.lifecycleMainService.onWillShutdown)(() => this.dispose());

		registerContextMenuListener();

		app.on('accessibility-support-changed', (event, accessibilitySupportEnabled) => {
			this.windowsMainService?.sendToAll('vscode:accessibilitySupportChanged', accessibilitySupportEnabled);
		});

		app.on('activate', async (event, hasVisibleWindows) => {
			this.logService.trace('app#activate');

			if (!hasVisibleWindows) {
				await this.windowsMainService?.openEmptyWindow({ context: OpenContext.DOCK });
			}
		});

		app.on('web-contents-created', (event, contents) => {

			if (contents?.opener?.url.startsWith(`${Schemas.vscodeFileResource}://${VSCODE_AUTHORITY}/`)) {
				this.logService.trace('[aux window]  app.on("web-contents-created"): Registering auxiliary window');

				this.auxiliaryWindowsMainService?.registerWindow(contents);
			}

			contents.on('will-navigate', (event, navigationUrl) => {
				if (BrowserViewMainService.isBrowserViewWebContents(contents)) {
					return;
				}

				if (navigationUrl && (navigationUrl.startsWith('http://localhost:25128') || navigationUrl.startsWith('http://127.0.0.1:25128'))) {
					return;
				}

				this.logService.error('webContents#will-navigate: Prevented webcontent navigation');

				event.preventDefault();
			});

			contents.setWindowOpenHandler(details => {

				if (details.url === 'about:blank') {
					this.logService.trace('[aux window] webContents#setWindowOpenHandler: Allowing auxiliary window to open on about:blank');

					return {
						action: 'allow',
						overrideBrowserWindowOptions: this.auxiliaryWindowsMainService?.createWindow(details)
					};
				}

				else {
					this.logService.trace(`webContents#setWindowOpenHandler: Prevented opening window with URL ${details.url}}`);

					this.nativeHostMainService?.openExternal(undefined, details.url);

					return { action: 'deny' };
				}
			});
		});


		let macOpenFileURIs: IWindowOpenable[] = [];
		let runningTimeout: Timeout | undefined = undefined;
		app.on('open-file', (event, path) => {
			path = normalizeNFC(path);

			this.logService.trace('app#open-file: ', path);
			event.preventDefault();

			macOpenFileURIs.push(hasWorkspaceFileExtension(path) ? { workspaceUri: URI.file(path) } : { fileUri: URI.file(path) });

			if (runningTimeout !== undefined) {
				clearTimeout(runningTimeout);
				runningTimeout = undefined;
			}

			runningTimeout = setTimeout(async () => {
				await this.windowsMainService?.open({
					context: OpenContext.DOCK ,
					cli: this.environmentMainService.args,
					urisToOpen: macOpenFileURIs,
					gotoLineMode: false,
					preferNewWindow: true
				});

				macOpenFileURIs = [];
				runningTimeout = undefined;
			}, 100);
		});

		app.on('new-window-for-tab', async () => {
			await this.windowsMainService?.openEmptyWindow({ context: OpenContext.DESKTOP });
		});


		validatedIpcMain.handle('vscode:fetchShellEnv', event => {

			const window = this.windowsMainService?.getWindowByWebContents(event.sender);
			let args: NativeParsedArgs;
			let env: IProcessEnvironment;
			if (window?.config) {
				args = window.config;
				env = { ...process.env, ...window.config.userEnv };
			} else {
				args = this.environmentMainService.args;
				env = process.env;
			}

			return this.resolveShellEnvironment(args, env, false);
		});

		validatedIpcMain.on('vscode:toggleDevTools', event => event.sender.toggleDevTools());
		validatedIpcMain.on('vscode:openDevTools', event => event.sender.openDevTools());

		let dardcorRouterProcess: ChildProcess | null = null;
		let isAppQuitting = false;
		const startDardcorRouterProcess = async () => {
			if (dardcorRouterProcess && !dardcorRouterProcess.killed) {
				return;
			}
			const routerPort = Number(process.env.DARDCOR_PORT) || 25128;
			const checkPort = (port: number, timeoutMs = 600) => new Promise<boolean>(resolve => {
				const socket = createConnection({ port, host: '127.0.0.1' }, () => {
					socket.end();
					resolve(true);
				});
				socket.on('error', () => resolve(false));
				socket.setTimeout(timeoutMs, () => {
					socket.destroy();
					resolve(false);
				});
			});
			if (process.env['DARDCOR_ROUTER_MANAGED'] === '1') {
				for (let i = 0; i < 50; i++) {
					if (await checkPort(routerPort, 300)) {
						this.logService.info(`[Dardcor Router] Server is ready on port ${routerPort} (managed by start script).`);
						return;
					}
					await new Promise(r => setTimeout(r, 200));
				}
			}

			let isPortListening = await checkPort(routerPort, 600);
			if (!isPortListening) {
				await new Promise(r => setTimeout(r, 200));
				isPortListening = await checkPort(routerPort, 1000);
			}

			if (isPortListening) {
				this.logService.info(`[Dardcor Router] Server is already listening on port ${routerPort}.`);
				return;
			}

			const candidateDirs = [
				join(this.environmentMainService.appRoot, '.dardcor-router'),
				
				join(dirname(this.environmentMainService.appRoot), '.dardcor-router'),
				
			];
			const dardcorRouterDir = candidateDirs.find(d => existsSync(d)) || candidateDirs[0];
			const standaloneCandidates = [
				join(dardcorRouterDir, 'custom-server.js'),
				join(dardcorRouterDir, 'server.js'),
				join(dardcorRouterDir, '.next', 'standalone', 'custom-server.js'),
				join(dardcorRouterDir, '.next', 'standalone', 'server.js')
			];
			const standaloneServer = standaloneCandidates.find(p => existsSync(p));
			const nextBin = join(dardcorRouterDir, 'node_modules', 'next', 'dist', 'bin', 'next');
			const dataDir = process.env['DARDCOR_DATA_DIR'] || join(homedir(), '.dardcor', 'provider');
			const legacyDataDir = existsSync(join(homedir(), '.dardcor', 'router'))
				? join(homedir(), '.dardcor', 'router')
				: join(homedir(), '.dardcor-router');
			try {
				const legacyDb = join(legacyDataDir, 'db', 'database.json');
				const targetDb = join(dataDir, 'db', 'database.json');
				if (existsSync(legacyDb)) {
					const legacySize = existsSync(legacyDb) ? statSync(legacyDb).size : 0;
					const targetSize = existsSync(targetDb) ? statSync(targetDb).size : 0;
					if (!existsSync(targetDb) || targetSize < legacySize) {
						cpSync(legacyDataDir, dataDir, { recursive: true, force: true });
						this.logService.info('[Dardcor Router] Migrated database from legacy Dardcor Router to .dardcor/provider');
					}
				}
			} catch (err) {
				this.logService.warn('[Dardcor Router] Legacy database auto-migration skipped:', err);
			}

			const env = {
				...process.env,
				PORT: '25128',
				HOSTNAME: '127.0.0.1',
				DATA_DIR: dataDir,
				ELECTRON_RUN_AS_NODE: '1'
			};

			try {
				if (isLinux) {
					try { execFileSync('fuser', ['-k', '25128/tcp'], { stdio: 'ignore' }); } catch { }
				} else if (isMacintosh) {
					try {
						const pids = execFileSync('lsof', ['-ti:25128'], { encoding: 'utf8' }).trim();
						if (pids) {
							for (const pid of pids.split('\n')) {
								const num = parseInt(pid.trim(), 10);
								if (!isNaN(num) && num > 0 && num !== process.pid) {
									try { process.kill(num, 'SIGKILL'); } catch { }
								}
							}
						}
					} catch { }
				} else if (isWindows) {
					try {
						const netstat = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
						for (const line of netstat.split('\n')) {
							if (line.includes(':25128') && line.includes('LISTENING')) {
								const parts = line.trim().split(/\s+/);
								const pidStr = parts[parts.length - 1];
								const pidNum = parseInt(pidStr, 10);
								if (!isNaN(pidNum) && pidNum > 0 && pidNum !== process.pid) {
									try { execFileSync('taskkill', ['/F', '/PID', String(pidNum)], { stdio: 'ignore' }); } catch { }
								}
							}
						}
					} catch { }
				}
				const attachProcessListeners = (proc: typeof dardcorRouterProcess) => {
					if (!proc) {
						return;
					}
					let stdoutRemainder = '';
					proc.stdout?.on('data', (data: Buffer | string) => {
						stdoutRemainder += data.toString();
						const lines = stdoutRemainder.split(/\r?\n/);
						stdoutRemainder = lines.pop() ?? '';
						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed) continue;
							if (trimmed.startsWith('data:') || trimmed.includes('[STREAM]')) continue;
							const safeMsg = trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
							this.logService.info('[Dardcor Router]', safeMsg);
						}
					});
					let stderrRemainder = '';
					proc.stderr?.on('data', (data: Buffer | string) => {
						stderrRemainder += data.toString();
						const lines = stderrRemainder.split(/\r?\n/);
						stderrRemainder = lines.pop() ?? '';
						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed) continue;
							const safeMsg = trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
							this.logService.warn('[Dardcor Router]', safeMsg);
						}
					});
					proc.on('exit', (code, sig) => {
						this.logService.info('[Dardcor Router] Process exited', code, sig);
						if (dardcorRouterProcess === proc) {
							dardcorRouterProcess = null;
							if (!isAppQuitting) {
								setTimeout(() => {
									if (!dardcorRouterProcess && !isAppQuitting) {
										this.logService.info('[Dardcor Router] Auto-recovering router process...');
										void startDardcorRouterProcess();
									}
								}, 1500);
							}
						}
					});
					proc.on('error', (err: NodeJS.ErrnoException) => {
						this.logService.error('[Dardcor Router] Process error', err);
						if (err && err.code === 'ENOENT' && proc === dardcorRouterProcess && proc.spawnfile !== process.execPath) {
							try {
								dardcorRouterProcess = standaloneServer ? spawnServer(process.execPath) : null;
								attachProcessListeners(dardcorRouterProcess);
							} catch { }
						}
					});
				};

				let spawnServer: (cmd: string) => typeof dardcorRouterProcess = () => null;
				if (standaloneServer) {
					const standaloneCwd = dirname(standaloneServer);
					spawnServer = (cmd: string) => spawn(cmd, [standaloneServer, '--port', '25128'], {
						cwd: standaloneCwd,
						env,
						stdio: ['ignore', 'pipe', 'pipe']
					});
					const preferredCmd = this.environmentMainService.isBuilt ? process.execPath : 'node';
					try {
						dardcorRouterProcess = spawnServer(preferredCmd);
					} catch {
						try {
							dardcorRouterProcess = spawnServer(preferredCmd === process.execPath ? 'node' : process.execPath);
						} catch {
							dardcorRouterProcess = fork(standaloneServer, ['--port', '25128'], {
								cwd: standaloneCwd,
								env,
								stdio: ['ignore', 'pipe', 'pipe']
							});
						}
					}
				} else if (existsSync(nextBin)) {
					try {
						dardcorRouterProcess = spawn('node', [nextBin, 'dev', '--webpack', '--port', '25128'], {
							cwd: dardcorRouterDir,
							env,
							stdio: ['ignore', 'pipe', 'pipe']
						});
					} catch {
						dardcorRouterProcess = fork(nextBin, ['dev', '--webpack', '--port', '25128'], {
							cwd: dardcorRouterDir,
							env,
							stdio: ['ignore', 'pipe', 'pipe']
						});
					}
				}
				attachProcessListeners(dardcorRouterProcess);
			} catch (e) {
				this.logService.error('Failed to start built-in Dardcor Router', e);
			}
		};

		void startDardcorRouterProcess();

		app.on('will-quit', () => {
			isAppQuitting = true;
			if (dardcorRouterProcess) {
				try {
					if (isWindows && dardcorRouterProcess.pid) {
						execFileSync('taskkill', ['/F', '/T', '/PID', String(dardcorRouterProcess.pid)], { stdio: 'ignore' });
					} else {
						dardcorRouterProcess.kill();
					}
				} catch { }
				dardcorRouterProcess = null;
			}
		});

		validatedIpcMain.on('vscode:reloadWindow', event => event.sender.reload());

		validatedIpcMain.handle('vscode:notifyZoomLevel', async (event, zoomLevel: number | undefined) => {
			const window = this.windowsMainService?.getWindowByWebContents(event.sender);
			if (window) {
				window.notifyZoomLevel(zoomLevel);
			}
		});

	}

	async startup(): Promise<void> {
		this.logService.debug('Starting Dardcor Code');
		this.logService.debug(`from: ${this.environmentMainService.appRoot}`);
		this.logService.debug('args:', this.environmentMainService.args);

		const win32AppUserModelId = this.productService.win32AppUserModelId;
		if (isWindows) {
			if (!this.environmentMainService.isBuilt) {
				app.setAppUserModelId(process.execPath);
			} else if (win32AppUserModelId) {
				app.setAppUserModelId(win32AppUserModelId);
			}
		}

		try {
			if (isMacintosh && this.configurationService.getValue('window.nativeTabs') === true && !systemPreferences.getUserDefault('NSUseImprovedLayoutPass', 'boolean')) {
				systemPreferences.setUserDefault('NSUseImprovedLayoutPass', 'boolean', true);
			}
		} catch (error) {
			this.logService.error(error);
		}

		const mainProcessElectronServer = new ElectronIPCServer();
		Event.once(this.lifecycleMainService.onWillShutdown)(e => {
			if (e.reason === ShutdownReason.KILL) {
				mainProcessElectronServer.dispose();
			}
		});

		const [machineId, sqmId, devDeviceId] = await Promise.all([
			resolveMachineId(this.stateService, this.logService),
			resolveSqmId(this.stateService, this.logService),
			resolveDevDeviceId(this.stateService, this.logService)
		]);

		const { sharedProcessReady, sharedProcessClient } = this.setupSharedProcess(machineId, sqmId, devDeviceId);

		const appInstantiationService = await this.initServices(machineId, sqmId, devDeviceId, sharedProcessReady);

		appInstantiationService.invokeFunction(accessor => this._register(new ErrorTelemetry(accessor.get(ILogService), accessor.get(ITelemetryService))));

		const agentHostStarter = this._register(appInstantiationService.createInstance(ElectronAgentHostStarter, { machineId, sqmId, devDeviceId }));
		this._register(appInstantiationService.createInstance(AgentHostProcessManager, agentHostStarter, process.platform));

		appInstantiationService.invokeFunction(accessor => {
			(accessor.get(IMeteredConnectionService) as MeteredConnectionMainService).setTelemetryService(accessor.get(ITelemetryService));
		});

		appInstantiationService.invokeFunction(accessor => accessor.get(IProxyAuthService));

		this._register(appInstantiationService.createInstance(UserDataProfilesHandler));

		appInstantiationService.invokeFunction(accessor => this.initChannels(accessor, mainProcessElectronServer, sharedProcessClient));

		const initialProtocolUrls = await appInstantiationService.invokeFunction(accessor => this.setupProtocolUrlHandlers(accessor, mainProcessElectronServer));

		this.setupManagedRemoteResourceUrlHandler(mainProcessElectronServer);

		this.lifecycleMainService.phase = LifecycleMainPhase.Ready;

		await appInstantiationService.invokeFunction(accessor => this.openFirstWindow(accessor, initialProtocolUrls));

		this.lifecycleMainService.phase = LifecycleMainPhase.AfterWindowOpen;

		this.afterWindowOpen(appInstantiationService);

		const eventuallyPhaseScheduler = this._register(new RunOnceScheduler(() => {
			this._register(runWhenGlobalIdle(() => {

				this.lifecycleMainService.phase = LifecycleMainPhase.Eventually;

				this.eventuallyAfterWindowOpen(appInstantiationService);
			}, 2500));
		}, 2500));
		eventuallyPhaseScheduler.schedule();
	}

	private async setupProtocolUrlHandlers(accessor: ServicesAccessor, mainProcessElectronServer: ElectronIPCServer): Promise<IInitialProtocolUrls | undefined> {
		const windowsMainService = this.windowsMainService = accessor.get(IWindowsMainService);
		const urlService = accessor.get(IURLService);
		const nativeHostMainService = this.nativeHostMainService = accessor.get(INativeHostMainService);
		const dialogMainService = accessor.get(IDialogMainService);


		const app = this;
		urlService.registerHandler({
			async handleURL(uri: URI, options?: IOpenURLOptions): Promise<boolean> {
				return app.handleProtocolUrl(windowsMainService, dialogMainService, urlService, uri, options);
			}
		});

		const activeWindowManager = this._register(new ActiveWindowManager({
			onDidOpenMainWindow: nativeHostMainService.onDidOpenMainWindow,
			onDidFocusMainWindow: nativeHostMainService.onDidFocusMainWindow,
			getActiveWindowId: () => nativeHostMainService.getActiveWindowId(-1)
		}));
		const activeWindowRouter = new StaticRouter(ctx => activeWindowManager.getActiveClientId().then(id => ctx === id));
		const urlHandlerRouter = new URLHandlerRouter(activeWindowRouter, this.logService);
		const urlHandlerChannel = mainProcessElectronServer.getChannel('urlHandler', urlHandlerRouter);
		urlService.registerHandler(new URLHandlerChannelClient(urlHandlerChannel));

		const initialProtocolUrls = await this.resolveInitialProtocolUrls(windowsMainService, dialogMainService);
		this._register(new ElectronURLListener(initialProtocolUrls?.urls, urlService, windowsMainService, this.environmentMainService, this.productService, this.logService));

		return initialProtocolUrls;
	}

	private setupManagedRemoteResourceUrlHandler(mainProcessElectronServer: ElectronIPCServer) {
		const notFound = (): Electron.ProtocolResponse => ({ statusCode: 404, data: 'Not found' });
		const remoteResourceChannel = new Lazy(() => mainProcessElectronServer.getChannel(
			NODE_REMOTE_RESOURCE_CHANNEL_NAME,
			new NodeRemoteResourceRouter(),
		));

		protocol.registerBufferProtocol(Schemas.vscodeManagedRemoteResource, (request, callback) => {
			const url = URI.parse(request.url);
			if (!url.authority.startsWith('window:')) {
				return callback(notFound());
			}

			remoteResourceChannel.value.call<NodeRemoteResourceResponse>(NODE_REMOTE_RESOURCE_IPC_METHOD_NAME, [url]).then(
				r => callback({ ...r, data: Buffer.from(r.body, 'base64') }),
				err => {
					this.logService.warn('error dispatching remote resource call', err);
					callback({ statusCode: 500, data: String(err) });
				});
		});
	}

	private async resolveInitialProtocolUrls(windowsMainService: IWindowsMainService, dialogMainService: IDialogMainService): Promise<IInitialProtocolUrls | undefined> {


		const protocolUrlsFromCommandLine = this.environmentMainService.args['open-url'] ? this.environmentMainService.args._urls || [] : [];
		if (protocolUrlsFromCommandLine.length > 0) {
			this.logService.trace('app#resolveInitialProtocolUrls() protocol urls from command line:', protocolUrlsFromCommandLine);
		}

		const protocolUrlsFromEvent = ((global as { getOpenUrls?: () => string[] }).getOpenUrls?.() || []);
		if (protocolUrlsFromEvent.length > 0) {
			this.logService.trace(`app#resolveInitialProtocolUrls() protocol urls from macOS 'open-url' event:`, protocolUrlsFromEvent);
		}

		if (protocolUrlsFromCommandLine.length + protocolUrlsFromEvent.length === 0) {
			return undefined;
		}

		const protocolUrls = [
			...protocolUrlsFromCommandLine,
			...protocolUrlsFromEvent
		].map(url => {
			try {
				return { uri: URI.parse(url), originalUrl: url };
			} catch {
				this.logService.trace('app#resolveInitialProtocolUrls() protocol url failed to parse:', url);

				return undefined;
			}
		});

		const openables: IWindowOpenable[] = [];
		const urls: IProtocolUrl[] = [];

		for (const protocolUrl of protocolUrls) {
			if (!protocolUrl) {
				continue;
			}

			const windowOpenable = this.getWindowOpenableFromProtocolUrl(protocolUrl.uri);
			if (windowOpenable) {
				if (await this.shouldBlockOpenable(windowOpenable, windowsMainService, dialogMainService)) {
					this.logService.trace('app#resolveInitialProtocolUrls() protocol url was blocked:', protocolUrl.uri.toString(true));

					continue;
				} else {
					this.logService.trace('app#resolveInitialProtocolUrls() protocol url will be handled as window to open:', protocolUrl.uri.toString(true), windowOpenable);

					openables.push(windowOpenable);
				}
			} else {
				this.logService.trace('app#resolveInitialProtocolUrls() protocol url will be passed to active window for handling:', protocolUrl.uri.toString(true));

				urls.push(protocolUrl);
			}
		}

		return { urls, openables };
	}

	private async shouldBlockOpenable(openable: IWindowOpenable, windowsMainService: IWindowsMainService, dialogMainService: IDialogMainService): Promise<boolean> {
		let openableUri: URI;
		let message: string;
		if (isWorkspaceToOpen(openable)) {
			openableUri = openable.workspaceUri;
			message = localize('confirmOpenMessageWorkspace', "An external application wants to open '{0}' in {1}. Do you want to open this workspace file?", openableUri.scheme === Schemas.file ? getPathLabel(openableUri, { os: OS, tildify: this.environmentMainService }) : openableUri.toString(true), this.productService.nameShort);
		} else if (isFolderToOpen(openable)) {
			openableUri = openable.folderUri;
			message = localize('confirmOpenMessageFolder', "An external application wants to open '{0}' in {1}. Do you want to open this folder?", openableUri.scheme === Schemas.file ? getPathLabel(openableUri, { os: OS, tildify: this.environmentMainService }) : openableUri.toString(true), this.productService.nameShort);
		} else {
			openableUri = openable.fileUri;
			message = localize('confirmOpenMessageFileOrFolder', "An external application wants to open '{0}' in {1}. Do you want to open this file or folder?", openableUri.scheme === Schemas.file ? getPathLabel(openableUri, { os: OS, tildify: this.environmentMainService }) : openableUri.toString(true), this.productService.nameShort);
		}

		if (openableUri.scheme !== Schemas.file && openableUri.scheme !== Schemas.vscodeRemote) {


			return false;
		}

		const askForConfirmation = this.configurationService.getValue<unknown>(CodeApplication.SECURITY_PROTOCOL_HANDLING_CONFIRMATION_SETTING_KEY[openableUri.scheme]);
		if (askForConfirmation === false) {
			return false;
		}

		const { response, checkboxChecked } = await dialogMainService.showMessageBox({
			type: 'warning',
			buttons: [
				localize({ key: 'open', comment: ['&& denotes a mnemonic'] }, "&&Yes"),
				localize({ key: 'cancel', comment: ['&& denotes a mnemonic'] }, "&&No")
			],
			message,
			detail: localize('confirmOpenDetail', "If you did not initiate this request, it may represent an attempted attack on your system. Unless you took an explicit action to initiate this request, you should press 'No'"),
			checkboxLabel: openableUri.scheme === Schemas.file ? localize('doNotAskAgainLocal', "Allow opening local paths without asking") : localize('doNotAskAgainRemote', "Allow opening remote paths without asking"),
			cancelId: 1
		});

		if (response !== 0) {
			return true;
		}

		if (checkboxChecked) {
			const request = { channel: 'vscode:disablePromptForProtocolHandling', args: openableUri.scheme === Schemas.file ? 'local' : 'remote' };
			windowsMainService.sendToFocused(request.channel, request.args);
			windowsMainService.sendToOpeningWindow(request.channel, request.args);
		}

		return false;
	}

	private getWindowOpenableFromProtocolUrl(uri: URI): IWindowOpenable | undefined {
		if (!uri.path) {
			return undefined;
		}

		if (uri.authority === Schemas.file) {
			const fileUri = URI.file(uri.fsPath);

			if (hasWorkspaceFileExtension(fileUri)) {
				return { workspaceUri: fileUri };
			}

			return { fileUri };
		}

		else if (uri.authority === Schemas.vscodeRemote) {


			const secondSlash = uri.path.indexOf(posix.sep, 1 );
			let authority: string;
			let path: string;
			if (secondSlash !== -1) {
				authority = uri.path.substring(1, secondSlash);
				path = uri.path.substring(secondSlash);
			} else {
				authority = uri.path.substring(1);
				path = '/';
			}

			let query = uri.query;
			const params = new URLSearchParams(uri.query);
			if (params.get('windowId') === '_blank') {
				params.delete('windowId');
				query = params.toString();
			}

			const remoteUri = URI.from({ scheme: Schemas.vscodeRemote, authority, path, query, fragment: uri.fragment });

			if (hasWorkspaceFileExtension(path)) {
				return { workspaceUri: remoteUri };
			}

			if (/:[\d]+$/.test(path)) {
				return { fileUri: remoteUri };
			}

			return { folderUri: remoteUri };
		}
		return undefined;
	}

	private async handleProtocolUrl(windowsMainService: IWindowsMainService, dialogMainService: IDialogMainService, urlService: IURLService, uri: URI, options?: IOpenURLOptions): Promise<boolean> {
		this.logService.trace('app#handleProtocolUrl():', uri.toString(true), options);

		if (uri.scheme === this.productService.urlProtocol && uri.path === 'workspace') {
			uri = uri.with({
				authority: Schemas.file,
				path: URI.parse(uri.query).path,
				query: ''
			});
		}

		let shouldOpenInNewWindow = false;

		const params = new URLSearchParams(uri.query);
		if (params.get('windowId') === '_blank') {
			this.logService.trace(`app#handleProtocolUrl() found 'windowId=_blank' as parameter, setting shouldOpenInNewWindow=true:`, uri.toString(true));

			params.delete('windowId');
			uri = uri.with({ query: params.toString() });

			shouldOpenInNewWindow = true;
		}

		else if (isMacintosh && windowsMainService.getWindowCount() === 0) {
			this.logService.trace(`app#handleProtocolUrl() running on macOS with no window open, setting shouldOpenInNewWindow=true:`, uri.toString(true));

			shouldOpenInNewWindow = true;
		}

		const continueOn = params.get('continueOn');
		if (continueOn !== null) {
			this.logService.trace(`app#handleProtocolUrl() found 'continueOn' as parameter:`, uri.toString(true));

			params.delete('continueOn');
			uri = uri.with({ query: params.toString() });

			this.environmentMainService.continueOn = continueOn ?? undefined;
		}

		const session = params.get('session');
		if (session !== null) {
			this.logService.trace(`app#handleProtocolUrl() found 'session' as parameter:`, uri.toString(true));

			params.delete('session');
			uri = uri.with({ query: params.toString() });
		}

		const windowOpenableFromProtocolUrl = this.getWindowOpenableFromProtocolUrl(uri);
		if (windowOpenableFromProtocolUrl) {
			if (await this.shouldBlockOpenable(windowOpenableFromProtocolUrl, windowsMainService, dialogMainService)) {
				this.logService.trace('app#handleProtocolUrl() protocol url was blocked:', uri.toString(true));

				return true;
			} else {
				this.logService.trace('app#handleProtocolUrl() opening protocol url as window:', windowOpenableFromProtocolUrl, uri.toString(true));

				const window = (await windowsMainService.open({
					context: OpenContext.LINK,
					cli: { ...this.environmentMainService.args },
					urisToOpen: [windowOpenableFromProtocolUrl],
					forceNewWindow: shouldOpenInNewWindow,
					gotoLineMode: true
				})).at(0);

				window?.focus();

				if (window && session) {
					window.sendWhenReady('vscode:openChatSession', CancellationToken.None, session);
				}

				return true;
			}
		}

		if (shouldOpenInNewWindow) {
			this.logService.trace('app#handleProtocolUrl() opening empty window and passing in protocol url:', uri.toString(true));

			const window = (await windowsMainService.open({
				context: OpenContext.LINK,
				cli: { ...this.environmentMainService.args },
				forceNewWindow: true,
				forceEmpty: true,
				gotoLineMode: true,
				remoteAuthority: getRemoteAuthority(uri)
			})).at(0);

			await window?.ready();

			return urlService.open(uri, options);
		}

		this.logService.trace('app#handleProtocolUrl(): not handled', uri.toString(true), options);

		return false;
	}

	private setupSharedProcess(machineId: string, sqmId: string, devDeviceId: string): { sharedProcessReady: Promise<MessagePortClient>; sharedProcessClient: Promise<MessagePortClient> } {
		const sharedProcess = this._register(this.mainInstantiationService.createInstance(SharedProcess, machineId, sqmId, devDeviceId));

		this._register(sharedProcess.onDidCrash(() => this.windowsMainService?.sendToFocused('vscode:reportSharedProcessCrash')));

		const sharedProcessClient = (async () => {
			this.logService.trace('Main->SharedProcess#connect');

			const port = await sharedProcess.connect();

			this.logService.trace('Main->SharedProcess#connect: connection established');

			return new MessagePortClient(port, 'main');
		})();

		const sharedProcessReady = (async () => {
			await sharedProcess.whenReady();

			return sharedProcessClient;
		})();

		return { sharedProcessReady, sharedProcessClient };
	}

	private async initServices(machineId: string, sqmId: string, devDeviceId: string, sharedProcessReady: Promise<MessagePortClient>): Promise<IInstantiationService> {
		const services = new ServiceCollection();

		switch (process.platform) {
			case 'win32':
				services.set(IUpdateService, new SyncDescriptor(Win32UpdateService));
				break;

			case 'linux':
				if (isLinuxSnap) {
					services.set(IUpdateService, new SyncDescriptor(SnapUpdateService, [process.env['SNAP'], process.env['SNAP_REVISION']]));
				} else {
					services.set(IUpdateService, new SyncDescriptor(LinuxUpdateService));
				}
				break;

			case 'darwin':
				services.set(IUpdateService, new SyncDescriptor(DarwinUpdateService));
				break;
		}

		services.set(IWindowsMainService, new SyncDescriptor(WindowsMainService, [machineId, sqmId, devDeviceId, this.userEnv], false));
		services.set(IAuxiliaryWindowsMainService, new SyncDescriptor(AuxiliaryWindowsMainService, undefined, false));

		const dialogMainService = new DialogMainService(this.logService, this.productService);
		services.set(IDialogMainService, dialogMainService);

		services.set(ILaunchMainService, new SyncDescriptor(LaunchMainService, undefined, false ));

		services.set(IDiagnosticsMainService, new SyncDescriptor(DiagnosticsMainService, undefined, false ));
		services.set(IDiagnosticsService, ProxyChannel.toService(getDelayedChannel(sharedProcessReady.then(client => client.getChannel('diagnostics')))));

		services.set(IEncryptionMainService, new SyncDescriptor(EncryptionMainService));

		services.set(IBrowserViewMainService, new SyncDescriptor(BrowserViewMainService, undefined, false ));
		services.set(IBrowserViewGroupMainService, new SyncDescriptor(BrowserViewGroupMainService, undefined, false ));

		services.set(IKeyboardLayoutMainService, new SyncDescriptor(KeyboardLayoutMainService));

		services.set(INativeHostMainService, new SyncDescriptor(NativeHostMainService, undefined, false ));

		services.set(IGlobalKeybindingsMainService, new SyncDescriptor(GlobalKeybindingsMainService, [globalShortcut]));

		const meteredConnectionService = new MeteredConnectionMainService(this.configurationService);
		services.set(IMeteredConnectionService, meteredConnectionService);

		services.set(ITerminalSandboxService, new SyncDescriptor(NullTerminalSandboxService));
		services.set(IAgentNetworkFilterService, new SyncDescriptor(AgentNetworkFilterService, undefined, true));
		services.set(IWebContentExtractorService, new SyncDescriptor(NativeWebContentExtractorService, undefined, false ));

		services.set(IWebviewManagerService, new SyncDescriptor(WebviewMainService));

		services.set(IMenubarMainService, new SyncDescriptor(MenubarMainService));

		services.set(IExtensionHostStarter, new SyncDescriptor(ExtensionHostStarter));

		services.set(IStorageMainService, new SyncDescriptor(StorageMainService));
		services.set(IApplicationStorageMainService, new SyncDescriptor(ApplicationStorageMainService));

		const ptyHostStarter = new ElectronPtyHostStarter({
			graceTime: LocalReconnectConstants.GraceTime,
			shortGraceTime: LocalReconnectConstants.ShortGraceTime,
			scrollback: this.configurationService.getValue<number>(TerminalSettingId.PersistentSessionScrollback) ?? 100
		}, this.configurationService, this.environmentMainService, this.lifecycleMainService, this.logService);
		const ptyHostService = new PtyHostService(
			ptyHostStarter,
			this.configurationService,
			this.logService,
			this.loggerService
		);
		services.set(ILocalPtyService, ptyHostService);

		if (isWindows) {
			services.set(IExternalTerminalMainService, new SyncDescriptor(WindowsExternalTerminalService));
		} else if (isMacintosh) {
			services.set(IExternalTerminalMainService, new SyncDescriptor(MacExternalTerminalService));
		} else if (isLinux) {
			services.set(IExternalTerminalMainService, new SyncDescriptor(LinuxExternalTerminalService));
		}
		services.set(ISandboxHelperMainService, new SyncDescriptor(SandboxHelperService));

		const backupMainService = new BackupMainService(this.environmentMainService, this.configurationService, this.logService, this.stateService);
		services.set(IBackupMainService, backupMainService);

		const workspacesManagementMainService = new WorkspacesManagementMainService(this.environmentMainService, this.logService, this.userDataProfilesMainService, backupMainService, dialogMainService);
		services.set(IWorkspacesManagementMainService, workspacesManagementMainService);
		services.set(IWorkspacesService, new SyncDescriptor(WorkspacesMainService, undefined, false ));
		services.set(IWorkspacesHistoryMainService, new SyncDescriptor(WorkspacesHistoryMainService, undefined, false));

		services.set(IURLService, new SyncDescriptor(NativeURLService, undefined, false ));

		if (supportsTelemetry(this.productService, this.environmentMainService)) {
			const isInternal = isInternalTelemetry(this.productService, this.configurationService);
			const channel = getDelayedChannel(sharedProcessReady.then(client => client.getChannel('telemetryAppender')));
			const appender = new TelemetryAppenderClient(channel);
			const commonProperties = resolveCommonProperties(release(), hostname(), process.arch, this.productService.commit, this.productService.version, machineId, sqmId, devDeviceId, isInternal, this.productService.date);
			const piiPaths = getPiiPathsFromEnvironment(this.environmentMainService);
			const config: ITelemetryServiceConfig = { appenders: [appender], commonProperties, piiPaths, sendErrorTelemetry: true };

			services.set(ITelemetryService, new SyncDescriptor(TelemetryService, [config], false));
		} else {
			services.set(ITelemetryService, NullTelemetryService);
		}

		services.set(IExtensionsProfileScannerService, new SyncDescriptor(ExtensionsProfileScannerService, undefined, true));
		services.set(IExtensionsScannerService, new SyncDescriptor(ExtensionsScannerService, undefined, true));

		services.set(IUtilityProcessWorkerMainService, new SyncDescriptor(UtilityProcessWorkerMainService, undefined, true));

		services.set(IProxyAuthService, new SyncDescriptor(ProxyAuthService));

		services.set(INativeMcpDiscoveryHelperService, new SyncDescriptor(NativeMcpDiscoveryHelperService));
		services.set(IMcpGatewayService, new SyncDescriptor(McpGatewayService));

		services.set(ICSSDevelopmentService, new SyncDescriptor(CSSDevelopmentService, undefined, true));

		await Promises.settled([
			backupMainService.initialize(),
			workspacesManagementMainService.initialize()
		]);

		return this.mainInstantiationService.createChild(services);
	}

	private initChannels(accessor: ServicesAccessor, mainProcessElectronServer: ElectronIPCServer, sharedProcessClient: Promise<MessagePortClient>): void {


		const disposables = this._register(new DisposableStore());

		const launchChannel = ProxyChannel.fromService(accessor.get(ILaunchMainService), disposables, { disableMarshalling: true });
		this.mainProcessNodeIpcServer.registerChannel('launch', launchChannel);

		const diagnosticsChannel = ProxyChannel.fromService(accessor.get(IDiagnosticsMainService), disposables, { disableMarshalling: true });
		this.mainProcessNodeIpcServer.registerChannel('diagnostics', diagnosticsChannel);

		const policyChannel = disposables.add(new PolicyChannel(accessor.get(IPolicyService)));
		mainProcessElectronServer.registerChannel('policy', policyChannel);
		sharedProcessClient.then(client => client.registerChannel('policy', policyChannel));

		const nativeManagedSettingsChannel = disposables.add(new NativeManagedSettingsChannel(accessor.get(INativeManagedSettingsService)));
		mainProcessElectronServer.registerChannel('nativeManagedSettings', nativeManagedSettingsChannel);

		const fileManagedSettingsChannel = disposables.add(new FileManagedSettingsChannel(accessor.get(IFileManagedSettingsService)));
		mainProcessElectronServer.registerChannel('fileManagedSettings', fileManagedSettingsChannel);

		const diskFileSystemProvider = this.fileService.getProvider(Schemas.file);
		assertType(diskFileSystemProvider instanceof DiskFileSystemProvider);
		const fileSystemProviderChannel = disposables.add(new DiskFileSystemProviderChannel(diskFileSystemProvider, this.logService, this.environmentMainService));
		mainProcessElectronServer.registerChannel(LOCAL_FILE_SYSTEM_CHANNEL_NAME, fileSystemProviderChannel);
		sharedProcessClient.then(client => client.registerChannel(LOCAL_FILE_SYSTEM_CHANNEL_NAME, fileSystemProviderChannel));

		const userDataProfilesService = ProxyChannel.fromService(accessor.get(IUserDataProfilesMainService), disposables);
		mainProcessElectronServer.registerChannel('userDataProfiles', userDataProfilesService);
		sharedProcessClient.then(client => client.registerChannel('userDataProfiles', userDataProfilesService));

		const updateService = accessor.get(IUpdateService);
		const updateChannel = new UpdateChannel(updateService);
		mainProcessElectronServer.registerChannel('update', updateChannel);

		this._register(new NotAvailableUpdateDialog(updateService, accessor.get(IDialogMainService), accessor.get(IWindowsMainService)));

		const meteredConnectionChannel = new MeteredConnectionChannel(accessor.get(IMeteredConnectionService) as MeteredConnectionMainService);
		mainProcessElectronServer.registerChannel(METERED_CONNECTION_CHANNEL, meteredConnectionChannel);
		sharedProcessClient.then(client => client.registerChannel(METERED_CONNECTION_CHANNEL, meteredConnectionChannel));

		const processChannel = ProxyChannel.fromService(new ProcessMainService(this.logService, accessor.get(IDiagnosticsService), accessor.get(IDiagnosticsMainService)), disposables);
		mainProcessElectronServer.registerChannel('process', processChannel);

		const encryptionChannel = ProxyChannel.fromService(accessor.get(IEncryptionMainService), disposables);
		mainProcessElectronServer.registerChannel('encryption', encryptionChannel);

		const browserViewChannel = ProxyChannel.fromService(accessor.get(IBrowserViewMainService), disposables);
		mainProcessElectronServer.registerChannel(ipcBrowserViewChannelName, browserViewChannel);
		sharedProcessClient.then(client => client.registerChannel(ipcBrowserViewChannelName, browserViewChannel));

		const browserViewGroupChannel = ProxyChannel.fromService(accessor.get(IBrowserViewGroupMainService), disposables);
		mainProcessElectronServer.registerChannel(ipcBrowserViewGroupChannelName, browserViewGroupChannel);
		sharedProcessClient.then(client => client.registerChannel(ipcBrowserViewGroupChannelName, browserViewGroupChannel));

		const signChannel = ProxyChannel.fromService(accessor.get(ISignService), disposables);
		mainProcessElectronServer.registerChannel('sign', signChannel);

		const keyboardLayoutChannel = ProxyChannel.fromService(accessor.get(IKeyboardLayoutMainService), disposables);
		mainProcessElectronServer.registerChannel('keyboardLayout', keyboardLayoutChannel);

		this.nativeHostMainService = accessor.get(INativeHostMainService);
		const nativeHostChannel = ProxyChannel.fromService(this.nativeHostMainService, disposables, {
			unbufferedEvents: ['onDidBlurMainWindow']
		});
		mainProcessElectronServer.registerChannel('nativeHost', nativeHostChannel);
		sharedProcessClient.then(client => client.registerChannel('nativeHost', nativeHostChannel));

		const webContentExtractorChannel = ProxyChannel.fromService(accessor.get(IWebContentExtractorService), disposables);
		mainProcessElectronServer.registerChannel('webContentExtractor', webContentExtractorChannel);

		const workspacesChannel = ProxyChannel.fromService(accessor.get(IWorkspacesService), disposables);
		mainProcessElectronServer.registerChannel('workspaces', workspacesChannel);

		const menubarChannel = ProxyChannel.fromService(accessor.get(IMenubarMainService), disposables);
		mainProcessElectronServer.registerChannel('menubar', menubarChannel);

		const urlChannel = ProxyChannel.fromService(accessor.get(IURLService), disposables);
		mainProcessElectronServer.registerChannel('url', urlChannel);

		const webviewChannel = ProxyChannel.fromService(accessor.get(IWebviewManagerService), disposables);
		mainProcessElectronServer.registerChannel('webview', webviewChannel);

		const storageChannel = disposables.add((new StorageDatabaseChannel(this.logService, accessor.get(IStorageMainService))));
		mainProcessElectronServer.registerChannel('storage', storageChannel);
		sharedProcessClient.then(client => client.registerChannel('storage', storageChannel));

		const profileStorageListener = disposables.add((new ProfileStorageChangesListenerChannel(accessor.get(IStorageMainService), accessor.get(IUserDataProfilesMainService), this.logService)));
		sharedProcessClient.then(client => client.registerChannel('profileStorageListener', profileStorageListener));

		const ptyHostChannel = ProxyChannel.fromService(accessor.get(ILocalPtyService), disposables, {
			unbufferedEvents: ['onProcessData', 'onProcessReady', 'onProcessExit', 'onProcessOverrideDimensions', 'onProcessResolvedShellLaunchConfig', 'onProcessTitleChanged', 'onDidChangeProperty']
		});
		mainProcessElectronServer.registerChannel(TerminalIpcChannels.LocalPty, ptyHostChannel);

		const externalTerminalChannel = ProxyChannel.fromService(accessor.get(IExternalTerminalMainService), disposables);
		mainProcessElectronServer.registerChannel('externalTerminal', externalTerminalChannel);

		const sandboxHelperChannel = ProxyChannel.fromService(accessor.get(ISandboxHelperMainService), disposables);
		mainProcessElectronServer.registerChannel('sandboxHelper', sandboxHelperChannel);

		const mcpDiscoveryChannel = ProxyChannel.fromService(accessor.get(INativeMcpDiscoveryHelperService), disposables);
		mainProcessElectronServer.registerChannel(NativeMcpDiscoveryHelperChannelName, mcpDiscoveryChannel);
		const mcpGatewayChannel = this._register(new McpGatewayChannel(mainProcessElectronServer, accessor.get(IMcpGatewayService), accessor.get(ILoggerMainService)));
		mainProcessElectronServer.registerChannel(McpGatewayChannelName, mcpGatewayChannel);

		const loggerChannel = this._register(new LoggerChannel(accessor.get(ILoggerMainService)));
		mainProcessElectronServer.registerChannel('logger', loggerChannel);
		sharedProcessClient.then(client => client.registerChannel('logger', loggerChannel));

		const electronExtensionHostDebugBroadcastChannel = new ElectronExtensionHostDebugBroadcastChannel(accessor.get(IWindowsMainService));
		mainProcessElectronServer.registerChannel('extensionhostdebugservice', electronExtensionHostDebugBroadcastChannel);

		const extensionHostStarterChannel = ProxyChannel.fromService(accessor.get(IExtensionHostStarter), disposables);
		mainProcessElectronServer.registerChannel(ipcExtensionHostStarterChannelName, extensionHostStarterChannel);

		const utilityProcessWorkerChannel = ProxyChannel.fromService(accessor.get(IUtilityProcessWorkerMainService), disposables);
		mainProcessElectronServer.registerChannel(ipcUtilityProcessWorkerChannelName, utilityProcessWorkerChannel);
	}

	private async openFirstWindow(accessor: ServicesAccessor, initialProtocolUrls: IInitialProtocolUrls | undefined): Promise<ICodeWindow[]> {
		const windowsMainService = this.windowsMainService = accessor.get(IWindowsMainService);
		this.auxiliaryWindowsMainService = accessor.get(IAuxiliaryWindowsMainService);

		const context = isLaunchedFromCli(process.env) ? OpenContext.CLI : OpenContext.DESKTOP;
		const args = this.environmentMainService.args;

		if (initialProtocolUrls) {

			if (initialProtocolUrls.openables.length > 0) {
				return windowsMainService.open({
					context,
					cli: args,
					urisToOpen: initialProtocolUrls.openables,
					gotoLineMode: true,
					initialStartup: true
				});
			}


			if (initialProtocolUrls.urls.length > 0) {
				for (const protocolUrl of initialProtocolUrls.urls) {
					const params = new URLSearchParams(protocolUrl.uri.query);
					if (params.get('windowId') === '_blank') {


						params.delete('windowId');
						protocolUrl.originalUrl = protocolUrl.uri.toString(true);
						protocolUrl.uri = protocolUrl.uri.with({ query: params.toString() });

						return windowsMainService.open({
							context,
							cli: args,
							forceNewWindow: true,
							forceEmpty: true,
							gotoLineMode: true,
							initialStartup: true
						});
					}
				}
			}
		}

		const macOpenFiles: string[] = (global as { macOpenFiles?: string[] }).macOpenFiles ?? [];
		const hasCliArgs = args._.length;
		const hasFolderURIs = !!args['folder-uri'];
		const hasFileURIs = !!args['file-uri'];
		const noRecentEntry = args['skip-add-to-recently-opened'] === true;
		const waitMarkerFileURI = args.wait && args.waitMarkerFilePath ? URI.file(args.waitMarkerFilePath) : undefined;
		const remoteAuthority = args.remote || undefined;
		const forceProfile = args.profile;
		const forceTempProfile = args['profile-temp'];

		if (!hasCliArgs && !hasFolderURIs && !hasFileURIs) {

			if (args['new-window'] || forceProfile || forceTempProfile) {
				return windowsMainService.open({
					context,
					cli: args,
					forceNewWindow: true,
					forceEmpty: true,
					noRecentEntry,
					waitMarkerFileURI,
					initialStartup: true,
					remoteAuthority,
					forceProfile,
					forceTempProfile
				});
			}

			if (macOpenFiles.length) {
				return windowsMainService.open({
					context: OpenContext.DOCK,
					cli: args,
					urisToOpen: macOpenFiles.map(path => {
						path = normalizeNFC(path);

						return (hasWorkspaceFileExtension(path) ? { workspaceUri: URI.file(path) } : { fileUri: URI.file(path) });
					}),
					noRecentEntry,
					waitMarkerFileURI,
					initialStartup: true,
				});
			}
		}

		return windowsMainService.open({
			context,
			cli: args,
			forceNewWindow: args['new-window'],
			diffMode: args.diff,
			mergeMode: args.merge,
			noRecentEntry,
			waitMarkerFileURI,
			gotoLineMode: args.goto,
			initialStartup: true,
			remoteAuthority,
			forceProfile,
			forceTempProfile
		});
	}

	private afterWindowOpen(instantiationService: IInstantiationService): void {

		if (isWindows) {
			initWindowsVersionInfo();
		}

		this.installMutex();

		protocol.registerHttpProtocol(Schemas.vscodeRemoteResource, (request, callback) => {
			callback({
				url: request.url.replace(/^vscode-remote-resource:/, 'http:'),
				method: request.method
			});
		});

		this.resolveShellEnvironment(this.environmentMainService.args, process.env, true);

		this.updateCrashReporterEnablement();

		if (isMacintosh && app.runningUnderARM64Translation) {
			this.windowsMainService?.sendToFocused('vscode:showTranslatedBuildWarning');
		}

		instantiationService.invokeFunction(accessor => {
			const telemetryService = accessor.get(ITelemetryService);

			type PowerEvent = {
				readonly idleState: string;
				readonly idleTime: number;
				readonly thermalState: string;
				readonly onBattery: boolean;
			};
			type PowerEventClassification = {
				idleState: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The system idle state (active, idle, locked, unknown).' };
				idleTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The system idle time in seconds.' };
				thermalState: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The system thermal state (unknown, nominal, fair, serious, critical).' };
				onBattery: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Whether the system is running on battery power.' };
				owner: 'chrmarti';
				comment: 'Tracks OS power suspend and resume events for reliability insights.';
			};

			const getPowerEventData = (): PowerEvent => ({
				idleState: powerMonitor.getSystemIdleState(60),
				idleTime: powerMonitor.getSystemIdleTime(),
				thermalState: powerMonitor.getCurrentThermalState(),
				onBattery: powerMonitor.isOnBatteryPower()
			});

			this._register(Event.fromNodeEventEmitter(powerMonitor, 'suspend')(() => {
				telemetryService.publicLog2<PowerEvent, PowerEventClassification>('power.suspend', getPowerEventData());
			}));

			this._register(Event.fromNodeEventEmitter(powerMonitor, 'resume')(() => {
				telemetryService.publicLog2<PowerEvent, PowerEventClassification>('power.resume', getPowerEventData());
			}));
		});

		if (isMacintosh) {
			instantiationService.invokeFunction(accessor => {
				const telemetryService = accessor.get(ITelemetryService);
				type GPUFeatureStatusWithSkiaGraphite = GPUFeatureStatus & {
					skia_graphite: string;
				};
				const initialGpuFeatureStatus = app.getGPUFeatureStatus() as GPUFeatureStatusWithSkiaGraphite;
				const skiaGraphiteEnabled: string = initialGpuFeatureStatus['skia_graphite'];
				if (skiaGraphiteEnabled === 'enabled') {
					const gpuInfoUpdate = Event.fromNodeEventEmitter(app, 'gpu-info-update');
					const pendingGpuInfoListener = this._register(new MutableDisposable());
					this._register(Event.fromNodeEventEmitter<{ details: Details }>(app, 'child-process-gone', (event, details) => ({ event, details }))(({ details }) => {
						if (details.type === 'GPU' && details.reason === 'crashed') {
							pendingGpuInfoListener.value = Event.once(gpuInfoUpdate)(() => {
								const currentGpuFeatureStatus = app.getGPUFeatureStatus();
								const currentRasterizationStatus: string = currentGpuFeatureStatus['rasterization'];
								if (currentRasterizationStatus !== 'enabled') {
									let gpuLogMessages: string[] = [];
									type AppWithGPULogMethod = typeof app & {
										getGPULogMessages(): IGPULogMessage[];
									};
									const customApp = app as AppWithGPULogMethod;
									if (typeof customApp.getGPULogMessages === 'function') {
										gpuLogMessages = customApp.getGPULogMessages().slice(-10).map(log => log.message);
									}

									type GpuCrashEvent = {
										readonly gpuFeatureStatus: string;
										readonly gpuLogMessages: string;
									};
									type GpuCrashClassification = {
										gpuFeatureStatus: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Current GPU feature status.' };
										gpuLogMessages: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Last 10 GPU log messages collected after the crash and GPU process restart.' };
										owner: 'deepak1556';
										comment: 'Tracks GPU process crashes that would result in fallback mode.';
									};

									telemetryService.publicLog2<GpuCrashEvent, GpuCrashClassification>('gpu.crash.fallback', {
										gpuFeatureStatus: JSON.stringify(currentGpuFeatureStatus),
										gpuLogMessages: JSON.stringify(gpuLogMessages)
									});
								}
							});
						}
					}));
				}
			});
		}

		{
			interface NetworkProcessLaunchedDetails {
				readonly pid: number;
			}
			interface NetworkProcessGoneDetails {
				readonly pid: number;
				readonly exitCode: number;
				readonly crashed: boolean;
				readonly crashedPreIPC: boolean;
			}

			type AppWithNetworkProcessEvents = typeof app & {
				on(event: 'network-process-launched', listener: (event: Electron.Event, details: NetworkProcessLaunchedDetails) => void): typeof app;
				on(event: 'network-process-gone', listener: (event: Electron.Event, details: NetworkProcessGoneDetails) => void): typeof app;
			};

			const customApp = app as AppWithNetworkProcessEvents;

			instantiationService.invokeFunction(accessor => {
				const telemetryService = accessor.get(ITelemetryService);

				type NetworkProcessLaunchedClassification = {
					owner: 'deepak1556';
					comment: 'Tracks network process launch events.';
				};

				type NetworkProcessGoneClassification = {
					exitCode: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The exit code of the network process.' };
					crashed: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the network process crashed.' };
					crashedPreIPC: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the network process crashed before IPC was established.' };
					owner: 'deepak1556';
					comment: 'Tracks network process gone events for reliability insights.';
				};

				this._register(Event.fromNodeEventEmitter<NetworkProcessLaunchedDetails>(customApp, 'network-process-launched', (_event, details) => details)(details => {
					this.logService.info(`[network process] launched with pid ${details.pid}`);

					telemetryService.publicLog2<{}, NetworkProcessLaunchedClassification>('networkProcess.launched', {});
				}));

				this._register(Event.fromNodeEventEmitter<NetworkProcessGoneDetails>(customApp, 'network-process-gone', (_event, details) => details)(details => {
					this.logService.info(`[network process] gone - pid: ${details.pid}, exitCode: ${details.exitCode}, crashed: ${details.crashed}, crashedPreIPC: ${details.crashedPreIPC}`);

					telemetryService.publicLog2<{ exitCode: number; crashed: boolean; crashedPreIPC: boolean }, NetworkProcessGoneClassification>('networkProcess.gone', {
						exitCode: details.exitCode,
						crashed: details.crashed,
						crashedPreIPC: details.crashedPreIPC
					});
				}));
			});
		}

	}

	private async installMutex(): Promise<void> {
		const win32MutexName = this.productService.win32MutexName;
		if (isWindows && win32MutexName && isInnoSetupInstall()) {
			try {
				const WindowsMutex = await import('@vscode/windows-mutex');
				const mutex = new WindowsMutex.Mutex(win32MutexName);
				Event.once(this.lifecycleMainService.onWillShutdown)(() => mutex.release());
			} catch (error) {
				this.logService.error(error);
			}
		}
	}

	private async resolveShellEnvironment(args: NativeParsedArgs, env: IProcessEnvironment, notifyOnError: boolean): Promise<typeof process.env> {
		try {
			return await getResolvedShellEnv(this.configurationService, this.logService, args, env);
		} catch (error) {
			const errorMessage = toErrorMessage(error);
			if (notifyOnError) {
				this.windowsMainService?.sendToFocused('vscode:showResolveShellEnvError', errorMessage);
			} else {
				this.logService.error(errorMessage);
			}
		}

		return {};
	}

	private async updateCrashReporterEnablement(): Promise<void> {


		try {
			const argvContent = await this.fileService.readFile(this.environmentMainService.argvResource);
			const argvString = argvContent.value.toString();
			const argvJSON = parse<{ 'enable-crash-reporter'?: boolean }>(argvString);
			const telemetryLevel = getTelemetryLevel(this.configurationService);
			const enableCrashReporter = telemetryLevel >= TelemetryLevel.CRASH;

			if (argvJSON['enable-crash-reporter'] === undefined) {
				const additionalArgvContent = [
					'',
					'	// Allows to disable crash reporting.',
					'	// Should restart the app if the value is changed.',
					`	"enable-crash-reporter": ${enableCrashReporter},`,
					'',
					'	// Unique id used for correlating crash reports sent from this instance.',
					'	// Do not edit this value.',
					`	"crash-reporter-id": "${generateUuid()}"`,
					'}'
				];
				const newArgvString = argvString.substring(0, argvString.length - 2).concat(',\n', additionalArgvContent.join('\n'));

				await this.fileService.writeFile(this.environmentMainService.argvResource, VSBuffer.fromString(newArgvString));
			}

			else {
				const newArgvString = argvString.replace(/"enable-crash-reporter": .*,/, `"enable-crash-reporter": ${enableCrashReporter},`);
				if (newArgvString !== argvString) {
					await this.fileService.writeFile(this.environmentMainService.argvResource, VSBuffer.fromString(newArgvString));
				}
			}
		} catch (error) {
			this.logService.error(error);

			this.windowsMainService?.sendToFocused('vscode:showArgvParseWarning');
		}
	}

	private eventuallyAfterWindowOpen(instantiationService: IInstantiationService): void {

		validateDevDeviceId(this.stateService, this.logService);

		instantiationService.invokeFunction(accessor => {
			const telemetryService = accessor.get(ITelemetryService);
			if (telemetryService.telemetryLevel < TelemetryLevel.USAGE) {
				return;
			}

			const nativeHostMainService = accessor.get(INativeHostMainService);
			void this.logOSProxyConfigTelemetry(nativeHostMainService, telemetryService);
		});
	}

	private async logOSProxyConfigTelemetry(nativeHostMainService: INativeHostMainService, telemetryService: ITelemetryService): Promise<void> {
		const startTime = Date.now();
		try {
			const config = await nativeHostMainService.readProxyConfigWithPackage(undefined);
			const durationMs = Date.now() - startTime;
			const pacScriptStats = config.pac ? getPACScriptStats(config.pac.content) : undefined;
			telemetryService.publicLog2<OSProxyConfigEvent, OSProxyConfigClassification>('osProxyConfig', {
				success: true,
				durationMs,
				platformKind: config.platform?.kind ?? 'none',
				autoDetect: config.autoDetect,
				httpProxyEnvironmentState: getOSProxyEnvironmentState(config.environment.httpProxy),
				httpsProxyEnvironmentState: getOSProxyEnvironmentState(config.environment.httpsProxy),
				allProxyEnvironmentState: getOSProxyEnvironmentState(config.environment.allProxy),
				noProxyEnvironmentState: getOSProxyEnvironmentState(config.environment.noProxy),
				wpadDhcpState: config.wpadDhcp.state,
				wpadDnsState: config.wpadDns.state,
				configuredPacState: config.configuredPac.state,
				hasConfiguredPac: !!config.pacUrl,
				hasLoadedPac: !!config.pac,
				pacSource: config.pac?.source ?? 'none',
				pacScriptCharacterCount: pacScriptStats?.characterCount,
				pacScriptLineCount: pacScriptStats?.lineCount,
				pacScriptReturnCount: pacScriptStats?.returnCount,
				hasHttpProxy: !!config.staticRules?.http,
				hasHttpsProxy: !!config.staticRules?.https,
				hasSocksProxy: !!config.staticRules?.socks,
				hasBypassRules: hasOSProxyBypassRules(config),
				excludeSimpleHostnames: config.platform?.kind === 'macos' ? config.platform.excludeSimpleHostnames : undefined,
			});
		} catch {
			telemetryService.publicLog2<OSProxyConfigEvent, OSProxyConfigClassification>('osProxyConfig', {
				success: false,
				durationMs: Date.now() - startTime,
			});
		}
	}
}

function hasOSProxyBypassRules(config: IOSProxyConfig): boolean {
	switch (config.platform?.kind) {
		case 'windows': return !!config.platform.proxyBypass;
		case 'macos': return config.platform.excludeSimpleHostnames || config.platform.exceptions.length > 0;
		case 'linux': return config.platform.ignoreHosts.length > 0;
		default: return false;
	}
}

function getOSProxyEnvironmentState(status: IOSProxyConfig['environment']['httpProxy']): 'unset' | 'configured' | 'invalid' {
	return status ? status.error ? 'invalid' : 'configured' : 'unset';
}

function getPACScriptStats(content: string): { characterCount: number; lineCount: number; returnCount: number } {
	return {
		characterCount: content.length,
		lineCount: content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length,
		returnCount: content.match(/\breturn\b/g)?.length ?? 0,
	};
}
