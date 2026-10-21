/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen, WebContentsView, webContents } from 'electron';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IBrowserViewAudience, IBrowserViewBounds, IBrowserViewDevToolsStateEvent, IBrowserViewFocusEvent, IBrowserViewKeyDownEvent, IBrowserViewState, IBrowserViewNavigationEvent, IBrowserViewLoadingEvent, IBrowserViewLoadError, IBrowserViewTitleChangeEvent, IBrowserViewFaviconChangeEvent, IBrowserViewCaptureScreenshotOptions, IBrowserViewFindInPageOptions, IBrowserViewFindInPageResult, IBrowserViewVisibilityEvent, browserViewIsolatedWorldId, browserZoomFactors, browserZoomDefaultIndex, IBrowserViewOwner, IBrowserViewEditorOpenOptions, IBrowserViewPermissionRequestEvent, equalsBrowserViewAudience, isBrowserViewAssociatedResourceNavigation, matchesBrowserViewAudience, IBrowserViewHost } from '../common/browserView.js';
import { BrowserViewEmulator } from './browserViewEmulator.js';
import { BrowserViewInspector } from './browserViewInspector.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';
import { ICodeWindow, LoadReason } from '../../window/electron-main/window.js';
import { IAuxiliaryWindowsMainService } from '../../auxiliaryWindow/electron-main/auxiliaryWindows.js';
import { BrowserViewDebugger } from './browserViewDebugger.js';
import { ILogService } from '../../log/common/log.js';
import { BrowserSession } from './browserSession.js';
import { IBrowserHistoryItemHandle } from '../common/browserHistory.js';
import { ISerializedBrowserPermissionsSnapshot, PermissionCategory } from '../common/browserPermissions.js';
import { IAuxiliaryWindow } from '../../auxiliaryWindow/electron-main/auxiliaryWindow.js';
import { SCAN_CODE_STR_TO_EVENT_KEY_CODE } from '../../../base/common/keyCodes.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { logBrowserOpen } from '../common/browserViewTelemetry.js';
import { URI } from '../../../base/common/uri.js';

enum NewPageLocation {
	Foreground = 'foreground',
	Background = 'background',
	NewWindow = 'newWindow'
}

const DARDCOR_BOOTSTRAP_CURSOR_SCRIPT = `(() => {
	const id = '__dardcor_agent_cursor_bootstrap__';
	if (!document.documentElement) return false;
	let host = document.getElementById(id);
	if (!host) {
		host = document.createElement('div');
		host.id = id;
		host.setAttribute('aria-hidden', 'true');
		host.setAttribute('data-dardcor-ignore', 'true');
		host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;overflow:hidden;';
		const shadow = host.attachShadow({ mode: 'open' });
		shadow.innerHTML = '<style>:host,*{box-sizing:border-box;pointer-events:none}#cursor{position:fixed;left:0;top:0;display:flex;align-items:flex-start;gap:7px;filter:drop-shadow(0 2px 5px #0009);transform:translate3d(50vw,35vh,0) translate(-2px,-2px);will-change:transform}svg{width:29px;height:34px;flex:none}#badge{margin-top:18px;padding:4px 9px;border:1px solid #8b5cf6;border-radius:999px;background:rgba(17,12,34,.9);color:#fff;font:600 11px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;white-space:nowrap}</style><div id="cursor"><svg viewBox="0 0 24 30" aria-hidden="true"><path d="M2 1v24l6.3-6.3 4 9 4-1.8-4.1-8.7H21L2 1Z" fill="#8b5cf6" stroke="white" stroke-width="1.7" stroke-linejoin="round"/></svg><span id="badge">Dardcor</span></div>';
		(document.body || document.documentElement).appendChild(host);
	}
	const shadow = host.shadowRoot;
	const cursor = shadow && shadow.getElementById('cursor');
	const badge = shadow && shadow.getElementById('badge');
	if (badge) {
		badge.textContent = 'Dardcor';
		badge.style.borderColor = '#8b5cf6';
	}
	const cursorPath = shadow && shadow.querySelector('path');
	if (cursorPath) {
		cursorPath.setAttribute('fill', '#8b5cf6');
	}
	if (!cursor || typeof window.__dardcorAgentCursorMoveTo === 'function') return true;
	const moveTo = (x, y) => {
		const width = window.innerWidth || 1024;
		const height = window.innerHeight || 768;
		const safeX = Math.max(0, Math.min(width, Number.isFinite(x) ? x : Math.round(width * 0.5)));
		const safeY = Math.max(0, Math.min(height, Number.isFinite(y) ? y : Math.round(height * 0.35)));
		cursor.style.transform = 'translate3d(' + Math.round(safeX) + 'px,' + Math.round(safeY) + 'px,0) translate(-2px,-2px)';
	};
	window.__dardcorAgentCursorMoveTo = moveTo;
	moveTo(Math.round((window.innerWidth || 1024) * 0.5), Math.round((window.innerHeight || 768) * 0.35));
	return true;
})()`;

