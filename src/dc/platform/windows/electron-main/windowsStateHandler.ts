/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import electron from 'electron';
import { Disposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IStateService } from '../../state/node/state.js';
import { INativeWindowConfiguration, IWindowSettings } from '../../window/common/window.js';
import { IWindowsMainService } from './windows.js';
import { defaultWindowState, ICodeWindow, IWindowState as IWindowUIState, WindowMode } from '../../window/electron-main/window.js';
import { isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier, IWorkspaceIdentifier } from '../../workspace/common/workspace.js';

export interface IWindowState {
	readonly windowId?: number;
	workspace?: IWorkspaceIdentifier;
	folderUri?: URI;
	backupPath?: string;
	remoteAuthority?: string;
	uiState: IWindowUIState;
}

export interface IWindowsState {
	lastActiveWindow?: IWindowState;
	lastPluginDevelopmentHostWindow?: IWindowState;
	openedWindows: IWindowState[];
}

interface INewWindowState extends IWindowUIState {
	hasDefaultState?: boolean;
}

interface ISerializedWindowsState {
	readonly lastActiveWindow?: ISerializedWindowState;
	readonly lastPluginDevelopmentHostWindow?: ISerializedWindowState;
	readonly openedWindows: ISerializedWindowState[];
}

interface ISerializedWindowState {
	readonly workspaceIdentifier?: { id: string; configURIPath: string };
	readonly folder?: string;
	readonly backupPath?: string;
	readonly remoteAuthority?: string;
	readonly uiState: IWindowUIState;
}

export class WindowsStateHandler extends Disposable {

	private static readonly windowsStateStorageKey = 'windowsState';

	get state() { return this._state; }
	private readonly _state: IWindowsState;

	private lastClosedState: IWindowState | undefined = undefined;

	private shuttingDown = false;

	constructor(
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@IStateService private readonly stateService: IStateService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		this._state = restoreWindowsState(this.stateService.getItem<ISerializedWindowsState>(WindowsStateHandler.windowsStateStorageKey));

		this.registerListeners();
	}

	private registerListeners(): void {

		electron.app.on('browser-window-blur', () => {
			if (!this.shuttingDown) {
				this.saveWindowsState();
			}
		});

		this._register(this.lifecycleMainService.onBeforeCloseWindow(window => this.onBeforeCloseWindow(window)));
		this._register(this.lifecycleMainService.onBeforeShutdown(() => this.onBeforeShutdown()));
		this._register(this.windowsMainService.onDidChangeWindowsCount(e => {
			if (e.newCount - e.oldCount > 0) {
				this.lastClosedState = undefined;
			}
		}));

		this._register(this.windowsMainService.onDidDestroyWindow(window => this.onBeforeCloseWindow(window)));
	}

	private onBeforeShutdown(): void {
		this.shuttingDown = true;

		this.saveWindowsState();
	}

	private saveWindowsState(): void {

		const displaysWithFullScreenWindow = new Set<number | undefined>();

		const currentWindowsState: IWindowsState = {
			openedWindows: [],
			lastPluginDevelopmentHostWindow: this._state.lastPluginDevelopmentHostWindow,
			lastActiveWindow: this.lastClosedState
		};

		if (!currentWindowsState.lastActiveWindow) {
			let activeWindow = this.windowsMainService.getLastActiveWindow();
			if (!activeWindow || activeWindow.isExtensionDevelopmentHost) {
				activeWindow = this.windowsMainService.getWindows().find(window => !window.isExtensionDevelopmentHost);
			}

			if (activeWindow) {
				currentWindowsState.lastActiveWindow = this.toWindowState(activeWindow);

				if (currentWindowsState.lastActiveWindow.uiState.mode === WindowMode.Fullscreen) {
					displaysWithFullScreenWindow.add(currentWindowsState.lastActiveWindow.uiState.display);
				}
			}
		}

		const extensionHostWindow = this.windowsMainService.getWindows().find(window => window.isExtensionDevelopmentHost && !window.isExtensionTestHost);
		if (extensionHostWindow) {
			currentWindowsState.lastPluginDevelopmentHostWindow = this.toWindowState(extensionHostWindow);

			if (currentWindowsState.lastPluginDevelopmentHostWindow.uiState.mode === WindowMode.Fullscreen) {
				if (displaysWithFullScreenWindow.has(currentWindowsState.lastPluginDevelopmentHostWindow.uiState.display)) {
					if (isMacintosh && !extensionHostWindow.win?.isSimpleFullScreen()) {
						currentWindowsState.lastPluginDevelopmentHostWindow.uiState.mode = WindowMode.Normal;
					}
				} else {
					displaysWithFullScreenWindow.add(currentWindowsState.lastPluginDevelopmentHostWindow.uiState.display);
				}
			}
		}

		if (this.windowsMainService.getWindowCount() > 1) {
			currentWindowsState.openedWindows = this.windowsMainService.getWindows().filter(window => !window.isExtensionDevelopmentHost).map(window => {
				const windowState = this.toWindowState(window);

				if (windowState.uiState.mode === WindowMode.Fullscreen) {
					if (displaysWithFullScreenWindow.has(windowState.uiState.display)) {
						if (isMacintosh && windowState.windowId !== currentWindowsState.lastActiveWindow?.windowId && !window.win?.isSimpleFullScreen()) {
							windowState.uiState.mode = WindowMode.Normal;
						}
					} else {
						displaysWithFullScreenWindow.add(windowState.uiState.display);
					}
				}

				return windowState;
			});
		}

		const state = getWindowsStateStoreData(currentWindowsState);
		this.stateService.setItem(WindowsStateHandler.windowsStateStorageKey, state);

		if (this.shuttingDown) {
			this.logService.trace('[WindowsStateHandler] onBeforeShutdown', state);
		}
	}

