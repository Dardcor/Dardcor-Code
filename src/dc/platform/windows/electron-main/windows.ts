/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import electron, { Display, Rectangle } from 'electron';
import { Color } from '../../../base/common/color.js';
import { Event } from '../../../base/common/event.js';
import { join } from '../../../base/common/path.js';
import { IProcessEnvironment, isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import { IAuxiliaryWindow } from '../../auxiliaryWindow/electron-main/auxiliaryWindow.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { NativeParsedArgs } from '../../environment/common/argv.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ServicesAccessor, createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IThemeMainService } from '../../theme/electron-main/themeMainService.js';
import { IOpenEmptyWindowOptions, IWindowOpenable, IWindowSettings, TitlebarStyle, WindowMinimumSize, hasNativeTitlebar, useNativeFullScreen, useWindowControlsOverlay, zoomLevelToZoomFactor } from '../../window/common/window.js';
import { ICodeWindow, IWindowState, WindowMode, defaultWindowState } from '../../window/electron-main/window.js';

export const IWindowsMainService = createDecorator<IWindowsMainService>('windowsMainService');

export interface IWindowsMainService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeWindowsCount: Event<IWindowsCountChangedEvent>;

	readonly onDidOpenWindow: Event<ICodeWindow>;
	readonly onDidSignalReadyWindow: Event<ICodeWindow>;
	readonly onDidMaximizeWindow: Event<ICodeWindow>;
	readonly onDidUnmaximizeWindow: Event<ICodeWindow>;
	readonly onDidChangeFullScreen: Event<{ window: ICodeWindow; fullscreen: boolean }>;
	readonly onDidTriggerSystemContextMenu: Event<{ readonly window: ICodeWindow; readonly x: number; readonly y: number }>;
	readonly onDidDestroyWindow: Event<ICodeWindow>;

	open(openConfig: IOpenConfiguration): Promise<ICodeWindow[]>;
	openEmptyWindow(openConfig: IOpenEmptyConfiguration, options?: IOpenEmptyWindowOptions): Promise<ICodeWindow[]>;
	openExtensionDevelopmentHostWindow(extensionDevelopmentPath: string[], openConfig: IOpenConfiguration): Promise<ICodeWindow[]>;
	openExistingWindow(window: ICodeWindow, openConfig: IOpenConfiguration): void;


	sendToFocused(channel: string, ...args: unknown[]): void;
	sendToOpeningWindow(channel: string, ...args: unknown[]): void;
	sendToAll(channel: string, payload?: unknown, windowIdsToIgnore?: number[]): void;

	getWindows(): ICodeWindow[];
	getWindowCount(): number;

	getFocusedWindow(): ICodeWindow | undefined;
	getLastActiveWindow(): ICodeWindow | undefined;

	getWindowById(windowId: number): ICodeWindow | undefined;
	getWindowByWebContents(webContents: electron.WebContents): ICodeWindow | undefined;
}

export interface IWindowsCountChangedEvent {
	readonly oldCount: number;
	readonly newCount: number;
}

export const enum OpenContext {

	CLI,

	DOCK,

	MENU,

	DIALOG,

	DESKTOP,

	API,

	LINK
}

export interface IBaseOpenConfiguration {
	readonly context: OpenContext;
	readonly contextWindowId?: number;
}

export interface IOpenConfiguration extends IBaseOpenConfiguration {
	readonly cli: NativeParsedArgs;
	readonly userEnv?: IProcessEnvironment;
	readonly urisToOpen?: IWindowOpenable[];
	readonly waitMarkerFileURI?: URI;
	readonly preferNewWindow?: boolean;
	readonly forceNewWindow?: boolean;
	readonly forceNewTabbedWindow?: boolean;
	readonly forceReuseWindow?: boolean;
	readonly forceEmpty?: boolean;
	readonly diffMode?: boolean;
	readonly mergeMode?: boolean;
	addMode?: boolean;
	removeMode?: boolean;
	readonly gotoLineMode?: boolean;
	readonly initialStartup?: boolean;
	readonly noRecentEntry?: boolean;
	readonly remoteAuthority?: string;
	readonly forceProfile?: string;
	readonly forceTempProfile?: boolean;
}

export interface IOpenEmptyConfiguration extends IBaseOpenConfiguration { }

export interface IDefaultBrowserWindowOptionsOverrides {
	forceNativeTitlebar?: boolean;
	disableFullscreen?: boolean;
	alwaysOnTop?: boolean;
	frameless?: boolean;
	transparent?: boolean;
	notResizable?: boolean;
	noBackgroundThrottling?: boolean;
	backgroundColor?: string;
}