export class BrowserView extends Disposable {
	private readonly _view: WebContentsView;
	private readonly _faviconRequestCache = new Map<string, Promise<string>>();

	private _lastScreenshot: VSBuffer | undefined = undefined;
	private _lastFavicon: string | undefined = undefined;
	private _lastError: IBrowserViewLoadError | undefined = undefined;
	private _lastUserGestureTimestamp: number = -Infinity;
	private _browserZoomIndex: number = browserZoomDefaultIndex;

	private _currentHistoryHandle: IBrowserHistoryItemHandle | undefined;
	private _explicitNavigationPending = false;
	private _lastCommittedEntryIndex = -1;

	readonly debugger: BrowserViewDebugger;
	readonly emulator: BrowserViewEmulator;
	readonly inspector: BrowserViewInspector;

	private _ownerWindow: ICodeWindow;
	private _owner: IBrowserViewOwner;
	private _currentWindow: ICodeWindow | IAuxiliaryWindow | undefined;
	private _isDisposed = false;
	private _audiences: readonly IBrowserViewAudience[] = [];

	private _wantsVisibility = false;
	private _hasBeenLaidOut = false;

	private static readonly MAX_CONSOLE_LOG_ENTRIES = 1000;
	private readonly _consoleLogs: string[] = [];

	private static readonly MAX_FULL_PAGE_SCREENSHOT_DIMENSION = 2576;

	private readonly _onDidNavigate = this._register(new Emitter<IBrowserViewNavigationEvent>());
	readonly onDidNavigate: Event<IBrowserViewNavigationEvent> = this._onDidNavigate.event;

	private readonly _onDidChangeLoadingState = this._register(new Emitter<IBrowserViewLoadingEvent>());
	readonly onDidChangeLoadingState: Event<IBrowserViewLoadingEvent> = this._onDidChangeLoadingState.event;

	private readonly _onDidChangeFocus = this._register(new Emitter<IBrowserViewFocusEvent>());
	readonly onDidChangeFocus: Event<IBrowserViewFocusEvent> = this._onDidChangeFocus.event;

	private readonly _onDidChangeVisibility = this._register(new Emitter<IBrowserViewVisibilityEvent>());
	readonly onDidChangeVisibility: Event<IBrowserViewVisibilityEvent> = this._onDidChangeVisibility.event;

	private readonly _onDidChangeDevToolsState = this._register(new Emitter<IBrowserViewDevToolsStateEvent>());
	readonly onDidChangeDevToolsState: Event<IBrowserViewDevToolsStateEvent> = this._onDidChangeDevToolsState.event;

	private readonly _onDidKeyCommand = this._register(new Emitter<IBrowserViewKeyDownEvent>());
	readonly onDidKeyCommand: Event<IBrowserViewKeyDownEvent> = this._onDidKeyCommand.event;

	private readonly _onDidChangeTitle = this._register(new Emitter<IBrowserViewTitleChangeEvent>());
	readonly onDidChangeTitle: Event<IBrowserViewTitleChangeEvent> = this._onDidChangeTitle.event;

	private readonly _onDidChangeFavicon = this._register(new Emitter<IBrowserViewFaviconChangeEvent>());
	readonly onDidChangeFavicon: Event<IBrowserViewFaviconChangeEvent> = this._onDidChangeFavicon.event;

	private readonly _onDidChangeOwner = this._register(new Emitter<IBrowserViewOwner>());
	readonly onDidChangeOwner: Event<IBrowserViewOwner> = this._onDidChangeOwner.event;

	private readonly _onDidFindInPage = this._register(new Emitter<IBrowserViewFindInPageResult>());
	readonly onDidFindInPage: Event<IBrowserViewFindInPageResult> = this._onDidFindInPage.event;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	private readonly _onDidChangeRemoteStatus = this._register(new Emitter<boolean>());
	readonly onDidChangeRemoteStatus: Event<boolean> = this._onDidChangeRemoteStatus.event;

	private readonly _onDidRequestPermission = this._register(new Emitter<IBrowserViewPermissionRequestEvent>());
	readonly onDidRequestPermission: Event<IBrowserViewPermissionRequestEvent> = this._onDidRequestPermission.event;

	private readonly _onDidChangePermissions = this._register(new Emitter<ISerializedBrowserPermissionsSnapshot>());
	readonly onDidChangePermissions: Event<ISerializedBrowserPermissionsSnapshot> = this._onDidChangePermissions.event;

