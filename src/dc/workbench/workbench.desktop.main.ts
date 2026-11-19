/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/




import './workbench.common.main.js';




import './electron-browser/desktop.main.js';
import './electron-browser/desktop.contribution.js';




import './electron-browser/parts/dialogs/dialog.contribution.js';




import './services/textfile/electron-browser/nativeTextFileService.js';
import './services/dialogs/electron-browser/fileDialogService.js';
import './services/workspaces/electron-browser/workspacesService.js';
import './services/menubar/electron-browser/menubarService.js';
import './services/update/electron-browser/updateService.js';
import './services/url/electron-browser/urlService.js';
import './services/lifecycle/electron-browser/lifecycleService.js';
import './services/title/electron-browser/titleService.js';
import './services/host/electron-browser/nativeHostService.js';
import '../platform/meteredConnection/electron-browser/meteredConnectionService.js';
import './services/request/electron-browser/requestService.js';
import './services/clipboard/electron-browser/clipboardService.js';
import './services/contextmenu/electron-browser/contextmenuService.js';
import './services/workspaces/electron-browser/workspaceEditingService.js';
import './services/configurationResolver/electron-browser/configurationResolverService.js';
import './services/accessibility/electron-browser/accessibilityService.js';
import './services/keybinding/electron-browser/nativeKeyboardLayout.js';
import './services/path/electron-browser/pathService.js';
import './services/themes/electron-browser/nativeHostColorSchemeService.js';
import './services/extensionManagement/electron-browser/extensionManagementService.js';
import './services/mcp/electron-browser/mcpGalleryManifestService.js';
import './services/mcp/electron-browser/mcpWorkbenchManagementService.js';
import './services/encryption/electron-browser/encryptionService.js';
import './services/imageResize/electron-browser/imageResizeService.js';
import './services/localTranscription/electron-browser/localTranscriptionService.js';
import './services/secrets/electron-browser/secretStorageService.js';
import './services/localization/electron-browser/languagePackService.js';
import './services/telemetry/electron-browser/telemetryService.js';
import './services/extensions/electron-browser/extensionHostStarter.js';
import '../platform/extensionResourceLoader/common/extensionResourceLoaderService.js';
import './services/localization/electron-browser/localeService.js';
import './services/extensions/electron-browser/extensionsScannerService.js';
import './services/extensionManagement/electron-browser/extensionManagementServerService.js';
import './services/extensionManagement/electron-browser/extensionGalleryManifestService.js';
import './services/extensionManagement/electron-browser/extensionTipsService.js';
import './services/userDataSync/electron-browser/userDataSyncService.js';
import './services/userDataSync/electron-browser/userDataAutoSyncService.js';
import './services/timer/electron-browser/timerService.js';
import './services/environment/electron-browser/shellEnvironmentService.js';
import './services/integrity/electron-browser/integrityService.js';
import './services/workingCopy/electron-browser/workingCopyBackupService.js';
import './services/checksum/electron-browser/checksumService.js';
import '../platform/remote/electron-browser/sharedProcessTunnelService.js';
import './services/tunnel/electron-browser/tunnelService.js';
import '../platform/diagnostics/electron-browser/diagnosticsService.js';
import '../platform/profiling/electron-browser/profilingService.js';
import '../platform/telemetry/electron-browser/customEndpointTelemetryService.js';
import '../platform/remoteTunnel/electron-browser/remoteTunnelService.js';
import './services/files/electron-browser/elevatedFileService.js';
import './services/search/electron-browser/searchService.js';
import './services/workingCopy/electron-browser/workingCopyHistoryService.js';
import './services/userDataSync/browser/userDataSyncEnablementService.js';
import './services/extensions/electron-browser/nativeExtensionService.js';
import '../platform/userDataProfile/electron-browser/userDataProfileStorageService.js';
import './services/auxiliaryWindow/electron-browser/auxiliaryWindowService.js';
import '../platform/extensionManagement/electron-browser/extensionsProfileScannerService.js';
import '../platform/sandbox/electron-browser/sandboxHelperService.js';
import '../platform/webContentExtractor/electron-browser/webContentExtractorService.js';
import './services/agentHost/electron-browser/agentHostService.js';
import '../platform/agentHost/electron-browser/remoteAgentHostService.js';
import '../platform/agentHost/browser/agentHostEnablementService.js';
import './services/browserView/electron-browser/playwrightWorkbenchService.js';
import './services/process/electron-browser/processService.js';
import './services/power/electron-browser/powerService.js';

import { registerSingleton } from '../platform/instantiation/common/extensions.js';
import { IUserDataInitializationService, UserDataInitializationService } from './services/userData/browser/userDataInit.js';
import { SyncDescriptor } from '../platform/instantiation/common/descriptors.js';

registerSingleton(IUserDataInitializationService, new SyncDescriptor(UserDataInitializationService, [[]], true));





import './contrib/logs/electron-browser/logs.contribution.js';

import './contrib/localization/electron-browser/localization.contribution.js';

import './contrib/files/electron-browser/fileActions.contribution.js';

import './contrib/codeEditor/electron-browser/codeEditor.contribution.js';

import './contrib/debug/electron-browser/extensionHostDebugService.js';

import './contrib/extensions/electron-browser/extensions.contribution.js';
import './contrib/extensions/electron-browser/devtoolsExtensionHost.contribution.js';

import './contrib/issue/electron-browser/issue.contribution.js';

import './contrib/surveys/browser/survey.contribution.js';

import './contrib/processExplorer/electron-browser/processExplorer.contribution.js';

import './contrib/remote/electron-browser/remote.contribution.js';

import './contrib/terminal/electron-browser/terminal.contribution.js';

import './contrib/themes/browser/themes.test.contribution.js';
import './services/themes/electron-browser/themes.contribution.js';
import './contrib/userDataSync/electron-browser/userDataSync.contribution.js';

import './contrib/tags/electron-browser/workspaceTagsService.js';
import './contrib/tags/electron-browser/tags.contribution.js';
import './contrib/performance/electron-browser/performance.contribution.js';

import './contrib/tasks/electron-browser/taskService.js';

import './contrib/externalTerminal/electron-browser/externalTerminal.contribution.js';

import './contrib/webview/electron-browser/webview.contribution.js';

import './contrib/browserView/electron-browser/browserView.contribution.js';

import './contrib/splash/electron-browser/splash.contribution.js';

import './contrib/localHistory/electron-browser/localHistory.contribution.js';

import './contrib/mergeEditor/electron-browser/mergeEditor.contribution.js';

import './contrib/multiDiffEditor/browser/multiDiffEditor.contribution.js';

import './contrib/remoteTunnel/electron-browser/remoteTunnel.contribution.js';

import './contrib/chat/electron-browser/chat.contribution.js';
import './contrib/chat/electron-browser/tunnelHost.contribution.js';

import './contrib/agentsVoice/electron-browser/agentsVoiceNativeCommands.js';

import './contrib/encryption/electron-browser/encryption.contribution.js';

import './contrib/emergencyAlert/electron-browser/emergencyAlert.contribution.js';

import './contrib/mcp/electron-browser/mcp.contribution.js';

import './contrib/policyExport/electron-browser/policyExport.contribution.js';

import './contrib/keybindingsExport/electron-browser/keybindingsExport.contribution.js';

import './contrib/keybindings/electron-browser/systemWideKeybindings.contribution.js';



export { main } from './electron-browser/desktop.main.js';
