/**
 * Dardcor Code - Extension Management Service (Task 150)
 * Mirrors: vs/platform/extensionManagement/common/extensionManagement.ts (VSIX installer)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { IFileService } from '../files/file-service.js';
import { unpackVsix } from '../download/extract-tar.js';
import { readExtensionManifest } from './extension-scanner.js';

export interface ILocalExtension {
	identifier: { id: string };
	version: string;
	location: URI;
	manifest: any;
	isBuiltin: boolean;
}

export const IExtensionManagementService = createDecorator<IExtensionManagementService>('extensionManagementService');

export interface IExtensionManagementService {
	readonly _serviceBrand: undefined;
	readonly onInstallExtension: Event<ILocalExtension>;
	readonly onDidInstallExtension: Event<{ identifier: { id: string }; error?: Error }>;
	readonly onUninstallExtension: Event<{ id: string }>;
	readonly onDidUninstallExtension: Event<{ id: string; error?: Error }>;
	getInstalled(type?: number): Promise<ILocalExtension[]>;
	install(vsix: URI): Promise<ILocalExtension>;
	uninstall(extension: ILocalExtension): Promise<void>;
}

export class ExtensionManagementService extends Disposable implements IExtensionManagementService {
	declare readonly _serviceBrand: undefined;

	private readonly _installed: ILocalExtension[] = [];

	private readonly _onInstallExtension = this._register(new Emitter<ILocalExtension>());
	private readonly _onDidInstallExtension = this._register(new Emitter<{ identifier: { id: string }; error?: Error }>());
	private readonly _onUninstallExtension = this._register(new Emitter<{ id: string }>());
	private readonly _onDidUninstallExtension = this._register(new Emitter<{ id: string; error?: Error }>());

	readonly onInstallExtension = this._onInstallExtension.event;
	readonly onDidInstallExtension = this._onDidInstallExtension.event;
	readonly onUninstallExtension = this._onUninstallExtension.event;
	readonly onDidUninstallExtension = this._onDidUninstallExtension.event;

	constructor(
		private readonly _fileService?: IFileService,
		private readonly _extensionsRoot?: URI
	) {
		super();
	}

	async getInstalled(_type?: number): Promise<ILocalExtension[]> {
		return [...this._installed];
	}

	async install(vsix: URI): Promise<ILocalExtension> {
		const fallbackId = this._idFromVsixName(vsix);
		const placeholder: ILocalExtension = {
			identifier: { id: fallbackId },
			version: '0.0.0',
			location: vsix,
			manifest: {},
			isBuiltin: false,
		};
		this._onInstallExtension.fire(placeholder);
		try {
			if (!this._fileService) {
				throw new Error('IFileService is required to install extensions');
			}
			const { content } = await this._fileService.readFile(vsix);
			const basePath = this._extensionsRoot?.path ?? `${vsix.path}/extensions`;
			const destDir = URI.from({ scheme: vsix.scheme, path: `${basePath}/${fallbackId}` });
			await unpackVsix(content.buffer, destDir, this._fileService);

			const provider = this._fileService.getProvider(destDir.scheme);
			const manifest = provider ? await readExtensionManifest(destDir, provider) : null;

			const extension: ILocalExtension = {
				identifier: { id: manifest ? `${manifest.publisher}.${manifest.name}` : fallbackId },
				version: manifest?.version ?? '1.0.0',
				location: destDir,
				manifest: manifest ?? {},
				isBuiltin: false,
			};
			this._installed.push(extension);
			this._onDidInstallExtension.fire({ identifier: extension.identifier });
			return extension;
		} catch (error) {
			this._onDidInstallExtension.fire({
				identifier: placeholder.identifier,
				error: error instanceof Error ? error : new Error(String(error)),
			});
			throw error;
		}
	}

	async uninstall(extension: ILocalExtension): Promise<void> {
		this._onUninstallExtension.fire({ id: extension.identifier.id });
		const idx = this._installed.indexOf(extension);
		if (idx >= 0) {
			this._installed.splice(idx, 1);
		}
		this._onDidUninstallExtension.fire({ id: extension.identifier.id });
	}

	private _idFromVsixName(vsix: URI): string {
		return vsix.path.split('/').pop()?.replace(/\.vsix$/i, '') || 'unknown.extension';
	}
}