export function defaultBrowserWindowOptions(accessor: ServicesAccessor, windowState: IWindowState, overrides?: IDefaultBrowserWindowOptionsOverrides, webPreferences?: electron.WebPreferences): electron.BrowserWindowConstructorOptions & { experimentalDarkMode: boolean } {
	const themeMainService = accessor.get(IThemeMainService);
	const productService = accessor.get(IProductService);
	const configurationService = accessor.get(IConfigurationService);
	const environmentMainService = accessor.get(IEnvironmentMainService);

	const windowSettings = configurationService.getValue<IWindowSettings | undefined>('window');

	const options: electron.BrowserWindowConstructorOptions & { experimentalDarkMode: boolean; accentColor?: boolean | string } = {
		backgroundColor: themeMainService.getBackgroundColor(),
		minWidth: WindowMinimumSize.WIDTH,
		minHeight: WindowMinimumSize.HEIGHT,
		title: productService.nameLong,
		show: windowState.mode !== WindowMode.Maximized && windowState.mode !== WindowMode.Fullscreen,
		x: windowState.x,
		y: windowState.y,
		width: windowState.width,
		height: windowState.height,
		webPreferences: {
			...webPreferences,
			enableWebSQL: false,
			spellcheck: false,
			zoomFactor: zoomLevelToZoomFactor(windowState.zoomLevel ?? windowSettings?.zoomLevel),
			autoplayPolicy: 'user-gesture-required',
			enableBlinkFeatures: 'HighlightAPI',
			sandbox: true,
			enableDeprecatedPaste: true,
		},
		experimentalDarkMode: true
	};

	if (isWindows) {
		let borderSetting = windowSettings?.border || 'default';
		if (borderSetting === 'system') {
			borderSetting = 'default';
		}
		if (borderSetting !== 'default') {
			if (borderSetting === 'off') {
				options.accentColor = false;
			} else if (typeof borderSetting === 'string') {
				options.accentColor = borderSetting;
			}
		}
	}

	if (isLinux) {
		options.icon = join(environmentMainService.appRoot, 'resources/linux/code.png');
	} else if (isWindows) {
		options.icon = join(environmentMainService.appRoot, 'public/dardcor-code.ico');
	}

	if (isMacintosh) {
		options.acceptFirstMouse = true;

		if (windowSettings?.clickThroughInactive === false) {
			options.acceptFirstMouse = false;
		}
	}

	if (overrides?.disableFullscreen) {
		options.fullscreen = false;
	} else if (isMacintosh && !useNativeFullScreen(configurationService)) {
		options.fullscreenable = false;
	}

	const useNativeTabs = isMacintosh && windowSettings?.nativeTabs === true;
	if (useNativeTabs) {
		options.tabbingIdentifier = productService.nameShort;
	}

	const hideNativeTitleBar = !hasNativeTitlebar(configurationService, overrides?.forceNativeTitlebar ? TitlebarStyle.NATIVE : undefined);
	if (hideNativeTitleBar) {
		options.titleBarStyle = 'hidden';
		if (!isMacintosh) {
			options.frame = false;
		}

		if (useWindowControlsOverlay(configurationService)) {
			if (isMacintosh) {
				options.titleBarOverlay = true;
			} else {


				const titleBarColor = themeMainService.getWindowSplash(undefined)?.colorInfo.titleBarBackground ?? themeMainService.getBackgroundColor();
				const symbolColor = Color.fromHex(titleBarColor).isDarker() ? '#FFFFFF' : '#000000';

				options.titleBarOverlay = {
					height: 29,
					color: titleBarColor,
					symbolColor
				};
			}
		}
	}

	if (overrides?.alwaysOnTop) {
		options.alwaysOnTop = true;
	}

	if (overrides?.frameless) {
		options.frame = false;
		options.titleBarStyle = undefined;
		options.titleBarOverlay = undefined;
		options.minWidth = 1;
		options.minHeight = 1;
	}

	if (overrides?.backgroundColor) {
		options.backgroundColor = overrides.backgroundColor;
	}

	if (overrides?.transparent) {
		options.transparent = true;
		options.backgroundColor = undefined!;
	}

	if (overrides?.notResizable) {
		options.resizable = false;
	}

	if (overrides?.noBackgroundThrottling) {
		options.webPreferences = {
			...options.webPreferences,
			backgroundThrottling: false,
		};
	}

	return options;
}