	private readonly _onDidChangeAudiences = this._register(new Emitter<IBrowserViewAudience[]>());
	readonly onDidChangeAudiences: Event<IBrowserViewAudience[]> = this._onDidChangeAudiences.event;

	constructor(
		public readonly id: string,
		public readonly host: IBrowserViewHost,
		owner: IBrowserViewOwner,
		public readonly associatedResource: URI | undefined,
		public readonly session: BrowserSession,
		private readonly _createChildView: (owner: IBrowserViewOwner, url: string, electronOptions: Electron.WebContentsViewConstructorOptions | undefined, editorOptions: IBrowserViewEditorOpenOptions) => BrowserView,
		openContextMenu: (view: BrowserView, params: Electron.ContextMenuParams) => void,
		options: Electron.WebContentsViewConstructorOptions | undefined,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@IAuxiliaryWindowsMainService private readonly auxiliaryWindowsMainService: IAuxiliaryWindowsMainService,
		@ILogService private readonly logService: ILogService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super();
		this._owner = owner;

		const webPreferences: Electron.WebPreferences = {
			...options?.webPreferences,

			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,

			nodeIntegrationInSubFrames: true,

			webviewTag: false,
			session: this.session.electronSession,

			focusOnNavigation: false
		};

		this._view = new WebContentsView({
			webPreferences,
			...(options?.webContents ? { webContents: options.webContents } : {})
		});

		this._view.setBounds({ x: 0, y: 0, width: 1024, height: 768 });
		this._view.setBackgroundColor('#FFFFFF');

		this._ownerWindow = this.windowsMainService.getWindowById(host.windowId)!;
		if (!this._ownerWindow) {
			throw new Error(`Window with ID ${host.windowId} not found`);
		}
		this._register(this._ownerWindow.onDidClose(() => this.dispose()));
		this._register(this._ownerWindow.onWillLoad((e) => {
			if (e.reason === LoadReason.LOAD) {
				this.dispose();
			} else if (e.reason === LoadReason.RELOAD) {
				this.setVisible(false);
			}
		}));

		this._view.setVisible(false);
		this._ownerWindow.win?.contentView.addChildView(this._view);

		this._view.webContents.setWindowOpenHandler((details) => {
			const location = (() => {
				switch (details.disposition) {
					case 'background-tab': return NewPageLocation.Background;
					case 'foreground-tab': return NewPageLocation.Foreground;
					case 'new-window': return NewPageLocation.NewWindow;
					default: return undefined;
				}
			})();

			if (!location || !this.consumePopupPermission(location)) {
				return { action: 'deny' };
			}

			return {
				action: 'allow',
				createWindow: (options) => {
					logBrowserOpen(this.telemetryService, (() => {
						switch (location) {
							case NewPageLocation.NewWindow: return 'browserLinkNewWindow';
							case NewPageLocation.Background: return 'browserLinkBackground';
							case NewPageLocation.Foreground: return 'browserLinkForeground';
						}
					})());

					const childView = this._createChildView(this.owner, details.url, options, {
						pinned: true,
						background: location === NewPageLocation.Background,
						parentViewId: id,
						auxiliaryWindow: location === NewPageLocation.NewWindow
							? { x: options.x, y: options.y, width: options.width, height: options.height }
							: undefined,
					});

					return childView.webContents;
				},

				outlivesOpener: true
			};
		});

		this._view.webContents.on('context-menu', (_event, params) => {
			openContextMenu(this, params);
		});

		this._view.webContents.on('destroyed', () => {
			this.dispose();
		});

		this.debugger = this._register(new BrowserViewDebugger(this, this.logService));
		this.emulator = this._register(new BrowserViewEmulator(this, this.logService));
		this.inspector = this._register(new BrowserViewInspector(this));

		const fireRemoteStatus = () => this._onDidChangeRemoteStatus.fire(this.session.remote.isRemote);
		this._register(this.session.remote.onDidStart(fireRemoteStatus));
		this._register(this.session.remote.onDidStop(fireRemoteStatus));

		this._register(this.session.permissions.onDidRequestPermission(e => {
			if (e.webContents === this.webContents && !this._isDisposed) {
				e.claim();
				this._onDidRequestPermission.fire(e.request);
			}
		}));
		this._register(this.session.permissions.onDidRequestDevice(e => {
			if (e.webContents === this.webContents && !this._isDisposed) {
				e.claim();
				this._onDidRequestPermission.fire({
					origin: e.origin,
					category: PermissionCategory.Devices,
					device: {
						requestId: e.requestId,
						deviceType: e.deviceType,
						devices: e.devices,
					},
				});
			}
		}));
		this._register(this.session.permissions.onDidChange(() => {
			this._onDidChangePermissions.fire(this.session.permissions.serialize());
		}));

		this.setupEventListeners();
	}

