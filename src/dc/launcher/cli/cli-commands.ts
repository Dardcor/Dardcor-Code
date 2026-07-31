import { spawn } from 'node:child_process';
import { CLIExtensionInstaller } from './cli-extension-installer.js';
import { CLIExtensionUninstaller } from './cli-extension-uninstaller.js';
import { CLIFileOpener } from './cli-file-opener.js';

export interface ICLICommandDriver {
	installExtension(id: string): Promise<void>;
	uninstallExtension(id: string): Promise<void>;
	listExtensions(): Promise<string[]>;
	openFile(path: string): Promise<void>;
	openFolder(path: string): Promise<void>;
}

export class CLICommands {
	constructor(private readonly _driver: ICLICommandDriver = new DefaultCLICommandDriver()) {}

	public async installExtension(id: string): Promise<void> {
		return this._driver.installExtension(id);
	}

	public async uninstallExtension(id: string): Promise<void> {
		return this._driver.uninstallExtension(id);
	}

	public async listExtensions(): Promise<string[]> {
		return this._driver.listExtensions();
	}

	public async openFile(path: string): Promise<void> {
		return this._driver.openFile(path);
	}

	public async openFolder(path: string): Promise<void> {
		return this._driver.openFolder(path);
	}
}

class DefaultCLICommandDriver implements ICLICommandDriver {
	private readonly _fileOpener = new CLIFileOpener();

	public async installExtension(id: string): Promise<void> {
		if (/\.vsix$/i.test(id)) {
			const ok = await new CLIExtensionInstaller().install(id);
			if (!ok) {
				throw new Error(`Failed to install extension from '${id}'`);
			}
			return;
		}
		const mod = await this._loadExtensionServices();
		if (!mod) {
			throw new Error('Extension service unavailable. Provide a .vsix file path: --install-extension <path>.vsix');
		}
		throw new Error(`Marketplace installs are not supported in CLI mode. Provide a .vsix file path: --install-extension <path>.vsix`);
	}

	public async uninstallExtension(id: string): Promise<void> {
		const mod = await this._loadExtensionServices();
		if (mod?.ExtensionManagementService) {
			try {
				const service = this._createService(mod.ExtensionManagementService);
				const installed = await service.getInstalled();
				const match = installed.find((e: any) => e.identifier?.id?.toLowerCase() === id.toLowerCase());
				if (match) {
					await service.uninstall(match);
					return;
				}
				service.dispose();
			} catch {
				// Fall back to index-based uninstall below.
			}
		}
		const ok = await new CLIExtensionUninstaller().uninstall(id);
		if (!ok) {
			throw new Error(`Extension '${id}' is not installed.`);
		}
	}

	public async listExtensions(): Promise<string[]> {
		const mod = await this._loadExtensionServices();
		if (mod?.ExtensionManagementService) {
			try {
				const service = this._createService(mod.ExtensionManagementService);
				const installed = await service.getInstalled();
				const ids = installed.map((e: any) => `${e.identifier?.id}@${e.version ?? '0.0.0'}`);
				service.dispose();
				if (ids.length > 0) {
					return ids;
				}
			} catch {
				// Fall back to index-based listing below.
			}
		}
		return this._listFromIndex();
	}

	public async openFile(path: string): Promise<void> {
		if (this._fileOpener.openInRunningInstance([path])) {
			return;
		}
		await this._launchApp([path]);
	}

	public async openFolder(path: string): Promise<void> {
		if (this._fileOpener.openInRunningInstance([path])) {
			return;
		}
		await this._launchApp([path]);
	}

	private async _loadExtensionServices(): Promise<any | null> {
		try {
			return await import('../../services/extensions/extension-management.js');
		} catch {
			return null;
		}
	}

	private _createService(ExtensionManagementService: any): any {
		return new ExtensionManagementService();
	}

	private async _listFromIndex(): Promise<string[]> {
		const { readExtensionsIndex } = await import('./cli-extension-installer.js');
		const index = await readExtensionsIndex();
		return index.extensions.map(e => `${e.id}@${e.version}`);
	}

	private async _launchApp(args: string[]): Promise<void> {
		let electronPath: string | null = null;
		try {
			const mod: any = await import('electron');
			const resolved = typeof mod === 'string' ? mod : mod?.default;
			if (typeof resolved === 'string') {
				electronPath = resolved;
			}
		} catch {
			electronPath = null;
		}
		if (!electronPath) {
			throw new Error('No running instance found and the desktop app is not available in this environment.');
		}
		const child = spawn(electronPath, ['.', ...args], {
			stdio: 'ignore',
			detached: true
		});
		child.unref();
	}
}