export function getLastFocused(windows: ICodeWindow[]): ICodeWindow | undefined;
export function getLastFocused(windows: IAuxiliaryWindow[]): IAuxiliaryWindow | undefined;
export function getLastFocused(windows: ICodeWindow[] | IAuxiliaryWindow[]): ICodeWindow | IAuxiliaryWindow | undefined {
	let lastFocusedWindow: ICodeWindow | IAuxiliaryWindow | undefined = undefined;
	let maxLastFocusTime = Number.MIN_VALUE;

	for (const window of windows) {
		if (window.lastFocusTime > maxLastFocusTime) {
			maxLastFocusTime = window.lastFocusTime;
			lastFocusedWindow = window;
		}
	}

	return lastFocusedWindow;
}

export namespace WindowStateValidator {

	export function validateWindowState(logService: ILogService, state: IWindowState, displays = electron.screen.getAllDisplays()): IWindowState | undefined {
		logService.trace(`window#validateWindowState: validating window state on ${displays.length} display(s)`, state);

		if (
			typeof state.x !== 'number' ||
			typeof state.y !== 'number' ||
			typeof state.width !== 'number' ||
			typeof state.height !== 'number'
		) {
			logService.trace('window#validateWindowState: unexpected type of state values');

			return undefined;
		}

		if (state.width <= 0 || state.height <= 0) {
			logService.trace('window#validateWindowState: unexpected negative values');

			return undefined;
		}

		if (displays.length === 1) {
			const displayWorkingArea = getWorkingArea(displays[0]);
			logService.trace('window#validateWindowState: single monitor working area', displayWorkingArea);

			if (displayWorkingArea) {

				function ensureStateInDisplayWorkingArea(): void {
					if (!state || typeof state.x !== 'number' || typeof state.y !== 'number' || !displayWorkingArea) {
						return;
					}

					if (state.x < displayWorkingArea.x) {
						state.x = displayWorkingArea.x;
					}

					if (state.y < displayWorkingArea.y) {
						state.y = displayWorkingArea.y;
					}
				}

				ensureStateInDisplayWorkingArea();

				if (state.width > displayWorkingArea.width) {
					state.width = displayWorkingArea.width;
				}

				if (state.height > displayWorkingArea.height) {
					state.height = displayWorkingArea.height;
				}

				if (state.x > (displayWorkingArea.x + displayWorkingArea.width - 128)) {
					state.x = displayWorkingArea.x + displayWorkingArea.width - state.width;
				}

				if (state.y > (displayWorkingArea.y + displayWorkingArea.height - 128)) {
					state.y = displayWorkingArea.y + displayWorkingArea.height - state.height;
				}

				ensureStateInDisplayWorkingArea();
			}

			return state;
		}

		if (state.display && state.mode === WindowMode.Fullscreen) {
			const display = displays.find(d => d.id === state.display);
			if (display && typeof display.bounds?.x === 'number' && typeof display.bounds?.y === 'number') {
				logService.trace('window#validateWindowState: restoring fullscreen to previous display');

				const defaults = defaultWindowState(WindowMode.Fullscreen);
				defaults.x = display.bounds.x;
				defaults.y = display.bounds.y;

				return defaults;
			}
		}

		let display: electron.Display | undefined;
		let displayWorkingArea: electron.Rectangle | undefined;
		try {
			display = electron.screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height });
			displayWorkingArea = getWorkingArea(display);

			logService.trace('window#validateWindowState: multi-monitor working area', displayWorkingArea);
		} catch (error) {
			logService.error('window#validateWindowState: error finding display for window state', error);
		}

		if (display && validateWindowStateOnDisplay(state, display)) {
			return state;
		}

		logService.trace('window#validateWindowState: state is outside of the multi-monitor working area');

		return undefined;
	}

	export function validateWindowStateOnDisplay(state: IWindowState, display: Display): state is Rectangle {
		if (
			typeof state.x !== 'number' ||
			typeof state.y !== 'number' ||
			typeof state.width !== 'number' ||
			typeof state.height !== 'number' ||
			state.width <= 0 || state.height <= 0
		) {
			return false;
		}

		const displayWorkingArea = getWorkingArea(display);
		return Boolean(
			displayWorkingArea &&
			state.x + state.width > displayWorkingArea.x &&
			state.y + state.height > displayWorkingArea.y &&
			state.x < displayWorkingArea.x + displayWorkingArea.width &&
			state.y < displayWorkingArea.y + displayWorkingArea.height
		);
	}

	function getWorkingArea(display: electron.Display): electron.Rectangle | undefined {

		if (display.workArea.width > 0 && display.workArea.height > 0) {
			return display.workArea;
		}

		if (display.bounds.width > 0 && display.bounds.height > 0) {
			return display.bounds;
		}

		return undefined;
	}
}

export function getAllWindowsExcludingOffscreen() {
	return electron.BrowserWindow.getAllWindows().filter(win => !win.webContents.isOffscreen());
}
