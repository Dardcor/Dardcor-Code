import { app, dialog, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';

export interface InstallerResult {
	success: boolean;
	error?: string;
}

export class UpdateInstaller extends Disposable {
	public install(updatePath: string): Promise<InstallerResult> {
		if (!fs.existsSync(updatePath)) {
			return Promise.resolve({ success: false, error: `Update file not found: ${updatePath}` });
		}
		if (process.platform === 'win32') {
			return this._installWindows(updatePath);
		}
		if (process.platform === 'darwin') {
			return this._installMac(updatePath);
		}
		return Promise.resolve({ success: false, error: `Auto-install not supported on ${process.platform}` });
	}

	public isInstallerSupported(): boolean {
		return process.platform === 'win32' || process.platform === 'darwin';
	}

	public async installWithConfirmation(window: BrowserWindow | null | undefined, updatePath: string): Promise<InstallerResult> {
		const parent = window && !window.isDestroyed() ? window : undefined;
		const result = parent
			? await dialog.showMessageBox(parent, {
				type: 'question',
				title: 'Dardcor Code',
				message: 'An update is ready to install.',
				detail: 'Installing will close the application. Continue?',
				buttons: ['Install', 'Cancel'],
				defaultId: 0,
				cancelId: 1,
				noLink: true
			})
			: await dialog.showMessageBox({
				type: 'question',
				title: 'Dardcor Code',
				message: 'An update is ready to install.',
				detail: 'Installing will close the application. Continue?',
				buttons: ['Install', 'Cancel'],
				defaultId: 0,
				cancelId: 1,
				noLink: true
			});
		if (result.response !== 0) {
			return { success: false, error: 'Cancelled by user' };
		}
		return this.install(updatePath);
	}

	public getInstallLog(): string[] {
		return [...this._installLog];
	}

	public clearInstallLog(): void {
		(this as any)._installLog = [];
	}

	public override dispose(): void {
		super.dispose();
	}

	private readonly _installLog: string[] = [];

	private _log(message: string): void {
		this._installLog.push(`[${new Date().toISOString()}] ${message}`);
		console.log(`[update-installer] ${message}`);
	}

	private _installWindows(updatePath: string): Promise<InstallerResult> {
		return new Promise((resolve) => {
			const ext = path.extname(updatePath).toLowerCase();
			this._log(`installing '${updatePath}' (${ext})`);
			if (ext === '.exe' || ext === '.msi') {
				const child = spawn(updatePath, ext === '.msi' ? ['/quiet', '/norestart'] : ['--updated'], {
					detached: true,
					stdio: 'ignore',
					windowsHide: false
				});
				child.unref();
				this._log('installer launched');
				resolve({ success: true });
				return;
			}
			resolve({ success: false, error: `Unsupported installer type: ${ext}` });
		});
	}

	private _installMac(updatePath: string): Promise<InstallerResult> {
		return new Promise((resolve) => {
			const ext = path.extname(updatePath).toLowerCase();
			this._log(`installing '${updatePath}' (${ext})`);
			if (ext === '.dmg') {
				const child = spawn('open', [updatePath], {
					detached: true,
					stdio: 'ignore'
				});
				child.unref();
				this._log('dmg opened');
				resolve({ success: true });
				return;
			}
			if (ext === '.zip') {
				const child = spawn('open', ['-a', 'Archive Utility', updatePath], {
					detached: true,
					stdio: 'ignore'
				});
				child.unref();
				resolve({ success: true });
				return;
			}
			resolve({ success: false, error: `Unsupported installer type: ${ext}` });
		});
	}
}

export function createUpdateInstaller(): UpdateInstaller {
	return new UpdateInstaller();
}
