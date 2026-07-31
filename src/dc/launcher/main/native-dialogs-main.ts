import { BrowserWindow, dialog, MessageBoxOptions, OpenDialogOptions, SaveDialogOptions } from 'electron';
import * as fs from 'fs';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface DialogResult {
	ok: boolean;
	filePath?: string;
	filePaths?: string[];
	canceled?: boolean;
	response?: number;
	checked?: boolean;
}

export class NativeDialogs extends Disposable {
	public resolveWindow(window: BrowserWindow | null | undefined): BrowserWindow | undefined {
		if (window && !window.isDestroyed()) {
			return window;
		}
		return this.handleMissingDialogWindow();
	}

	public handleMissingDialogWindow(): BrowserWindow | undefined {
		const windows = BrowserWindow.getAllWindows();
		const visible = windows.find((w) => !w.isDestroyed() && w.isVisible());
		return visible ?? (windows.length > 0 ? windows[0] : undefined);
	}

	public async showOpenFolder(window?: BrowserWindow | null, options: Partial<OpenDialogOptions> = {}): Promise<DialogResult> {
		const win = this.resolveWindow(window);
		const result = win
			? await dialog.showOpenDialog(win, {
				title: options.title ?? 'Open Folder',
				properties: ['openDirectory', ...(options.properties ?? [])]
			})
			: await dialog.showOpenDialog({
				title: options.title ?? 'Open Folder',
				properties: ['openDirectory', ...(options.properties ?? [])]
			});
		return this._mapOpenResult(result);
	}

	public async showOpenFile(window?: BrowserWindow | null, filters?: Electron.FileFilter[], options: Partial<OpenDialogOptions> = {}): Promise<DialogResult> {
		const win = this.resolveWindow(window);
		const dialogOptions: OpenDialogOptions = {
			title: options.title ?? 'Open File',
			filters: filters && filters.length > 0 ? filters : [{ name: 'All Files', extensions: ['*'] }],
			properties: ['openFile', ...(options.properties ?? [])]
		};
		const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
		return this._mapOpenResult(result);
	}

	public async showSaveFile(window?: BrowserWindow | null, defaultPath?: string, options: Partial<SaveDialogOptions> = {}): Promise<DialogResult> {
		const win = this.resolveWindow(window);
		const dialogOptions: SaveDialogOptions = {
			title: options.title ?? 'Save File',
			defaultPath: defaultPath ?? options.defaultPath,
			filters: options.filters ?? [{ name: 'All Files', extensions: ['*'] }]
		};
		const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
		return {
			ok: !result.canceled && !!result.filePath,
			filePath: result.filePath ?? undefined,
			canceled: result.canceled
		};
	}

	public async showMessage(window: BrowserWindow | null | undefined, options: MessageBoxOptions): Promise<DialogResult> {
		const win = this.resolveWindow(window);
		const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
		return { ok: true, response: result.response, checked: result.checkboxChecked };
	}

	public showError(window: BrowserWindow | null | undefined, message: string, detail?: string): void {
		const win = this.resolveWindow(window);
		if (win) {
			dialog.showErrorBox(message, detail ?? '');
		} else {
			dialog.showErrorBox(message, detail ?? '');
		}
	}

	public async showWarning(window: BrowserWindow | null | undefined, options: Partial<MessageBoxOptions> = {}): Promise<DialogResult> {
		const win = this.resolveWindow(window);
		const messageOptions: MessageBoxOptions = {
			type: 'warning',
			title: options.title ?? 'Dardcor Code',
			message: options.message ?? 'Warning',
			detail: options.detail,
			buttons: options.buttons ?? ['OK'],
			noLink: options.noLink ?? true
		};
		const result = win ? await dialog.showMessageBox(win, messageOptions) : await dialog.showMessageBox(messageOptions);
		return { ok: true, response: result.response, checked: result.checkboxChecked };
	}

	public async showConfirm(window: BrowserWindow | null | undefined, message: string, detail?: string): Promise<boolean> {
		const result = await dialog.showMessageBox(window || undefined as any, {
			type: 'question',
			title: 'Dardcor Code',
			message,
			detail,
			buttons: ['Yes', 'No'],
			defaultId: 0,
			cancelId: 1,
			noLink: true
		});
		return result.response === 0;
	}

	public async pickFolderFromEvent(event: any): Promise<string | null> {
		const win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : undefined;
		const result = await this.showOpenFolder(win ?? undefined);
		return result.ok ? (result.filePath ?? null) : null;
	}

	public async isDirectoryReadable(dirPath: string): Promise<boolean> {
		try {
			await fs.promises.access(dirPath, fs.constants.R_OK);
			const stat = await fs.promises.stat(dirPath);
			return stat.isDirectory();
		} catch {
			return false;
		}
	}

	private _mapOpenResult(result: Electron.OpenDialogReturnValue): DialogResult {
		const filePaths = result.canceled ? [] : result.filePaths;
		return {
			ok: !result.canceled && filePaths.length > 0,
			filePaths,
			filePath: filePaths.length > 0 ? filePaths[0] : undefined,
			canceled: result.canceled
		};
	}
}

export function createNativeDialogs(): NativeDialogs {
	return new NativeDialogs();
}
