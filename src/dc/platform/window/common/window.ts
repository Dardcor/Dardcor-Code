/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { IStringDictionary } from '../../../base/common/collections.js';
import { PerformanceMark } from '../../../base/common/performance.js';
import { isMacintosh, isNative, isWeb } from '../../../base/common/platform.js';
import { URI, UriComponents, UriDto } from '../../../base/common/uri.js';
import { ISandboxConfiguration } from '../../../base/parts/sandbox/common/sandboxTypes.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEditorOptions } from '../../editor/common/editor.js';
import { NativeParsedArgs } from '../../environment/common/argv.js';
import { FileType } from '../../files/common/files.js';
import { ILoggerResource, LogLevel } from '../../log/common/log.js';
import { PolicyDefinition, PolicyValue } from '../../policy/common/policy.js';
import { IPartsSplash } from '../../theme/common/themeService.js';
import { IUserDataProfile } from '../../userDataProfile/common/userDataProfile.js';
import { IAnyWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from '../../workspace/common/workspace.js';

export const WindowMinimumSize = {
	WIDTH: 400,
	WIDTH_WITH_VERTICAL_PANEL: 600,
	HEIGHT: 270
};

export interface IPoint {
	readonly x: number;
	readonly y: number;
}

export interface IRectangle extends IPoint {
	readonly width: number;
	readonly height: number;
}

export interface IBaseOpenWindowsOptions {

	readonly forceReuseWindow?: boolean;

	readonly remoteAuthority?: string | null;

	readonly forceProfile?: string;
	readonly forceTempProfile?: boolean;
}

export interface IOpenWindowOptions extends IBaseOpenWindowsOptions {
	readonly forceNewWindow?: boolean;
	readonly preferNewWindow?: boolean;

	readonly noRecentEntry?: boolean;

	readonly addMode?: boolean;
	readonly removeMode?: boolean;

	readonly diffMode?: boolean;
	readonly mergeMode?: boolean;
	readonly gotoLineMode?: boolean;

	readonly waitMarkerFileURI?: URI;

	readonly chatSessionToOpen?: URI;
}

export interface IAddRemoveFoldersRequest {
	readonly foldersToAdd: UriComponents[];
	readonly foldersToRemove: UriComponents[];
}

interface IOpenedWindow {
	readonly id: number;
	readonly title: string;
	readonly filename?: string;
}

export interface IOpenedMainWindow extends IOpenedWindow {
	readonly workspace?: IAnyWorkspaceIdentifier;
	readonly dirty: boolean;
}

export interface IOpenedAuxiliaryWindow extends IOpenedWindow {
	readonly parentId: number;
}

export function isOpenedAuxiliaryWindow(candidate: IOpenedMainWindow | IOpenedAuxiliaryWindow): candidate is IOpenedAuxiliaryWindow {
	return typeof (candidate as IOpenedAuxiliaryWindow).parentId === 'number';
}

export interface IOpenEmptyWindowOptions extends IBaseOpenWindowsOptions { }

export type IWindowOpenable = IWorkspaceToOpen | IFolderToOpen | IFileToOpen;

export interface IBaseWindowOpenable {
	label?: string;
}

export interface IWorkspaceToOpen extends IBaseWindowOpenable {
	readonly workspaceUri: URI;
}

export interface IFolderToOpen extends IBaseWindowOpenable {
	readonly folderUri: URI;
}

export interface IFileToOpen extends IBaseWindowOpenable {
	readonly fileUri: URI;
}

export function isWorkspaceToOpen(uriToOpen: IWindowOpenable): uriToOpen is IWorkspaceToOpen {
	return !!(uriToOpen as IWorkspaceToOpen).workspaceUri;
}

export function isFolderToOpen(uriToOpen: IWindowOpenable): uriToOpen is IFolderToOpen {
	return !!(uriToOpen as IFolderToOpen).folderUri;
}

export function isFileToOpen(uriToOpen: IWindowOpenable): uriToOpen is IFileToOpen {
	return !!(uriToOpen as IFileToOpen).fileUri;
}

export const enum MenuSettings {
	MenuStyle = 'window.menuStyle',
	MenuBarVisibility = 'window.menuBarVisibility'
}

export const enum MenuStyleConfiguration {
	CUSTOM = 'custom',
	NATIVE = 'native',
	INHERIT = 'inherit',
}

export function hasNativeContextMenu(configurationService: IConfigurationService, titleBarStyle?: TitlebarStyle): boolean {
	if (isWeb) {
		return false;
	}

	const nativeTitle = hasNativeTitlebar(configurationService, titleBarStyle);
	const windowConfigurations = configurationService.getValue<IWindowSettings | undefined>('window');

	if (windowConfigurations?.menuStyle === MenuStyleConfiguration.NATIVE) {
		if (!isMacintosh && !nativeTitle) {
			return false;
		}
		return true;
	}

	if (windowConfigurations?.menuStyle === MenuStyleConfiguration.CUSTOM) {
		return false;
	}

	return nativeTitle;
}

export function hasNativeMenu(configurationService: IConfigurationService, titleBarStyle?: TitlebarStyle): boolean {
	if (isWeb) {
		return false;
	}

	if (isMacintosh) {
		return true;
	}

	return hasNativeContextMenu(configurationService, titleBarStyle);
}

export type MenuBarVisibility = 'classic' | 'visible' | 'toggle' | 'hidden' | 'compact';

export function getMenuBarVisibility(configurationService: IConfigurationService): MenuBarVisibility {
	const menuBarVisibility = configurationService.getValue<MenuBarVisibility | 'default'>(MenuSettings.MenuBarVisibility);

	if (menuBarVisibility === 'default' || (menuBarVisibility === 'compact' && hasNativeMenu(configurationService)) || (isMacintosh && isNative)) {
		return 'classic';
	} else {
		return menuBarVisibility;
	}
}

export interface IWindowsConfiguration {
	readonly window: IWindowSettings;
}

export interface IWindowSettings {
	readonly openFilesInNewWindow: 'on' | 'off' | 'default';
	readonly openFoldersInNewWindow: 'on' | 'off' | 'default';
	readonly openWithoutArgumentsInNewWindow: 'on' | 'off';
	readonly restoreWindows: 'preserve' | 'all' | 'folders' | 'one' | 'none';
	readonly restoreFullscreen: boolean;
	readonly zoomLevel: number;
	readonly titleBarStyle: TitlebarStyle;
	readonly controlsStyle: WindowControlsStyle;
	readonly menuStyle: MenuStyleConfiguration;
	readonly autoDetectHighContrast: boolean;
	readonly autoDetectColorScheme: boolean;
	readonly menuBarVisibility: MenuBarVisibility;
	readonly newWindowDimensions: 'default' | 'inherit' | 'offset' | 'maximized' | 'fullscreen';
	readonly nativeTabs: boolean;
	readonly nativeFullScreen: boolean;
	readonly enableMenuBarMnemonics: boolean;
	readonly closeWhenEmpty: boolean;
	readonly clickThroughInactive: boolean;
	readonly newWindowProfile: string;
	readonly density: IDensitySettings;
	readonly border: 'off' | 'default' | 'system' | string ;
}

export interface IDensitySettings {
	readonly editorTabHeight: 'default' | 'compact';
}

export const enum TitleBarSetting {
	TITLE_BAR_STYLE = 'window.titleBarStyle',
	CUSTOM_TITLE_BAR_VISIBILITY = 'window.customTitleBarVisibility',
}

export const enum TitlebarStyle {
	NATIVE = 'native',
	CUSTOM = 'custom',
}

export const enum WindowControlsStyle {
	NATIVE = 'native',
	CUSTOM = 'custom',
	HIDDEN = 'hidden'
}

export const enum CustomTitleBarVisibility {
	AUTO = 'auto',
	WINDOWED = 'windowed',
	NEVER = 'never',
}

export function hasCustomTitlebar(configurationService: IConfigurationService, titleBarStyle?: TitlebarStyle): boolean {
	return true;
}

export function hasNativeTitlebar(configurationService: IConfigurationService, titleBarStyle?: TitlebarStyle): boolean {
	if (!titleBarStyle) {
		titleBarStyle = getTitleBarStyle(configurationService);
	}

	return titleBarStyle === TitlebarStyle.NATIVE;
}

export function getTitleBarStyle(configurationService: IConfigurationService): TitlebarStyle {
	if (isWeb) {
		return TitlebarStyle.CUSTOM;
	}

	const configuration = configurationService.getValue<IWindowSettings | undefined>('window');
	if (configuration) {
		const useNativeTabs = isMacintosh && configuration.nativeTabs === true;
		if (useNativeTabs) {
			return TitlebarStyle.NATIVE;
		}

		const useSimpleFullScreen = isMacintosh && configuration.nativeFullScreen === false;
		if (useSimpleFullScreen) {
			return TitlebarStyle.NATIVE;
		}

		const style = configuration.titleBarStyle;
		if (style === TitlebarStyle.NATIVE || style === TitlebarStyle.CUSTOM) {
			return style;
		}
	}

	return TitlebarStyle.CUSTOM;
}

export function getWindowControlsStyle(configurationService: IConfigurationService): WindowControlsStyle {
	if (isWeb || isMacintosh || getTitleBarStyle(configurationService) === TitlebarStyle.NATIVE) {
		return WindowControlsStyle.NATIVE;
	}

	const configuration = configurationService.getValue<IWindowSettings | undefined>('window');
	const style = configuration?.controlsStyle;
	if (style === WindowControlsStyle.CUSTOM || style === WindowControlsStyle.HIDDEN) {
		return style;
	}

	return WindowControlsStyle.NATIVE;
}

export const DEFAULT_CUSTOM_TITLEBAR_HEIGHT = 35;

export function useWindowControlsOverlay(configurationService: IConfigurationService): boolean {
	if (isWeb) {
		return false;
	}

	if (hasNativeTitlebar(configurationService)) {
		return false;
	}

	if (!isMacintosh) {
		const setting = getWindowControlsStyle(configurationService);
		if (setting === WindowControlsStyle.CUSTOM || setting === WindowControlsStyle.HIDDEN) {
			return false;
		}
	}

	return true;
}

export function useNativeFullScreen(configurationService: IConfigurationService): boolean {
	const windowConfig = configurationService.getValue<IWindowSettings | undefined>('window');
	if (!windowConfig || typeof windowConfig.nativeFullScreen !== 'boolean') {
		return true;
	}

	if (windowConfig.nativeTabs) {
		return true;
	}

	return windowConfig.nativeFullScreen !== false;
}


export interface IPath<T = IEditorOptions> extends IPathData<T> {

	fileUri?: URI;
}

export interface IPathData<T = IEditorOptions> {

	readonly fileUri?: UriComponents;

	readonly options?: T;

	readonly exists?: boolean;

	readonly type?: FileType;

	readonly openOnlyIfExists?: boolean;
}

export interface IPathsToWaitFor extends IPathsToWaitForData {
	paths: IPath[];
	waitMarkerFileUri: URI;
}

interface IPathsToWaitForData {
	readonly paths: IPathData[];
	readonly waitMarkerFileUri: UriComponents;
}

export interface IOpenFileRequest {
	readonly filesToOpenOrCreate?: IPathData[];
	readonly filesToDiff?: IPathData[];
	readonly filesToMerge?: IPathData[];
}

export interface INativeOpenFileRequest extends IOpenFileRequest {
	readonly termProgram?: string;
	readonly filesToWait?: IPathsToWaitForData;
}

export interface INativeRunActionInWindowRequest {
	readonly id: string;
	readonly from: 'menu' | 'touchbar' | 'mouse' | 'systemWideKeybinding';
	readonly args?: unknown[];
}

export interface INativeRunKeybindingInWindowRequest {
	readonly userSettingsLabel: string;
}

export interface IColorScheme {
	readonly dark: boolean;
	readonly highContrast: boolean;
}

export interface IWindowConfiguration {
	remoteAuthority?: string;

	filesToOpenOrCreate?: IPath[];
	filesToDiff?: IPath[];
	filesToMerge?: IPath[];
}

export interface IOSConfiguration {
	readonly release: string;
	readonly hostname: string;
	readonly arch: string;
}

export interface INativeWindowConfiguration extends IWindowConfiguration, NativeParsedArgs, ISandboxConfiguration {
	mainPid: number;
	handle?: VSBuffer;

	machineId: string;
	sqmId: string;
	devDeviceId: string;
	isPortable: boolean;

	execPath: string;
	backupPath?: string;

	profiles: {
		home: UriComponents;
		all: readonly UriDto<IUserDataProfile>[];
		profile: UriDto<IUserDataProfile>;
	};

	homeDir: string;
	tmpDir: string;
	userDataDir: string;

	partsSplash?: IPartsSplash;

	workspace?: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier;

	isInitialStartup?: boolean;
	logLevel: LogLevel;
	loggers: UriDto<ILoggerResource>[];

	fullscreen?: boolean;
	maximized?: boolean;
	accessibilitySupport?: boolean;
	colorScheme: IColorScheme;
	autoDetectHighContrast?: boolean;
	autoDetectColorScheme?: boolean;
	isCustomZoomLevel?: boolean;

	perfMarks: PerformanceMark[];

	filesToWait?: IPathsToWaitFor;

	os: IOSConfiguration;
	policiesData?: IStringDictionary<{ definition: PolicyDefinition; value: PolicyValue }>;
}

export function zoomLevelToZoomFactor(zoomLevel = 0): number {
	return 1.2 ** zoomLevel;
}

export const DEFAULT_EMPTY_WINDOW_SIZE = { width: 1200, height: 800 } as const;
export const DEFAULT_WORKSPACE_WINDOW_SIZE = { width: 1440, height: 900 } as const;
export const DEFAULT_AUX_WINDOW_SIZE = { width: 1024, height: 768 } as const;
