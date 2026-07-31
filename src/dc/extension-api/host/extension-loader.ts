/**
 * Dardcor Code - Dynamic Node require() Extension Module Loader (Task 603)
 * Mirrors: vs/workbench/api/node/extHostExtensionService.ts (module loading)
 */

import * as path from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';
import * as fsp from 'node:fs/promises';
import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface ILoadedExtensionModule {
	readonly exports: any;
	readonly activate?: (context: any) => any | Promise<any>;
	readonly deactivate?: () => void | Promise<void>;
	readonly activateError?: Error;
}

export interface IExtensionLoaderOptions {
	readonly api: any;
	readonly timeoutMs?: number;
}

/**
 * Loads an extension's entry point with a real Node `require()`, while
 * mapping `vscode`/`dc` module requests to the in-process API namespace.
 */
export class ExtensionLoader extends Disposable {
	private readonly _cache = new Map<string, Promise<ILoadedExtensionModule>>();

	private readonly _onDidLoad = this._register(new Emitter<{ id: string; mainPath: string }>());
	readonly onDidLoad: Event<{ id: string; mainPath: string }> = this._onDidLoad.event;

	private readonly _onDidFail = this._register(new Emitter<{ id: string; mainPath: string; error: Error }>());
	readonly onDidFail: Event<{ id: string; mainPath: string; error: Error }> = this._onDidFail.event;

	constructor(private readonly _options: IExtensionLoaderOptions) {
		super();
	}

	public async load(id: string, mainPath: string): Promise<ILoadedExtensionModule> {
		const cached = this._cache.get(id);
		if (cached) {
			return cached;
		}
		const promise = this._loadUncached(id, mainPath);
		this._cache.set(id, promise);
		try {
			await promise;
		} catch (err) {
			this._cache.delete(id);
		}
		return promise;
	}

	public isLoaded(id: string): boolean {
		return this._cache.has(id);
	}

	public clearCache(id?: string): void {
		if (id) {
			this._cache.delete(id);
		} else {
			this._cache.clear();
		}
	}

	private async _loadUncached(id: string, mainPath: string): Promise<ILoadedExtensionModule> {
		const absolute = path.resolve(mainPath);
		const timeout = this._options.timeoutMs ?? 15_000;
		const timer = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(`Ekstensi '${id}' timeout saat dimuat (${timeout}ms)`)), timeout);
		});
		try {
			return await Promise.race([this._doLoad(id, absolute), timer]);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			this._onDidFail.fire({ id, mainPath, error });
			throw error;
		}
	}

	private async _doLoad(id: string, absolute: string): Promise<ILoadedExtensionModule> {
		const exists = await fsp.stat(absolute).then(s => s.isFile()).catch(() => false);
		if (!exists) {
			throw new Error(`Entry point tidak ditemukan: ${absolute}`);
		}

		const api = this._options.api;
		const req = createRequire(absolute);
		const originalLoad = (Module as any)._load;
		(Module as any)._load = function (request: string, parent: any, isMain: boolean): any {
			if (request === 'vscode' || request === 'dc') {
				return api;
			}
			return originalLoad.call(this, request, parent, isMain);
		};

		let raw: any;
		try {
			raw = req(absolute);
		} finally {
			(Module as any)._load = originalLoad;
		}

		const exports = raw && typeof raw === 'object' && 'default' in raw ? raw.default : raw;
		this._onDidLoad.fire({ id, mainPath: absolute });
		return {
			exports,
			activate: typeof exports?.activate === 'function' ? exports.activate : undefined,
			deactivate: typeof exports?.deactivate === 'function' ? exports.deactivate : undefined
		};
	}
}
