/**
 * Dardcor Code - Extension Scanner (Task 179)
 * Mirrors: vs/platform/extensionManagement/common/extensionScanner.ts
 */

import { URI } from '../../core/types/uri.js';
import { IFileSystemProvider } from '../files/file-service.js';

export interface IExtensionManifest {
	name: string;
	displayName?: string;
	version: string;
	publisher: string;
	description?: string;
	main?: string;
	engines: {
		vscode?: string;
		'dardcor-code'?: string;
	};
	contributes?: Record<string, any>;
}

export async function readExtensionManifest(extensionDir: URI, fsProvider: IFileSystemProvider): Promise<IExtensionManifest | null> {
	try {
		const packageJsonUri = URI.from({
			scheme: extensionDir.scheme,
			path: `${extensionDir.path}/package.json`
		});
		const buf = await fsProvider.readFile(packageJsonUri);
		const text = new TextDecoder().decode(buf);
		const manifest: IExtensionManifest = JSON.parse(text);
		if (!manifest.name || !manifest.version || !manifest.publisher) {
			return null;
		}
		return manifest;
	} catch {
		return null;
	}
}
