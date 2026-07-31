import { BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WindowOptionsOverrides {
	width?: number;
	height?: number;
	minWidth?: number;
	minHeight?: number;
	maxWidth?: number;
	maxHeight?: number;
	title?: string;
	backgroundColor?: string;
	icon?: string;
	show?: boolean;
	frame?: boolean;
	titleBarStyle?: 'default' | 'hidden' | 'hiddenInset' | 'customButtonsOnHover';
	titleBarOverlay?: false | Electron.TitleBarOverlay;
	webPreferences?: Electron.WebPreferences;
	center?: boolean;
	x?: number;
	y?: number;
	parent?: BrowserWindow;
	modal?: boolean;
	autoHideMenuBar?: boolean;
	fullscreen?: boolean;
	alwaysOnTop?: boolean;
	skipTaskbar?: boolean;
	resizable?: boolean;
	minimizable?: boolean;
	maximizable?: boolean;
	closable?: boolean;
	transparent?: boolean;
	vibrancy?: any;
	acceptFirstMouse?: boolean;
	additionalArguments?: string[];
}

export interface ResolvedWindowOptions {
	width: number;
	height: number;
	minWidth: number;
	minHeight: number;
	title: string;
	icon: string;
	autoHideMenuBar: boolean;
	backgroundColor: string;
	titleBarStyle: 'hidden';
	titleBarOverlay: Electron.TitleBarOverlay;
	show: boolean;
	webPreferences: Electron.WebPreferences;
}

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

export function getIconPath(): string {
	const candidates = [
		path.join(PROJECT_ROOT, 'public', 'dardcor-code.png'),
		path.join(PROJECT_ROOT, 'public', 'icon.png'),
		path.join(PROJECT_ROOT, 'assets', 'icon.png'),
		path.join(PROJECT_ROOT, 'build', 'icon.png'),
		path.join(PROJECT_ROOT, 'build', 'icon.ico')
	];
	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		} catch {
			continue;
		}
	}
	return path.join(PROJECT_ROOT, 'public', 'dardcor-code.png');
}

export function buildWindowOptions(overrides: WindowOptionsOverrides = {}): Electron.BrowserWindowConstructorOptions {
	const options: Electron.BrowserWindowConstructorOptions = {
		width: overrides.width ?? 1400,
		height: overrides.height ?? 900,
		minWidth: overrides.minWidth ?? 800,
		minHeight: overrides.minHeight ?? 600,
		title: overrides.title ?? 'Dardcor Code',
		icon: overrides.icon ?? getIconPath(),
		autoHideMenuBar: overrides.autoHideMenuBar ?? true,
		backgroundColor: overrides.backgroundColor ?? '#1e1e1e',
		titleBarStyle: overrides.titleBarStyle ?? 'hidden',
		titleBarOverlay: overrides.titleBarOverlay ?? {
			color: '#323233',
			symbolColor: '#cccccc',
			height: 30
		},
		show: overrides.show ?? false,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			...(overrides.webPreferences ?? {})
		}
	};

	if (overrides.maxWidth !== undefined) options.maxWidth = overrides.maxWidth;
	if (overrides.maxHeight !== undefined) options.maxHeight = overrides.maxHeight;
	if (overrides.frame !== undefined) options.frame = overrides.frame;
	if (overrides.center !== undefined) options.center = overrides.center;
	if (overrides.x !== undefined) options.x = overrides.x;
	if (overrides.y !== undefined) options.y = overrides.y;
	if (overrides.parent !== undefined) options.parent = overrides.parent;
	if (overrides.modal !== undefined) options.modal = overrides.modal;
	if (overrides.fullscreen !== undefined) options.fullscreen = overrides.fullscreen;
	if (overrides.alwaysOnTop !== undefined) options.alwaysOnTop = overrides.alwaysOnTop;
	if (overrides.skipTaskbar !== undefined) options.skipTaskbar = overrides.skipTaskbar;
	if (overrides.resizable !== undefined) options.resizable = overrides.resizable;
	if (overrides.minimizable !== undefined) options.minimizable = overrides.minimizable;
	if (overrides.maximizable !== undefined) options.maximizable = overrides.maximizable;
	if (overrides.closable !== undefined) options.closable = overrides.closable;
	if (overrides.transparent !== undefined) options.transparent = overrides.transparent;
	if (overrides.vibrancy !== undefined) options.vibrancy = overrides.vibrancy;
	if (overrides.acceptFirstMouse !== undefined) options.acceptFirstMouse = overrides.acceptFirstMouse;
	if (overrides.additionalArguments !== undefined) {
		options.webPreferences.additionalArguments = overrides.additionalArguments;
	}

	return options;
}

export function resolveWindowOptions(overrides?: WindowOptionsOverrides): ResolvedWindowOptions {
	const built = buildWindowOptions(overrides);
	return built as unknown as ResolvedWindowOptions;
}

export function createWindow(overrides?: WindowOptionsOverrides): BrowserWindow {
	return new BrowserWindow(buildWindowOptions(overrides));
}

export function showWhenReady(window: BrowserWindow): void {
	window.once('ready-to-show', () => {
		if (!window.isDestroyed()) {
			window.show();
		}
	});
}

export function getAppName(): string {
	return app.getName() ?? 'Dardcor Code';
}

export function isPackaged(): boolean {
	return app.isPackaged;
}
