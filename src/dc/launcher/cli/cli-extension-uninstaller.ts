import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getExtensionsDir, readExtensionsIndex, writeExtensionsIndex } from './cli-extension-installer';

export class CLIExtensionUninstaller {
	constructor(private readonly _extensionsRoot?: string) {}

	public get extensionsRoot(): string {
		return this._extensionsRoot ?? getExtensionsDir();
	}

	public async uninstall(extensionId: string): Promise<boolean> {
		try {
			const id = extensionId.trim();
			if (!id) {
				return false;
			}
			const index = await readExtensionsIndex(this.extensionsRoot);
			const match = index.extensions.find(e => e.id.toLowerCase() === id.toLowerCase());
			if (!match) {
				return false;
			}
			index.extensions = index.extensions.filter(e => e !== match);
			await writeExtensionsIndex(index, this.extensionsRoot);
			try {
				await rm(join(this.extensionsRoot, match.id), { recursive: true, force: true });
			} catch {
				// Directory already removed - index is already updated.
			}
			return true;
		} catch {
			return false;
		}
	}
}
