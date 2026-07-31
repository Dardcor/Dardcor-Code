import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { ExtensionLoader, ILoadedExtensionModule } from './extension-loader.js';
import { ExtensionManifestParser, IExtensionDescriptor, IExtensionManifest } from './extension-manifest.js';
import { createExtensionContext, ExtensionContext } from './extension-context.js';

export interface IActivatedExtension {
	readonly id: string;
	readonly manifest: IExtensionManifest;
	readonly descriptor: IExtensionDescriptor;
	readonly module: ILoadedExtensionModule;
	readonly context: ExtensionContext;
	readonly activationTime: number;
}

export interface IExtensionActivationEvent {
	readonly id: string;
	readonly reason: string;
}

export interface IExtensionHostServiceOptions {
	readonly api?: any;
	readonly extensionHostDebugPort?: number;
	readonly globalStoragePath?: string;
	readonly workspaceStoragePath?: string;
	readonly logPath?: string;
	readonly timeoutMs?: number;
}

export class ExtensionHostService extends Disposable {
	private readonly _loader: ExtensionLoader;
	private readonly _activated = new Map<string, IActivatedExtension>();
	private readonly _globalStoragePath: string;
	private readonly _workspaceStoragePath: string;
	private readonly _logPath: string;

	private readonly _onDidActivateExtension = this._register(new Emitter<IExtensionActivationEvent>());
	readonly onDidActivateExtension: Event<IExtensionActivationEvent> = this._onDidActivateExtension.event;

	private readonly _onDidDeactivateExtension = this._register(new Emitter<IExtensionActivationEvent>());
	readonly onDidDeactivateExtension: Event<IExtensionActivationEvent> = this._onDidDeactivateExtension.event;

	private readonly _onDidFailToActivateExtension = this._register(new Emitter<{ id: string; error: Error }>());
	readonly onDidFailToActivateExtension: Event<{ id: string; error: Error }> = this._onDidFailToActivateExtension.event;

	constructor(private readonly _options: IExtensionHostServiceOptions = {}) {
		super();
		this._loader = this._register(new ExtensionLoader({
			api: this._options.api ?? { version: '1.90.0' },
			timeoutMs: this._options.timeoutMs
		}));
		this._globalStoragePath = this._options.globalStoragePath ?? path.join('.dardcor', 'extensions', 'global');
		this._workspaceStoragePath = this._options.workspaceStoragePath ?? path.join('.dardcor', 'extensions', 'workspace');
		this._logPath = this._options.logPath ?? this._globalStoragePath;
	}

	public async activateExtensions(extensionPaths: string[], reason = 'startup'): Promise<IActivatedExtension[]> {
		const activated: IActivatedExtension[] = [];
		for (const extensionPath of extensionPaths) {
			try {
				activated.push(await this.activateExtension(extensionPath, reason));
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				console.error(`[extension-service] Gagal mengaktifkan ekstensi di '${extensionPath}':`, error);
			}
		}
		return activated;
	}

	public async activateExtension(extensionPath: string, reason = 'startup'): Promise<IActivatedExtension> {
		const manifestPath = path.join(extensionPath, 'package.json');
		const raw = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
		const manifest = new ExtensionManifestParser().parse(raw, manifestPath);
		const descriptor = ExtensionManifestParser.createDescriptor(extensionPath, manifest);
		const existing = this._activated.get(descriptor.id);
		if (existing) {
			return existing;
		}
		if (!descriptor.mainPath) {
			throw new Error(`Ekstensi '${descriptor.id}' tidak memiliki entry point 'main'`);
		}
		try {
			const module = await this._loader.load(descriptor.id, descriptor.mainPath);
			const context = createExtensionContext({
				extensionPath: descriptor.extensionPath,
				extensionUri: URI.file(descriptor.extensionPath),
				globalStoragePath: path.join(this._globalStoragePath, descriptor.id),
				workspaceStoragePath: path.join(this._workspaceStoragePath, descriptor.id),
				logPath: path.join(this._logPath, descriptor.id)
			});
			const activationStarted = Date.now();
			if (module.activate) {
				await module.activate(context);
			}
			const activated: IActivatedExtension = {
				id: descriptor.id,
				manifest,
				descriptor,
				module,
				context,
				activationTime: Date.now() - activationStarted
			};
			this._activated.set(descriptor.id, activated);
			this._onDidActivateExtension.fire({ id: descriptor.id, reason });
			return activated;
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			this._onDidFailToActivateExtension.fire({ id: descriptor.id, error });
			throw error;
		}
	}

	public async deactivateAll(reason = 'shutdown'): Promise<void> {
		const ids = [...this._activated.keys()];
		for (const id of ids) {
			await this.deactivateExtension(id, reason);
		}
	}

	public async deactivateExtension(id: string, reason = 'dispose'): Promise<void> {
		const activated = this._activated.get(id);
		if (!activated) {
			return;
		}
		this._activated.delete(id);
		try {
			await activated.module.deactivate?.();
		} catch (err) {
			console.error(`[extension-service] Gagal menonaktifkan '${id}':`, err);
		} finally {
			activated.context.dispose();
			this._onDidDeactivateExtension.fire({ id, reason });
		}
	}

	public getActivatedExtensions(): IActivatedExtension[] {
		return [...this._activated.values()];
	}

	public getExtension(id: string): IActivatedExtension | undefined {
		return this._activated.get(id);
	}

	public isActivated(id: string): boolean {
		return this._activated.has(id);
	}

	public get activatedIds(): string[] {
		return [...this._activated.keys()];
	}

	public get count(): number {
		return this._activated.size;
	}

	public get extensionHostDebugPort(): number | undefined {
		return this._options.extensionHostDebugPort;
	}

	public override dispose(): void {
		this.deactivateAll('dispose').catch(() => undefined);
		super.dispose();
	}
}
