import { app, BrowserWindow, ipcMain } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface AppLifecycleOptions {
	createWindow: () => void;
	onBeforeQuit?: () => boolean | void;
	onWillQuit?: () => void;
	onSecondInstance?: (argv: string[], workingDirectory: string) => void;
	onOpenFile?: (filePath: string) => void;
	onOpenFolder?: (folderPath: string) => void;
	hasUnsavedChanges?: () => boolean;
	flushUnsaved?: () => void;
	keepRunningWhenWindowAllClosed?: boolean;
	onActivate?: () => void;
	onReady?: () => void;
}

export class AppLifecycle extends Disposable {
	private _isReady = false;
	private _isQuitting = false;
	private _readyPromise: Promise<void>;
	private _readyResolve: () => void = () => {};
	private readonly _options: AppLifecycleOptions;

	constructor(options: AppLifecycleOptions) {
		super();
		this._options = options;
		this._readyPromise = new Promise<void>((resolve) => {
			this._readyResolve = resolve;
		});
	}

	public get isReady(): boolean {
		return this._isReady;
	}

	public get isQuitting(): boolean {
		return this._isQuitting;
	}

	public whenReady(): Promise<void> {
		return this._readyPromise;
	}

	public install(): void {
		const onBeforeQuit = (event: Electron.Event): void => {
			if (this._options.hasUnsavedChanges?.()) {
				const proceed = this._options.onBeforeQuit?.() ?? true;
				if (!proceed) {
					event.preventDefault();
					return;
				}
			}
			this._options.onBeforeQuit?.();
			this._options.flushUnsaved?.();
		};

		const onWillQuit = (): void => {
			this._isQuitting = true;
			this._options.onWillQuit?.();
		};

		const onWindowAllClosed = (): void => {
			if (this._options.keepRunningWhenWindowAllClosed ?? process.platform === 'darwin') {
				return;
			}
			app.quit();
		};

		this._register(toDisposable(() => {
			app.removeListener('before-quit', onBeforeQuit as any);
			app.removeListener('will-quit', onWillQuit);
			app.removeListener('window-all-closed', onWindowAllClosed);
		}));

		app.on('before-quit', onBeforeQuit);
		app.on('will-quit', onWillQuit);
		app.on('window-all-closed', onWindowAllClosed);

		app.whenReady().then(() => {
			this._isReady = true;
			this._readyResolve();
			this._options.onReady?.();
			this._options.createWindow();

			app.on('activate', () => {
				this._options.onActivate?.();
				if (BrowserWindow.getAllWindows().length === 0) {
					this._options.createWindow();
				}
			});

			app.on('second-instance', (_event: any, argv: string[], workingDirectory: string) => {
				this._options.onSecondInstance?.(argv, workingDirectory);
				const win = BrowserWindow.getAllWindows()[0];
				if (win) {
					if (win.isMinimized()) {
						win.restore();
					}
					win.show();
					win.focus();
				}
			});

			app.on('open-file', (event: Electron.Event, filePath: string) => {
				event.preventDefault();
				this._options.onOpenFile?.(filePath);
			});

			app.on('open-folder', (event: Electron.Event, folderPath: string) => {
				event.preventDefault();
				this._options.onOpenFolder?.(folderPath);
			});
		}).catch((err: unknown) => {
			console.error('[app-lifecycle] whenReady failed:', err);
		});

		ipcMain.handle('app:hasUnsaved', () => this._options.hasUnsavedChanges?.() ?? false);
		ipcMain.handle('app:flushUnsaved', () => {
			this._options.flushUnsaved?.();
			return { success: true };
		});
		ipcMain.handle('app:quit', () => {
			app.quit();
			return { success: true };
		});
		ipcMain.handle('app:relaunch', () => {
			app.relaunch();
			app.exit(0);
			return { success: true };
		});
	}

	public quit(): void {
		this._isQuitting = true;
		app.quit();
	}

	public relaunch(extraArgs: string[] = []): void {
		app.relaunch({ args: [...process.argv.slice(1), ...extraArgs] });
		app.exit(0);
	}

	public override dispose(): void {
		this._readyResolve();
		super.dispose();
	}
}

export function registerAppLifecycle(options: AppLifecycleOptions): AppLifecycle {
	const lifecycle = new AppLifecycle(options);
	lifecycle.install();
	return lifecycle;
}

export function appIsReady(): boolean {
	return app.isReady();
}

export function whenAppReady(): Promise<void> {
	return app.whenReady();
}

export function quitOnAllWindowsClosed(keepRunningOnMac: boolean = true): void {
	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin' || !keepRunningOnMac) {
			app.quit();
		}
	});
}