	private setupEventListeners(): void {
		const webContents = this._view.webContents;

		webContents.on('devtools-opened', () => {
			this._onDidChangeDevToolsState.fire({ isDevToolsOpen: true });
		});

		webContents.on('devtools-closed', () => {
			this._onDidChangeDevToolsState.fire({ isDevToolsOpen: false });
		});

		webContents.on('page-favicon-updated', async (_event, favicons) => {
			for (const url of favicons) {
				if (!this._faviconRequestCache.has(url)) {
					this._faviconRequestCache.set(url, (async () => {
						if (url.startsWith('data:image/')) {
							return url;
						}
						const response = await webContents.session.fetch(url, {
							cache: 'force-cache'
						});
						if (!response.ok) {
							throw new Error(`Failed to fetch favicon: ${response.status} ${response.statusText}`);
						}
						const type = await response.headers.get('content-type');
						if (!type?.startsWith('image/')) {
							throw new Error(`Favicon is not an image: ${type}`);
						}
						const buffer = await response.arrayBuffer();

						return `data:${type};base64,${Buffer.from(buffer).toString('base64')}`;
					})());
				}

				try {
					this._lastFavicon = await this._faviconRequestCache.get(url)!;
					this._onDidChangeFavicon.fire({ favicon: this._lastFavicon });
					this._currentHistoryHandle?.update({ favicon: this._lastFavicon });
					return;
				} catch (e) {
				}
			}

			if (this._lastFavicon) {
				this._lastFavicon = undefined;
				this._onDidChangeFavicon.fire({ favicon: this._lastFavicon });
				this._currentHistoryHandle?.update({ favicon: null });
			}
		});
		webContents.on('will-navigate', (event) => {
			if (this._redirectPinnedNavigation(event.url)) {
				event.preventDefault();
				return;
			}
			const host = URL.parse(event.url)?.host;
			const currHost = URL.parse(this.webContents.getURL())?.host;
			if (host !== currHost) {
				this._lastFavicon = undefined;
			}
		});
		webContents.on('will-redirect', event => {
			if (this._redirectPinnedNavigation(event.url)) {
				event.preventDefault();
			}
		});

		webContents.on('page-title-updated', (_event, title) => {
			this._onDidChangeTitle.fire({ title });
			this._currentHistoryHandle?.update({ title });
		});

		const fireNavigationEvent = (url: string) => {
			this._onDidNavigate.fire({
				url,
				title: webContents.getTitle(),
				canGoBack: webContents.navigationHistory.canGoBack(),
				canGoForward: webContents.navigationHistory.canGoForward(),
				certificateError: this.session.trust.getCertificateError(url)
			});
			this._recordNavigation(url);
		};

		const fireLoadingEvent = (loading: boolean) => {
			this._onDidChangeLoadingState.fire({ loading, error: this._lastError });
		};

		webContents.on('did-start-loading', () => {
			this._lastError = undefined;

			if (webContents.isLoadingMainFrame()) {
				fireLoadingEvent(true);
			}
		});
		webContents.on('did-stop-loading', () => fireLoadingEvent(false));
		webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL, isMainFrame) => {
			if (isMainFrame) {
				if (errorCode === -3) {
					fireLoadingEvent(false);
					return;
				}

				this._lastError = {
					url: validatedURL,
					errorCode,
					errorDescription,
					certificateError: errorCode <= -200 && errorCode >= -220 ? this.session.trust.getCertificateError(validatedURL) : undefined
				};

				fireLoadingEvent(false);
				this._onDidNavigate.fire({
					url: validatedURL,
					title: '',
					canGoBack: webContents.navigationHistory.canGoBack(),
					canGoForward: webContents.navigationHistory.canGoForward(),
					certificateError: this.session.trust.getCertificateError(validatedURL)
				});
			}
		});
		webContents.on('did-finish-load', () => {
			fireLoadingEvent(false);
			this.installAgentCursorOverlay();
		});

		this.session.trust.installCertErrorHandler(webContents);

		webContents.on('login', (event, _details, authInfo, callback) => {
			if (this.session.remote.proxy) {
				const { username, password } = this.session.remote.proxy.credentials;
				const proxyPort = this.session.remote.proxy.port;
				if (authInfo.isProxy && authInfo.host === '127.0.0.1' && authInfo.port === proxyPort) {
					event.preventDefault();
					callback(username, password);
				}
			}
		});

		webContents.on('render-process-gone', (_event, details) => {
			this._lastError = {
				url: webContents.getURL(),
				errorCode: details.exitCode,
				errorDescription: `Render process gone: ${details.reason}`
			};

			fireLoadingEvent(false);
		});

		webContents.on('did-navigate', (_, url) => fireNavigationEvent(url));
		webContents.on('did-navigate-in-page', (_, url, isMainFrame) => {
			if (isMainFrame) {
				fireNavigationEvent(url);
			}
		});

		webContents.on('did-navigate', () => {
			this._consoleLogs.length = 0;
			this._view.webContents.setZoomFactor(browserZoomFactors[this._browserZoomIndex]);

			void this._view.webContents.setVisualZoomLevelLimits(1, 3).catch(error => {
				this.logService.error('Failed to set visual zoom level limits for browser view webContents.', error);
			});
		});

		webContents.on('select-bluetooth-device', (event, devices, callback) => {
			event.preventDefault();
			this.session.permissions.beginBluetoothRequest(this.webContents, devices, callback);
		});

		webContents.on('focus', () => {
			this._onDidChangeFocus.fire({ focused: true });
		});

		webContents.on('blur', () => {
			this._onDidChangeFocus.fire({ focused: false });
		});

		const onCommandKeydown = (_event: unknown, keyEvent: IBrowserViewKeyDownEvent) => {
			this._onDidKeyCommand.fire(keyEvent);
		};

		webContents.ipc.on('vscode:browserView:keydown', onCommandKeydown);
		webContents.on('devtools-opened', () => {
			webContents.devToolsWebContents?.ipc.off('vscode:browserView:keydown', onCommandKeydown);
			webContents.devToolsWebContents?.ipc.on('vscode:browserView:keydown', onCommandKeydown);
		});

		webContents.on('before-input-event', (event, input) => {
			if (input.type !== 'keyDown') {
				return;
			}

			const pageIsAvailable = this._view.getVisible()
				&& !webContents.isCrashed()
				&& !this.debugger.isPaused;
			if (pageIsAvailable) {
				return;
			}

			if (!(input.control || input.alt || input.meta) && input.key.length === 1) {
				return;
			}

			event.preventDefault();

			const eventKeyCode = SCAN_CODE_STR_TO_EVENT_KEY_CODE[input.code] || 0;
			this._onDidKeyCommand.fire({
				key: input.key,
				keyCode: eventKeyCode,
				code: input.code,
				ctrlKey: input.control,
				shiftKey: input.shift,
				altKey: input.alt,
				metaKey: input.meta,
				repeat: input.isAutoRepeat
			});
		});

		webContents.on('input-event', (_event, input) => {
			switch (input.type) {
				case 'rawKeyDown':
				case 'keyDown':
				case 'mouseDown':
				case 'pointerDown':
				case 'pointerUp':
				case 'touchEnd':
					this._lastUserGestureTimestamp = Date.now();
			}
		});

		webContents.on('will-prevent-unload', (e) => {
			e.preventDefault();
		});

		webContents.on('found-in-page', (_event, result) => {
			this._onDidFindInPage.fire({
				activeMatchOrdinal: result.activeMatchOrdinal,
				matches: result.matches,
				selectionArea: result.selectionArea,
				finalUpdate: result.finalUpdate
			});
		});

		this._view.webContents.on('console-message', (event) => {
			this._consoleLogs.push(`[${event.level}] ${event.message}`);
			if (this._consoleLogs.length > BrowserView.MAX_CONSOLE_LOG_ENTRIES) {
				this._consoleLogs.splice(0, this._consoleLogs.length - BrowserView.MAX_CONSOLE_LOG_ENTRIES);
			}
		});
	}

	private consumePopupPermission(location: NewPageLocation): boolean {
		switch (location) {
			case NewPageLocation.Foreground:
			case NewPageLocation.Background:
				return true;
			case NewPageLocation.NewWindow:
				if (this._lastUserGestureTimestamp > Date.now() - 1000) {
					this._lastUserGestureTimestamp = -Infinity;
					return true;
				}

				return false;
		}
	}

	private _recordNavigation(url: string): void {
		const webContents = this._view.webContents;
		const activeIndex = webContents.navigationHistory.getActiveIndex();

		if (!isTrackableHistoryUrl(url)) {
			this._currentHistoryHandle = undefined;
			this._lastCommittedEntryIndex = activeIndex;
			return;
		}

		const handle = this._currentHistoryHandle;
		if (handle && activeIndex === this._lastCommittedEntryIndex) {
			handle.update({ url, title: webContents.getTitle() });
			return;
		}
		this._lastCommittedEntryIndex = activeIndex;

		const userInitiated = this._explicitNavigationPending;
		this._explicitNavigationPending = false;
		this._currentHistoryHandle = this.session.history.add(
			url,
			webContents.getTitle(),
			this._lastFavicon,
			userInitiated,
		);
	}

	get owner(): IBrowserViewOwner {
		return this._owner;
	}

	setOwner(owner: IBrowserViewOwner): void {
		this._owner = owner;
		this._onDidChangeOwner.fire(owner);
	}

	get webContents(): Electron.WebContents {
		return this._view.webContents;
	}

	getState(): IBrowserViewState {
		const webContents = this._view.webContents;
		const url = webContents.getURL();

		return {
			url,
			title: webContents.getTitle(),
			canGoBack: webContents.navigationHistory.canGoBack(),
			canGoForward: webContents.navigationHistory.canGoForward(),
			loading: webContents.isLoading(),
			focused: webContents.isFocused(),
			visible: this._view.getVisible(),
			isDevToolsOpen: webContents.isDevToolsOpened(),
			lastScreenshot: this._lastScreenshot,
			lastFavicon: this._lastFavicon,
			lastError: this._lastError,
			certificateError: this.session.trust.getCertificateError(url),
			storageScope: this.session.storageScope,
			storageKeys: { ...this.session.history.storageKeys, ...this.session.permissions.storageKeys },
			permissions: this.session.permissions.serialize(),
			browserZoomIndex: this._browserZoomIndex,
			elementSelectionState: this.inspector.elementSelectionState,
			isRemoteSession: this.session.remote.isRemote,
			isAreaSelectionActive: this.inspector.isAreaSelectionActive,
			device: this.emulator.device,
			audiences: [...this._audiences]
		};
	}

	get audiences(): readonly IBrowserViewAudience[] {
		return this._audiences;
	}

	setAudience(audience: IBrowserViewAudience, enabled: boolean): void {
		if (enabled) {
			if (!this._audiences.some(candidate => equalsBrowserViewAudience(candidate, audience))) {
				this._audiences = [...this._audiences, audience];
				this._onDidChangeAudiences.fire([...this._audiences]);
			}
		} else {
			const audiences = this._audiences.filter(candidate => !matchesBrowserViewAudience(candidate, audience));
			if (audiences.length !== this._audiences.length) {
				this._audiences = audiences;
				this._onDidChangeAudiences.fire([...this._audiences]);
			}
		}
	}

	setAudiences(audiences: readonly IBrowserViewAudience[]): void {
		if (audiences.length === this._audiences.length && audiences.every(audience => this._audiences.some(candidate => equalsBrowserViewAudience(candidate, audience)))) {
			return;
		}

		this._audiences = [...audiences];
		this._onDidChangeAudiences.fire([...this._audiences]);
	}

	toggleDevTools(): void {
		this._view.webContents.toggleDevTools();
	}

	layout(bounds: IBrowserViewBounds): void {
		if (this._currentWindow?.win?.id !== bounds.windowId) {
			const newWindow = this._windowById(bounds.windowId);
			if (newWindow) {
				this._currentWindow?.win?.contentView.removeChildView(this._view);
				this._currentWindow = newWindow;
				newWindow.win?.contentView.addChildView(this._view);
			}
		}

		this._view.setBorderRadius(Math.round(bounds.cornerRadius * bounds.zoomFactor));

		if (bounds.emulation) {
			this.emulator.applyScreenEmulation(bounds.width, bounds.height, bounds.emulation.scale, bounds.zoomFactor);
		}

		this._view.setBounds({
			x: Math.round(bounds.x * bounds.zoomFactor),
			y: Math.round(bounds.y * bounds.zoomFactor),
			width: Math.round(bounds.width * bounds.zoomFactor),
			height: Math.round(bounds.height * bounds.zoomFactor)
		});

		this._hasBeenLaidOut = true;
		if (this._wantsVisibility && !this._view.getVisible()) {
			this._view.setVisible(true);
		}
	}

	setBrowserZoomIndex(zoomIndex: number): void {
		this._browserZoomIndex = Math.max(0, Math.min(zoomIndex, browserZoomFactors.length - 1));
		const browserZoomFactor = browserZoomFactors[this._browserZoomIndex];
		this._view.webContents.setZoomFactor(browserZoomFactor);
	}

	setVisible(visible: boolean): void {
		if (this._wantsVisibility === visible) {
			return;
		}

		if (!visible && this._view.webContents.isFocused()) {
			this._currentWindow?.win?.webContents.focus();
		}

		if (this._hasBeenLaidOut || !visible) {
			this._view.setVisible(visible);
		}

		this._wantsVisibility = visible;
		this._onDidChangeVisibility.fire({ visible });
		if (visible) {
			this.installAgentCursorOverlay();
		}
	}

	private installAgentCursorOverlay(): void {
		const webContents = this._view.webContents;
		if (webContents.isDestroyed() || webContents.isLoadingMainFrame()) {
			return;
		}
		void webContents.executeJavaScript(DARDCOR_BOOTSTRAP_CURSOR_SCRIPT).catch(error => {
			this.logService.debug(`[BrowserView] Could not install the browser agent cursor overlay: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	getConsoleLogs(): string {
		return this._consoleLogs.join('\n');
	}

	async loadURL(url: string): Promise<void> {
		if (this._redirectPinnedNavigation(url)) {
			return;
		}
		this._explicitNavigationPending = true;
		await this.session.remote.whenReady;
		await this._view.webContents.loadURL(url);
	}

	private _redirectPinnedNavigation(url: string): boolean {
		if (!this.associatedResource || isBrowserViewAssociatedResourceNavigation(this.associatedResource, url)) {
			return false;
		}

		logBrowserOpen(this.telemetryService, 'browserLinkForeground');
		this._createChildView(this.owner, url, undefined, {
			pinned: true,
			parentViewId: this.id
		});
		return true;
	}

	getURL(): string {
		return this._view.webContents.getURL();
	}

	goBack(): void {
		if (this._view.webContents.navigationHistory.canGoBack()) {
			this._view.webContents.navigationHistory.goBack();
		}
	}

	goForward(): void {
		if (this._view.webContents.navigationHistory.canGoForward()) {
			this._view.webContents.navigationHistory.goForward();
		}
	}

	reload(hard?: boolean): void {
		if (hard) {
			this._view.webContents.reloadIgnoringCache();
		} else {
			this._view.webContents.reload();
		}
	}

	canGoBack(): boolean {
		return this._view.webContents.navigationHistory.canGoBack();
	}

	canGoForward(): boolean {
		return this._view.webContents.navigationHistory.canGoForward();
	}

	async captureScreenshot(options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer> {
		if (!this._view.getVisible()) {
			this._view.setVisible(true);
			this._view.setVisible(false);
		}

		const quality = options?.quality ?? 80;
		const format = options?.format ?? 'jpeg';

		if (options?.fullPage && !options.screenRect && !options.pageRect) {
			return this._captureFullPageScreenshot(format, quality);
		}

		if (options?.pageRect) {
			const zoomFactor = this._view.webContents.getZoomFactor();
			const visualViewportScale = await this.inspector.getVisualViewportScale();
			const emulationScale = this.emulator.emulatedScaleFactor;
			options.screenRect = {
				x: options.pageRect.x * visualViewportScale * zoomFactor * emulationScale,
				y: options.pageRect.y * visualViewportScale * zoomFactor * emulationScale,
				width: options.pageRect.width * visualViewportScale * zoomFactor * emulationScale,
				height: options.pageRect.height * visualViewportScale * zoomFactor * emulationScale
			};
		}
		if (options?.awaitNextPaint) {
			await this._waitForNextPaint();
		}
		const image = await (async () => {
			const maxAttempts = 5;
			let lastError: Error | undefined;
			for (let i = 0; i < maxAttempts; i++) {
				try {
					return await this._view.webContents.capturePage(options?.screenRect, {
						stayHidden: true
					});
				} catch (error) {
					if (error instanceof Error && error.message === 'UnknownVizError') {
						lastError = error;
						await new Promise(resolve => setTimeout(resolve, 16));
						continue;
					} else {
						throw error;
					}
				}
			}
			throw new Error(`Failed to capture screenshot after ${maxAttempts} attempts`, { cause: lastError });
		})();
		const buffer = format === 'png' ? image.toPNG() : image.toJPEG(quality);
		const screenshot = VSBuffer.wrap(buffer);
		if (!options?.screenRect) {
			this._lastScreenshot = screenshot;
		}
		return screenshot;
	}

	private async _captureFullPageScreenshot(format: 'jpeg' | 'png', quality: number): Promise<VSBuffer> {
		const metrics = await this.debugger.sendCommand('Page.getLayoutMetrics') as { cssContentSize?: { width: number; height: number } };
		const size = metrics.cssContentSize;
		if (!size) {
			throw new Error('Page.getLayoutMetrics did not return a cssContentSize');
		}
		const zoomFactor = this._view.webContents.getZoomFactor();
		const clipWidth = size.width * zoomFactor;
		const clipHeight = size.height * zoomFactor;
		const hostWindow = this._hostWindow;
		const display = hostWindow ? screen.getDisplayMatching(hostWindow.getBounds()) : screen.getPrimaryDisplay();
		const devicePixelRatio = display.scaleFactor;
		const maxClipDimension = BrowserView.MAX_FULL_PAGE_SCREENSHOT_DIMENSION / Math.max(devicePixelRatio, 1);
		const scale = Math.min(1, maxClipDimension / Math.max(clipWidth, clipHeight));
		try {
			const result = await this.debugger.sendCommand('Page.captureScreenshot', {
				format,
				...(format === 'jpeg' ? { quality } : {}),
				captureBeyondViewport: true,
				clip: { x: 0, y: 0, width: clipWidth, height: clipHeight, scale }
			}) as { data: string };
			return VSBuffer.wrap(Buffer.from(result.data, 'base64'));
		} finally {
			void this._view.webContents.setVisualZoomLevelLimits(1, 3).catch(error => {
				this.logService.error('Failed to restore visual zoom level limits after full-page screenshot.', error);
			});
		}
	}

	private async _waitForNextPaint(): Promise<void> {
		const WAIT_TIMEOUT_MS = 100;
		try {
			await Promise.race([
				this.debugger.sendCommand('Runtime.evaluate', {
					expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
					awaitPromise: true
				}),
				new Promise<void>(resolve => setTimeout(resolve, WAIT_TIMEOUT_MS))
			]);
		} catch {
		}
	}

	async focus(force?: boolean): Promise<void> {
		if (!force && !this._currentWindow?.win?.isFocused()) {
			return;
		}
		this._view.webContents.focus();
	}

	async findInPage(text: string, options?: IBrowserViewFindInPageOptions): Promise<void> {
		this._view.webContents.findInPage(text, {
			matchCase: options?.matchCase ?? false,
			forward: options?.forward ?? true,

			findNext: options?.recompute ?? false
		});
	}

	async stopFindInPage(keepSelection?: boolean): Promise<void> {
		this._view.webContents.stopFindInPage(keepSelection ? 'keepSelection' : 'clearSelection');
	}

	async getSelectedText(): Promise<string> {
		if (this._view.webContents.isLoading()) {
			return '';
		}
		try {
			return await this._view.webContents.executeJavaScriptInIsolatedWorld(browserViewIsolatedWorldId, [{ code: 'window.browserViewAPI?.getSelectedText?.() ?? ""' }]);
		} catch {
			return '';
		}
	}

	async clearStorage(): Promise<void> {
		await this.session.clearData();
	}

	selectDevice(requestId: string, deviceId: string | null): void {
		this.session.permissions.resolveDevice(requestId, deviceId);
	}

	async trustCertificate(host: string, fingerprint: string): Promise<void> {
		await this.session.trust.trustCertificate(host, fingerprint);
		this._view.webContents.reload();
	}

	async untrustCertificate(host: string, fingerprint: string): Promise<void> {
		await this.session.trust.untrustCertificate(host, fingerprint);
		this.dispose();
	}

	getWebContentsView(): WebContentsView {
		return this._view;
	}

	getElectronWindow(): Electron.BrowserWindow | undefined {
		return this._currentWindow?.win ?? undefined;
	}

	private get _hostWindow(): Electron.BrowserWindow | undefined {
		return this._currentWindow?.win ?? this._ownerWindow.win ?? undefined;
	}

	override dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;

		this.debugger.dispose();

		const currentWin = this._currentWindow?.win;
		if (currentWin && !currentWin.isDestroyed()) {
			currentWin.contentView.removeChildView(this._view);
		}

		this._onDidClose.fire();

		if (!this._view.webContents.isDestroyed()) {
			this._view.webContents.close({ waitForBeforeUnload: false });
		}

		super.dispose();
	}

	private _windowById(windowId: number | undefined): ICodeWindow | IAuxiliaryWindow | undefined {
		return this._codeWindowById(windowId) ?? this._auxiliaryWindowById(windowId);
	}

	private _codeWindowById(windowId: number | undefined): ICodeWindow | undefined {
		if (typeof windowId !== 'number') {
			return undefined;
		}

		return this.windowsMainService.getWindowById(windowId);
	}

	private _auxiliaryWindowById(windowId: number | undefined): IAuxiliaryWindow | undefined {
		if (typeof windowId !== 'number') {
			return undefined;
		}

		const contents = webContents.fromId(windowId);
		if (!contents) {
			return undefined;
		}

		return this.auxiliaryWindowsMainService.getWindowByWebContents(contents);
	}
}

function isTrackableHistoryUrl(url: string): boolean {
	if (!url) {
		return false;
	}
	const colon = url.indexOf(':');
	if (colon <= 0) {
		return false;
	}
	const scheme = url.substring(0, colon).toLowerCase();
	return scheme === 'http' || scheme === 'https' || scheme === 'file';
}
