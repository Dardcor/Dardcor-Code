/**
 * Dardcor Code - File Provider Registry (Task 157)
 * Mirrors: vs/platform/files/common/files.ts scheme provider map
 */

import { IDisposable } from '../../core/lifecycle/disposable';
import { URI } from '../../core/types/uri';
import { IFileSystemProvider } from './file-service';

export class FileProviderRegistry {
	private readonly _providers = new Map<string, IFileSystemProvider>();

	registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable {
		this._providers.set(scheme, provider);
		return {
			dispose: () => {
				if (this._providers.get(scheme) === provider) {
					this._providers.delete(scheme);
				}
			}
		};
	}

	getProvider(scheme: string): IFileSystemProvider | undefined {
		return this._providers.get(scheme);
	}

	getProviderForUri(uri: URI): IFileSystemProvider | undefined {
		return this._providers.get(uri.scheme);
	}
}

const fileProviderRegistryInstance = new FileProviderRegistry();

export function getFileProviderRegistry(): FileProviderRegistry {
	return fileProviderRegistryInstance;
}
