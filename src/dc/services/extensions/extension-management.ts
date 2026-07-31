/**
 * Dardcor Code - Extension Management Service (Task 150)
 * Mirrors: vs/platform/extensionManagement/common/extensionManagement.ts
 */

import { URI } from '../../core/types/uri.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { IDisposable } from '../../core/lifecycle/disposable.js';

export interface ILocalExtension {
	identifier: { id: string };
	version: string;
	location: URI;
	manifest: any;
	isBuiltin: boolean;
}

export const IExtensionManagementService = Symbol('IExtensionManagementService');

export interface IExtensionManagementService extends IDisposable {
	readonly onInstallExtension: Event<ILocalExtension>;
	readonly onDidInstallExtension: Event<{ identifier: { id: string }; error?: Error }>;
	readonly onUninstallExtension: Event<{ id: string }>;
	readonly onDidUninstallExtension: Event<{ id: string; error?: Error }>;
	getInstalled(type?: number): Promise<ILocalExtension[]>;
	install(vsix: URI): Promise<ILocalExtension>;
	uninstall(extension: ILocalExtension): Promise<void>;
}

export class ExtensionManagementService implements IExtensionManagementService {
	private readonly _installed: ILocalExtension[] = [];
	private readonly _onInstallExtension = new Emitter<ILocalExtension>();
	private readonly _onDidInstallExtension = new Emitter<{ identifier: { id: string }; error?: Error }>();
	private readonly _onUninstallExtension = new Emitter<{ id: string }>();
	private readonly _onDidUninstallExtension = new Emitter<{ id: string; error?: Error }>();

	readonly onInstallExtension = this._onInstallExtension.event;
	readonly onDidInstallExtension = this._onDidInstallExtension.event;
	readonly onUninstallExtension = this._onUninstallExtension.event;
	readonly onDidUninstallExtension = this._onDidUninstallExtension.event;

	async getInstalled(_type?: number): Promise<ILocalExtension[]> {
		return [...this._installed];
	}

	async install(vsix: URI): Promise<ILocalExtension> {
		const ext: ILocalExtension = {
			identifier: { id: vsix.path.split('/').pop()?.replace('.vsix', '') || 'unknown.extension' },
			version: '1.0.0',
			location: vsix,
			manifest: {},
			isBuiltin: false,
		};
		this._onInstallExtension.fire(ext);
		this._installed.push(ext);
		this._onDidInstallExtension.fire({ identifier: ext.identifier });
		return ext;
	}

	async uninstall(extension: ILocalExtension): Promise<void> {
		this._onUninstallExtension.fire({ id: extension.identifier.id });
		const idx = this._installed.indexOf(extension);
		if (idx >= 0) {
			this._installed.splice(idx, 1);
		}
		this._onDidUninstallExtension.fire({ id: extension.identifier.id });
	}

	dispose(): void {
		this._onInstallExtension.dispose();
		this._onDidInstallExtension.dispose();
		this._onUninstallExtension.dispose();
		this._onDidUninstallExtension.dispose();
	}
}