	private onBeforeCloseWindow(window: ICodeWindow): void {
		if (this.lifecycleMainService.quitRequested) {
			return;
		}

		const state: IWindowState = this.toWindowState(window);
		if (window.isExtensionDevelopmentHost && !window.isExtensionTestHost) {
			this._state.lastPluginDevelopmentHostWindow = state;
		}

		else if (!window.isExtensionDevelopmentHost && window.openedWorkspace) {
			this._state.openedWindows.forEach(openedWindow => {
				const sameWorkspace = isWorkspaceIdentifier(window.openedWorkspace) && openedWindow.workspace?.id === window.openedWorkspace.id;
				const sameFolder = isSingleFolderWorkspaceIdentifier(window.openedWorkspace) && openedWindow.folderUri && extUriBiasedIgnorePathCase.isEqual(openedWindow.folderUri, window.openedWorkspace.uri);

				if (sameWorkspace || sameFolder) {
					openedWindow.uiState = state.uiState;
				}
			});
		}

		if (this.windowsMainService.getWindowCount() === 1) {
			this.lastClosedState = state;
		}
	}

	private toWindowState(window: ICodeWindow): IWindowState {
		return {
			windowId: window.id,
			workspace: isWorkspaceIdentifier(window.openedWorkspace) ? window.openedWorkspace : undefined,
			folderUri: isSingleFolderWorkspaceIdentifier(window.openedWorkspace) ? window.openedWorkspace.uri : undefined,
			backupPath: window.backupPath,
			remoteAuthority: window.remoteAuthority,
			uiState: window.serializeWindowState()
		};
	}

	getNewWindowState(configuration: INativeWindowConfiguration): INewWindowState {
		const state = this.doGetNewWindowState(configuration);
		const windowConfig = this.configurationService.getValue<IWindowSettings | undefined>('window');

		if (state.mode === WindowMode.Fullscreen) {

			let allowFullscreen: boolean;
			if (state.hasDefaultState) {
				allowFullscreen = !!(windowConfig?.newWindowDimensions && ['fullscreen', 'inherit', 'offset'].indexOf(windowConfig.newWindowDimensions) >= 0);
			}

			else {
				allowFullscreen = !!(this.lifecycleMainService.wasRestarted || windowConfig?.restoreFullscreen);
			}

			if (!allowFullscreen) {
				state.mode = WindowMode.Normal;
			}
		}

		return state;
	}

