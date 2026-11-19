/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-globals */

import { getPartsSplashColors } from './partsSplash.js';

(async function () {

	performance.mark('code/didStartRenderer');

	type ISandboxConfiguration = import('../../../base/parts/sandbox/common/sandboxTypes.js').ISandboxConfiguration;
	type ILoadResult<M, T extends ISandboxConfiguration> = import('../../../platform/window/electron-browser/window.js').ILoadResult<M, T>;
	type ILoadOptions<T extends ISandboxConfiguration> = import('../../../platform/window/electron-browser/window.js').ILoadOptions<T>;
	type INativeWindowConfiguration = import('../../../platform/window/common/window.ts').INativeWindowConfiguration;
	type IMainWindowSandboxGlobals = import('../../../base/parts/sandbox/electron-browser/globals.js').IMainWindowSandboxGlobals;
	type IDesktopMain = import('../../../workbench/electron-browser/desktop.main.js').IDesktopMain;

	const preloadGlobals = (window as unknown as { vscode: IMainWindowSandboxGlobals }).vscode;
	const safeProcess = preloadGlobals.process;


	function showSplash(configuration: INativeWindowConfiguration) {
		performance.mark('code/willShowPartsSplash');
		showDefaultSplash(configuration);
		performance.mark('code/didShowPartsSplash');
	}

	function showDefaultSplash(configuration: INativeWindowConfiguration) {
		let data = configuration.partsSplash;
		if (data) {
			if (configuration.autoDetectHighContrast && configuration.colorScheme.highContrast) {
				if ((configuration.colorScheme.dark && data.baseTheme !== 'hc-black') || (!configuration.colorScheme.dark && data.baseTheme !== 'hc-light')) {
					data = undefined;
				}
			} else if (configuration.autoDetectColorScheme) {
				if ((configuration.colorScheme.dark && data.baseTheme !== 'dc-dark' && data.baseTheme !== 'vs-dark') || (!configuration.colorScheme.dark && data.baseTheme !== 'dc' && data.baseTheme !== 'vs')) {
					data = undefined;
				}
			}
		}

		if (data && configuration.extensionDevelopmentPath) {
			data.layoutInfo = undefined;
		}

		let baseTheme;
		let shellBackground;
		let shellForeground;
		const splashColors = data ? getPartsSplashColors(data, window.document.hasFocus(), !!configuration.workspace) : undefined;
		if (data) {
			baseTheme = data.baseTheme;
			shellBackground = splashColors?.background ?? data.colorInfo.editorBackground ?? data.colorInfo.background;
			shellForeground = data.colorInfo.foreground;
		} else if (configuration.autoDetectHighContrast && configuration.colorScheme.highContrast) {
			if (configuration.colorScheme.dark) {
				baseTheme = 'hc-black';
				shellBackground = '#000000';
				shellForeground = '#FFFFFF';
			} else {
				baseTheme = 'hc-light';
				shellBackground = '#FFFFFF';
				shellForeground = '#000000';
			}
		} else {
			if (configuration.colorScheme?.dark) {
				baseTheme = 'vs-dark';
				shellBackground = '#1E1E1E';
				shellForeground = '#CCCCCC';
			} else {
				baseTheme = 'vs';
				shellBackground = '#FFFFFF';
				shellForeground = '#000000';
			}
		}

		const style = document.createElement('style');
		style.className = 'initialShellColors';
		window.document.head.appendChild(style);
		style.textContent = `body {	background-color: ${shellBackground}; color: ${shellForeground}; margin: 0; padding: 0; }`;

		if (typeof data?.zoomLevel === 'number' && typeof preloadGlobals?.webFrame?.setZoomLevel === 'function') {
			preloadGlobals.webFrame.setZoomLevel(data.zoomLevel);
		}

		if (data?.layoutInfo) {
			const { layoutInfo, colorInfo } = data;
			const modernUI = layoutInfo.modernUI === true;
			const floatingMargin = 4;
			const floatingOuterMargin = floatingMargin * 2;
			const floatingBorderWidth = 1;

			const splash = document.createElement('div');
			splash.id = 'monaco-parts-splash';
			splash.className = baseTheme ?? 'dc-dark';

			if (layoutInfo.windowBorder && colorInfo.windowBorder) {
				const borderElement = document.createElement('div');
				borderElement.style.position = 'absolute';
				borderElement.style.width = 'calc(100vw - 2px)';
				borderElement.style.height = 'calc(100vh - 2px)';
				borderElement.style.zIndex = '1';
				borderElement.style.border = `1px solid var(--window-border-color)`;
				borderElement.style.setProperty('--window-border-color', colorInfo.windowBorder);

				if (layoutInfo.windowBorderRadius) {
					borderElement.style.borderRadius = layoutInfo.windowBorderRadius;
				}

				splash.appendChild(borderElement);
			}

			const setBounds = (element: HTMLElement, bounds: { top: number; bottom?: number; left?: number; right?: number; width?: number; height?: number }) => {
				element.style.position = 'absolute';
				element.style.top = `${bounds.top}px`;
				if (typeof bounds.bottom === 'number') {
					element.style.bottom = `${bounds.bottom}px`;
				}
				if (typeof bounds.left === 'number') {
					element.style.left = `${bounds.left}px`;
				}
				if (typeof bounds.right === 'number') {
					element.style.right = `${bounds.right}px`;
				}
				if (typeof bounds.width === 'number') {
					element.style.width = `${bounds.width}px`;
				}
				if (typeof bounds.height === 'number') {
					element.style.height = `${bounds.height}px`;
				}
			};

			const setPartBounds = (element: HTMLElement, bounds: { top: number; left: number; width: number; height: number }) => {
				element.style.position = 'absolute';
				element.style.top = `${bounds.top}px`;
				element.style.left = `${bounds.left}px`;
				element.style.width = `${bounds.width}px`;
				element.style.height = `${bounds.height}px`;
			};

			const applyFloatingCardStyles = (element: HTMLElement, backgroundColor: string | undefined) => {
				element.style.boxSizing = 'border-box';
				element.style.border = `${floatingBorderWidth}px solid ${colorInfo.agentsPanelBorder ?? colorInfo.editorGroupBorder ?? 'transparent'}`;
				element.style.borderRadius = '8px';
				element.style.backgroundColor = backgroundColor ?? colorInfo.editorBackground ?? colorInfo.background;
				element.style.overflow = 'hidden';
			};

			const contentTop = layoutInfo.titleBarHeight;
			const contentBottom = layoutInfo.statusBarHeight;
			const contentHeight = `calc(100% - ${contentTop + contentBottom}px)`;
			const activityHeight = modernUI ? `calc(100% - ${contentTop + contentBottom + floatingMargin}px)` : contentHeight;

			if (layoutInfo.auxiliaryBarWidth === Number.MAX_SAFE_INTEGER) {
				layoutInfo.auxiliaryBarWidth = window.innerWidth - layoutInfo.activityBarWidth;
			} else {
				layoutInfo.auxiliaryBarWidth = Math.min(layoutInfo.auxiliaryBarWidth, window.innerWidth - (layoutInfo.activityBarWidth + layoutInfo.editorPartMinWidth + layoutInfo.sideBarWidth));
			}
			layoutInfo.sideBarWidth = Math.min(layoutInfo.sideBarWidth, window.innerWidth - (layoutInfo.activityBarWidth + layoutInfo.editorPartMinWidth + layoutInfo.auxiliaryBarWidth));

			if (layoutInfo.titleBarHeight > 0) {
				const titleDiv = document.createElement('div');
				titleDiv.style.position = 'absolute';
				titleDiv.style.width = '100%';
				titleDiv.style.height = `${layoutInfo.titleBarHeight}px`;
				titleDiv.style.left = '0';
				titleDiv.style.top = '0';
				titleDiv.style.backgroundColor = modernUI ? 'transparent' : `${colorInfo.titleBarBackground}`;
				(titleDiv.style as CSSStyleDeclaration & { '-webkit-app-region': string })['-webkit-app-region'] = 'drag';
				splash.appendChild(titleDiv);

				if (!modernUI && colorInfo.titleBarBorder) {
					const titleBorder = document.createElement('div');
					titleBorder.style.position = 'absolute';
					titleBorder.style.width = '100%';
					titleBorder.style.height = '1px';
					titleBorder.style.left = '0';
					titleBorder.style.bottom = '0';
					titleBorder.style.borderBottom = `1px solid ${colorInfo.titleBarBorder}`;
					titleDiv.appendChild(titleBorder);
				}
			}

			if (layoutInfo.activityBarWidth > 0) {
				const activityDiv = document.createElement('div');
				activityDiv.style.position = 'absolute';
				activityDiv.style.width = `${layoutInfo.activityBarWidth}px`;
				activityDiv.style.height = activityHeight;
				activityDiv.style.top = `${contentTop}px`;
				if (layoutInfo.sideBarSide === 'left') {
					activityDiv.style.left = '0';
				} else {
					activityDiv.style.right = '0';
				}
				activityDiv.style.backgroundColor = modernUI ? 'transparent' : `${colorInfo.activityBarBackground}`;
				splash.appendChild(activityDiv);

				if (!modernUI && colorInfo.activityBarBorder) {
					const activityBorderDiv = document.createElement('div');
					activityBorderDiv.style.position = 'absolute';
					activityBorderDiv.style.width = '1px';
					activityBorderDiv.style.height = '100%';
					activityBorderDiv.style.top = '0';
					if (layoutInfo.sideBarSide === 'left') {
						activityBorderDiv.style.right = '0';
						activityBorderDiv.style.borderRight = `1px solid ${colorInfo.activityBarBorder}`;
					} else {
						activityBorderDiv.style.left = '0';
						activityBorderDiv.style.borderLeft = `1px solid ${colorInfo.activityBarBorder}`;
					}
					activityDiv.appendChild(activityBorderDiv);
				}
			}

			if (layoutInfo.sideBarWidth > 0) {
				const sideDiv = document.createElement('div');
				if (modernUI && layoutInfo.partBounds?.sideBar) {
					setPartBounds(sideDiv, layoutInfo.partBounds.sideBar);
				} else if (layoutInfo.sideBarSide === 'left') {
					setBounds(sideDiv, {
						top: contentTop,
						bottom: modernUI ? contentBottom + floatingMargin : contentBottom,
						left: layoutInfo.activityBarWidth + (modernUI ? floatingMargin : 0),
						width: modernUI ? Math.max(0, layoutInfo.sideBarWidth - floatingOuterMargin - floatingBorderWidth * 2) : layoutInfo.sideBarWidth
					});
				} else {
					setBounds(sideDiv, {
						top: contentTop,
						bottom: modernUI ? contentBottom + floatingMargin : contentBottom,
						right: layoutInfo.activityBarWidth + (modernUI ? floatingMargin : 0),
						width: modernUI ? Math.max(0, layoutInfo.sideBarWidth - floatingOuterMargin - floatingBorderWidth * 2) : layoutInfo.sideBarWidth
					});
				}
				if (modernUI) {
					applyFloatingCardStyles(sideDiv, colorInfo.agentsPanelBackground ?? colorInfo.sideBarBackground);
				} else {
					sideDiv.style.backgroundColor = `${colorInfo.sideBarBackground}`;
				}
				splash.appendChild(sideDiv);

				if (!modernUI && colorInfo.sideBarBorder) {
					const sideBorderDiv = document.createElement('div');
					sideBorderDiv.style.position = 'absolute';
					sideBorderDiv.style.width = '1px';
					sideBorderDiv.style.height = '100%';
					sideBorderDiv.style.top = '0';
					sideBorderDiv.style.right = '0';
					if (layoutInfo.sideBarSide === 'left') {
						sideBorderDiv.style.borderRight = `1px solid ${colorInfo.sideBarBorder}`;
					} else {
						sideBorderDiv.style.left = '0';
						sideBorderDiv.style.borderLeft = `1px solid ${colorInfo.sideBarBorder}`;
					}
					sideDiv.appendChild(sideBorderDiv);
				}
			}

			if (layoutInfo.auxiliaryBarWidth > 0) {
				const auxSideDiv = document.createElement('div');
				if (modernUI && layoutInfo.partBounds?.auxiliaryBar) {
					setPartBounds(auxSideDiv, layoutInfo.partBounds.auxiliaryBar);
				} else if (layoutInfo.sideBarSide === 'left') {
					setBounds(auxSideDiv, {
						top: contentTop,
						bottom: modernUI ? contentBottom + floatingMargin : contentBottom,
						right: modernUI ? floatingOuterMargin : 0,
						width: modernUI ? Math.max(0, layoutInfo.auxiliaryBarWidth - floatingOuterMargin - floatingMargin - floatingBorderWidth * 2) : layoutInfo.auxiliaryBarWidth
					});
				} else {
					setBounds(auxSideDiv, {
						top: contentTop,
						bottom: modernUI ? contentBottom + floatingMargin : contentBottom,
						left: modernUI ? floatingOuterMargin : 0,
						width: modernUI ? Math.max(0, layoutInfo.auxiliaryBarWidth - floatingOuterMargin - floatingMargin - floatingBorderWidth * 2) : layoutInfo.auxiliaryBarWidth
					});
				}
				if (modernUI) {
					applyFloatingCardStyles(auxSideDiv, colorInfo.sideBarBackground);
				} else {
					auxSideDiv.style.backgroundColor = `${colorInfo.sideBarBackground}`;
				}
				splash.appendChild(auxSideDiv);

				if (!modernUI && colorInfo.sideBarBorder) {
					const auxSideBorderDiv = document.createElement('div');
					auxSideBorderDiv.style.position = 'absolute';
					auxSideBorderDiv.style.width = '1px';
					auxSideBorderDiv.style.height = '100%';
					auxSideBorderDiv.style.top = '0';
					if (layoutInfo.sideBarSide === 'left') {
						auxSideBorderDiv.style.left = '0';
						auxSideBorderDiv.style.borderLeft = `1px solid ${colorInfo.sideBarBorder}`;
					} else {
						auxSideBorderDiv.style.right = '0';
						auxSideBorderDiv.style.borderRight = `1px solid ${colorInfo.sideBarBorder}`;
					}
					auxSideDiv.appendChild(auxSideBorderDiv);
				}
			}

			if (modernUI) {
				if (layoutInfo.partBounds?.editor || !layoutInfo.partBounds) {
					const editorDiv = document.createElement('div');
					if (layoutInfo.partBounds?.editor) {
						setPartBounds(editorDiv, layoutInfo.partBounds.editor);
					} else {
						const editorLeft = (layoutInfo.sideBarSide === 'left' ? layoutInfo.activityBarWidth + layoutInfo.sideBarWidth : layoutInfo.auxiliaryBarWidth) + floatingMargin;
						const editorRight = (layoutInfo.sideBarSide === 'left' ? layoutInfo.auxiliaryBarWidth : layoutInfo.activityBarWidth + layoutInfo.sideBarWidth) + floatingMargin;
						setBounds(editorDiv, {
							top: contentTop,
							bottom: contentBottom + floatingMargin,
							left: editorLeft,
							right: editorRight
						});
					}
					applyFloatingCardStyles(editorDiv, colorInfo.editorBackground);
					splash.appendChild(editorDiv);
				}
			} else {
				const editorDiv = document.createElement('div');
				const editorLeft = (layoutInfo.sideBarSide === 'left' ? layoutInfo.activityBarWidth + layoutInfo.sideBarWidth : layoutInfo.auxiliaryBarWidth);
				const editorRight = (layoutInfo.sideBarSide === 'left' ? layoutInfo.auxiliaryBarWidth : layoutInfo.activityBarWidth + layoutInfo.sideBarWidth);
				setBounds(editorDiv, {
					top: contentTop,
					bottom: contentBottom,
					left: editorLeft,
					right: editorRight
				});
				editorDiv.style.backgroundColor = `${colorInfo.editorBackground}`;
				splash.appendChild(editorDiv);
			}

			if (modernUI && layoutInfo.partBounds?.panel) {
				const panelDiv = document.createElement('div');
				setPartBounds(panelDiv, layoutInfo.partBounds.panel);
				applyFloatingCardStyles(panelDiv, colorInfo.panelBackground ?? colorInfo.editorBackground);
				splash.appendChild(panelDiv);
			}

			if (layoutInfo.statusBarHeight > 0) {
				const statusDiv = document.createElement('div');
				statusDiv.style.position = 'absolute';
				statusDiv.style.width = '100%';
				statusDiv.style.height = `${layoutInfo.statusBarHeight}px`;
				statusDiv.style.bottom = '0';
				statusDiv.style.left = '0';
				if (modernUI) {
					statusDiv.style.backgroundColor = 'transparent';
				} else if (configuration.workspace && colorInfo.statusBarBackground) {
					statusDiv.style.backgroundColor = colorInfo.statusBarBackground;
				} else if (!configuration.workspace && colorInfo.statusBarNoFolderBackground) {
					statusDiv.style.backgroundColor = colorInfo.statusBarNoFolderBackground;
				}
				splash.appendChild(statusDiv);

				if (!modernUI && colorInfo.statusBarBorder) {
					const statusBorderDiv = document.createElement('div');
					statusBorderDiv.style.position = 'absolute';
					statusBorderDiv.style.width = '100%';
					statusBorderDiv.style.height = '1px';
					statusBorderDiv.style.top = '0';
					statusBorderDiv.style.borderTop = `1px solid ${colorInfo.statusBarBorder}`;
					statusDiv.appendChild(statusBorderDiv);
				}
			}

			window.document.body.appendChild(splash);
		}
	}



	async function load<M, T extends ISandboxConfiguration>(options: ILoadOptions<T>): Promise<ILoadResult<M, T>> {

		const configuration = await resolveWindowConfiguration<T>();

		options?.beforeImport?.(configuration);

		const { enableDeveloperKeybindings, removeDeveloperKeybindingsAfterLoad, developerDeveloperKeybindingsDisposable, forceDisableShowDevtoolsOnError } = setupDeveloperKeybindings(configuration, options);

		setupNLS<T>(configuration);

		const baseUrl = new URL(`${fileUriFromPath(configuration.appRoot, { isWindows: safeProcess.platform === 'win32', scheme: 'vscode-file', fallbackAuthority: 'vscode-app' })}/out/`);
		globalThis._VSCODE_FILE_ROOT = baseUrl.toString();

		globalThis._VSCODE_PRODUCT_JSON = { ...configuration.product };

		setupCSSImportMaps<T>(configuration, baseUrl);

		try {
			let workbenchUrl: string;
			if (!!safeProcess.env['VSCODE_DEV'] && globalThis._VSCODE_USE_RELATIVE_IMPORTS) {
				workbenchUrl = '../../../workbench/workbench.desktop.main.js';
			} else {
				workbenchUrl = new URL(`dc/workbench/workbench.desktop.main.js`, baseUrl).href;
			}

			const result = await import(workbenchUrl);
			if (developerDeveloperKeybindingsDisposable && removeDeveloperKeybindingsAfterLoad) {
				developerDeveloperKeybindingsDisposable();
			}

			return { result, configuration };
		} catch (error) {
			onUnexpectedError(error, enableDeveloperKeybindings && !forceDisableShowDevtoolsOnError);

			throw error;
		}
	}

	async function resolveWindowConfiguration<T extends ISandboxConfiguration>() {
		const timeout = setTimeout(() => { console.error(`[resolve window config] Could not resolve window configuration within 10 seconds, but will continue to wait...`); }, 10000);
		performance.mark('code/willWaitForWindowConfig');

		const configuration = await preloadGlobals.context.resolveConfiguration() as T;
		performance.mark('code/didWaitForWindowConfig');

		clearTimeout(timeout);

		return configuration;
	}

	function setupDeveloperKeybindings<T extends ISandboxConfiguration>(configuration: T, options: ILoadOptions<T>) {
		const {
			forceEnableDeveloperKeybindings,
			disallowReloadKeybinding,
			removeDeveloperKeybindingsAfterLoad,
			forceDisableShowDevtoolsOnError
		} = typeof options?.configureDeveloperSettings === 'function' ? options.configureDeveloperSettings(configuration) : {
			forceEnableDeveloperKeybindings: false,
			disallowReloadKeybinding: false,
			removeDeveloperKeybindingsAfterLoad: false,
			forceDisableShowDevtoolsOnError: false
		};

		const isDev = !!safeProcess.env['VSCODE_DEV'];
		const enableDeveloperKeybindings = Boolean(isDev || forceEnableDeveloperKeybindings);
		let developerDeveloperKeybindingsDisposable: Function | undefined = undefined;
		if (enableDeveloperKeybindings) {
			developerDeveloperKeybindingsDisposable = registerDeveloperKeybindings(disallowReloadKeybinding);
		}

		return {
			enableDeveloperKeybindings,
			removeDeveloperKeybindingsAfterLoad,
			developerDeveloperKeybindingsDisposable,
			forceDisableShowDevtoolsOnError
		};
	}

	function registerDeveloperKeybindings(disallowReloadKeybinding: boolean | undefined): Function {
		const ipcRenderer = preloadGlobals.ipcRenderer;

		const extractKey =
			function (e: KeyboardEvent) {
				return [
					e.ctrlKey ? 'ctrl-' : '',
					e.metaKey ? 'meta-' : '',
					e.altKey ? 'alt-' : '',
					e.shiftKey ? 'shift-' : '',
					e.keyCode
				].join('');
			};

		const TOGGLE_DEV_TOOLS_KB = (safeProcess.platform === 'darwin' ? 'meta-alt-73' : 'ctrl-shift-73');
		const TOGGLE_DEV_TOOLS_KB_ALT = '123';
		const RELOAD_KB = (safeProcess.platform === 'darwin' ? 'meta-82' : 'ctrl-82');

		let listener: ((e: KeyboardEvent) => void) | undefined = function (e) {
			const key = extractKey(e);
			if (key === TOGGLE_DEV_TOOLS_KB || key === TOGGLE_DEV_TOOLS_KB_ALT) {
				ipcRenderer.send('vscode:toggleDevTools');
			} else if (key === RELOAD_KB && !disallowReloadKeybinding) {
				ipcRenderer.send('vscode:reloadWindow');
			}
		};

		window.addEventListener('keydown', listener);

		return function () {
			if (listener) {
				window.removeEventListener('keydown', listener);
				listener = undefined;
			}
		};
	}

	function setupNLS<T extends ISandboxConfiguration>(configuration: T): void {
		globalThis._VSCODE_NLS_MESSAGES = configuration.nls.messages;
		globalThis._VSCODE_NLS_LANGUAGE = configuration.nls.language;

		let language = configuration.nls.language || 'en';
		if (language === 'zh-tw') {
			language = 'zh-Hant';
		} else if (language === 'zh-cn') {
			language = 'zh-Hans';
		}

		window.document.documentElement.setAttribute('lang', language);
	}

	function onUnexpectedError(error: string | Error, showDevtoolsOnError: boolean): void {
		if (showDevtoolsOnError) {
			const ipcRenderer = preloadGlobals.ipcRenderer;
			ipcRenderer.send('vscode:openDevTools');
		}

		console.error(`[uncaught exception]: ${error}`);

		if (error && typeof error !== 'string' && error.stack) {
			console.error(error.stack);
		}
	}

	function fileUriFromPath(path: string, config: { isWindows?: boolean; scheme?: string; fallbackAuthority?: string }): string {

		let pathName = path.replace(/\\/g, '/');
		if (pathName.length > 0 && pathName.charAt(0) !== '/') {
			pathName = `/${pathName}`;
		}

		let uri: string;

		if (config.isWindows && pathName.startsWith('//')) {
			uri = encodeURI(`${config.scheme || 'file'}:${pathName}`);
		}

		else {
			uri = encodeURI(`${config.scheme || 'file'}://${config.fallbackAuthority || ''}${pathName}`);
		}

		return uri.replace(/#/g, '%23');
	}

	function setupCSSImportMaps<T extends ISandboxConfiguration>(configuration: T, baseUrl: URL) {


		if (globalThis._VSCODE_DISABLE_CSS_IMPORT_MAP) {
			return;
		}

		if (Array.isArray(configuration.cssModules) && configuration.cssModules.length > 0) {
			performance.mark('code/willAddCssLoader');

			globalThis._VSCODE_CSS_LOAD = function (url) {
				const link = document.createElement('link');
				link.setAttribute('rel', 'stylesheet');
				link.setAttribute('type', 'text/css');
				link.setAttribute('href', url);

				window.document.head.appendChild(link);
			};

			const importMap: { imports: Record<string, string> } = { imports: {} };
			for (const cssModule of configuration.cssModules) {
				const cssUrl = new URL(cssModule, baseUrl).href;
				const jsSrc = `globalThis._VSCODE_CSS_LOAD('${cssUrl}');\n`;
				const blob = new Blob([jsSrc], { type: 'application/javascript' });
				importMap.imports[cssUrl] = URL.createObjectURL(blob);
			}

			const ttp = window.trustedTypes?.createPolicy('vscode-bootstrapImportMap', { createScript(value) { return value; }, });
			const importMapSrc = JSON.stringify(importMap, undefined, 2);
			const importMapScript = document.createElement('script');
			importMapScript.type = 'importmap';
			importMapScript.setAttribute('nonce', '0c6a828f1297');
			// @ts-expect-error
			importMapScript.textContent = ttp?.createScript(importMapSrc) ?? importMapSrc;
			window.document.head.appendChild(importMapScript);

			performance.mark('code/didAddCssLoader');
		}
	}


	const { result, configuration } = await load<IDesktopMain, INativeWindowConfiguration>(
		{
			configureDeveloperSettings: function (windowConfig) {
				return {
					forceDisableShowDevtoolsOnError: typeof windowConfig.extensionTestsPath === 'string' || windowConfig['enable-smoke-test-driver'] === true,
					forceEnableDeveloperKeybindings: Array.isArray(windowConfig.extensionDevelopmentPath) && windowConfig.extensionDevelopmentPath.length > 0,
					removeDeveloperKeybindingsAfterLoad: true
				};
			},
			beforeImport: function (windowConfig) {

				showSplash(windowConfig);

				Object.defineProperty(window, 'vscodeWindowId', {
					get: () => windowConfig.windowId
				});

				window.requestIdleCallback(() => {
					const canvas = document.createElement('canvas');
					const context = canvas.getContext('2d');
					context?.clearRect(0, 0, canvas.width, canvas.height);
					canvas.remove();
				}, { timeout: 50 });

				performance.mark('code/willLoadWorkbenchMain');
			}
		}
	);

	performance.mark('code/didLoadWorkbenchMain');

	result.main(configuration);
}());