	private doGetNewWindowState(configuration: INativeWindowConfiguration): INewWindowState {
		const lastActive = this.windowsMainService.getLastActiveWindow();

		if (!configuration.extensionTestsPath) {

			if (!!configuration.extensionDevelopmentPath && this.state.lastPluginDevelopmentHostWindow) {
				return this.state.lastPluginDevelopmentHostWindow.uiState;
			}

			const workspace = configuration.workspace;
			if (isWorkspaceIdentifier(workspace)) {
				const stateForWorkspace = this.state.openedWindows.filter(openedWindow => openedWindow.workspace && openedWindow.workspace.id === workspace.id).map(openedWindow => openedWindow.uiState);
				if (stateForWorkspace.length) {
					return stateForWorkspace[0];
				}
			}

			if (isSingleFolderWorkspaceIdentifier(workspace)) {
				const stateForFolder = this.state.openedWindows.filter(openedWindow => openedWindow.folderUri && extUriBiasedIgnorePathCase.isEqual(openedWindow.folderUri, workspace.uri)).map(openedWindow => openedWindow.uiState);
				if (stateForFolder.length) {
					return stateForFolder[0];
				}
			}

			else if (configuration.backupPath) {
				const stateForEmptyWindow = this.state.openedWindows.filter(openedWindow => openedWindow.backupPath === configuration.backupPath).map(openedWindow => openedWindow.uiState);
				if (stateForEmptyWindow.length) {
					return stateForEmptyWindow[0];
				}
			}

			const lastActiveState = this.lastClosedState || this.state.lastActiveWindow;
			if (!lastActive && lastActiveState) {
				return lastActiveState.uiState;
			}
		}


		let displayToUse: electron.Display | undefined;
		const displays = electron.screen.getAllDisplays();

		if (displays.length === 1) {
			displayToUse = displays[0];
		}

		else {

			if (isMacintosh) {
				const cursorPoint = electron.screen.getCursorScreenPoint();
				displayToUse = electron.screen.getDisplayNearestPoint(cursorPoint);
			}

			if (!displayToUse && lastActive) {
				displayToUse = electron.screen.getDisplayMatching(lastActive.getBounds());
			}

			if (!displayToUse) {
				displayToUse = electron.screen.getPrimaryDisplay() || displays[0];
			}
		}

		let state = defaultWindowState(undefined, isWorkspaceIdentifier(configuration.workspace) || isSingleFolderWorkspaceIdentifier(configuration.workspace));
		state.x = Math.round(displayToUse.bounds.x + (displayToUse.bounds.width / 2) - (state.width! / 2));
		state.y = Math.round(displayToUse.bounds.y + (displayToUse.bounds.height / 2) - (state.height! / 2));

		const windowConfig = this.configurationService.getValue<IWindowSettings | undefined>('window');
		let ensureNoOverlap = true;
		if (windowConfig?.newWindowDimensions) {
			if (windowConfig.newWindowDimensions === 'maximized') {
				state.mode = WindowMode.Maximized;
				ensureNoOverlap = false;
			} else if (windowConfig.newWindowDimensions === 'fullscreen') {
				state.mode = WindowMode.Fullscreen;
				ensureNoOverlap = false;
			} else if ((windowConfig.newWindowDimensions === 'inherit' || windowConfig.newWindowDimensions === 'offset') && lastActive) {
				const lastActiveState = lastActive.serializeWindowState();
				if (lastActiveState.mode === WindowMode.Fullscreen) {
					state.mode = WindowMode.Fullscreen;
				} else {
					state = {
						...lastActiveState,
						zoomLevel: undefined
					};
				}

				ensureNoOverlap = state.mode !== WindowMode.Fullscreen && windowConfig.newWindowDimensions === 'offset';
			}
		}

		if (ensureNoOverlap) {
			state = this.ensureNoOverlap(state);
		}

		(state as INewWindowState).hasDefaultState = true;

		return state;
	}

	private ensureNoOverlap(state: IWindowUIState): IWindowUIState {
		if (this.windowsMainService.getWindows().length === 0) {
			return state;
		}

		state.x = typeof state.x === 'number' ? state.x : 0;
		state.y = typeof state.y === 'number' ? state.y : 0;

		const existingWindowBounds = this.windowsMainService.getWindows().map(window => window.getBounds());
		while (existingWindowBounds.some(bounds => bounds.x === state.x || bounds.y === state.y)) {
			state.x += 30;
			state.y += 30;
		}

		return state;
	}
}

export function restoreWindowsState(data: ISerializedWindowsState | undefined): IWindowsState {
	const result: IWindowsState = { openedWindows: [] };
	const windowsState = data || { openedWindows: [] };

	if (windowsState.lastActiveWindow) {
		result.lastActiveWindow = restoreWindowState(windowsState.lastActiveWindow);
	}

	if (windowsState.lastPluginDevelopmentHostWindow) {
		result.lastPluginDevelopmentHostWindow = restoreWindowState(windowsState.lastPluginDevelopmentHostWindow);
	}

	if (Array.isArray(windowsState.openedWindows)) {
		result.openedWindows = windowsState.openedWindows.map(windowState => restoreWindowState(windowState));
	}

	return result;
}

function restoreWindowState(windowState: ISerializedWindowState): IWindowState {
	const result: IWindowState = { uiState: windowState.uiState };
	if (windowState.backupPath) {
		result.backupPath = windowState.backupPath;
	}

	if (windowState.remoteAuthority) {
		result.remoteAuthority = windowState.remoteAuthority;
	}

	if (windowState.folder) {
		result.folderUri = URI.parse(windowState.folder);
	}

	if (windowState.workspaceIdentifier) {
		result.workspace = { id: windowState.workspaceIdentifier.id, configPath: URI.parse(windowState.workspaceIdentifier.configURIPath) };
	}

	return result;
}

export function getWindowsStateStoreData(windowsState: IWindowsState): IWindowsState {
	return {
		lastActiveWindow: windowsState.lastActiveWindow && serializeWindowState(windowsState.lastActiveWindow),
		lastPluginDevelopmentHostWindow: windowsState.lastPluginDevelopmentHostWindow && serializeWindowState(windowsState.lastPluginDevelopmentHostWindow),
		openedWindows: windowsState.openedWindows.map(ws => serializeWindowState(ws))
	};
}

function serializeWindowState(windowState: IWindowState): ISerializedWindowState {
	return {
		workspaceIdentifier: windowState.workspace && { id: windowState.workspace.id, configURIPath: windowState.workspace.configPath.toString() },
		folder: windowState.folderUri?.toString(),
		backupPath: windowState.backupPath,
		remoteAuthority: windowState.remoteAuthority,
		uiState: windowState.uiState
	};
}
