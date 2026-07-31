/**
 * Dardcor Code - Remote Directory Extension Scanner (Task 825)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { RemoteFileWatcher } from '../files/remote-file-watcher.js';

export interface IRemoteExtensionInfo {
	readonly id: string;
	readonly name: string;
	readonly publisher: string;
	readonly version: string;
	readonly description?: string;
	readonly displayName?: string;
	readonly path: string;
	readonly activationEvents?: string[];
	readonly contributes?: Record<string, any>;
	readonly isBuiltin: boolean;
	readonly isActive: boolean;
}

interface ExtensionPackage {
	readonly name?: string;
	readonly publisher?: string;
	readonly version?: string;
	readonly description?: string;
	readonly displayName?: string;
	readonly activationEvents?: string[];
	readonly contributes?: Record<string, any>;
}

export class RemoteExtensionScanner extends Disposable {
	private _watcher: RemoteFileWatcher | null = null;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		private readonly _extensionsRoot: string,
		private readonly _builtinRoot?: string
	) {
		super();
	}

	scan(): IRemoteExtensionInfo[] {
		const result: IRemoteExtensionInfo[] = [];
		if (this._builtinRoot) {
			result.push(...this._scanDirectory(this._builtinRoot, true));
		}
		result.push(...this._scanDirectory(this._extensionsRoot, false));
		return result.sort((a, b) => a.id.localeCompare(b.id));
	}

	findById(id: string): IRemoteExtensionInfo | undefined {
		return this.scan().find(ext => ext.id === id);
	}

	count(): number {
		return this.scan().length;
	}

	startWatching(): void {
		if (this._watcher) {
			return;
		}
		try {
			this._watcher = this._register(new RemoteFileWatcher(this._extensionsRoot, { recursive: true, debounceMs: 200 }));
			this._register(this._watcher.onDidChange(() => this._onDidChange.fire()));
			this._watcher.watchAll();
		} catch {
			// Watching is best-effort.
		}
	}

	private _scanDirectory(root: string, isBuiltin: boolean): IRemoteExtensionInfo[] {
		let entries: string[];
		try {
			entries = readdirSync(root);
		} catch {
			return [];
		}
		const result: IRemoteExtensionInfo[] = [];
		for (const entry of entries) {
			const entryPath = join(root, entry);
			try {
				const stat = statSync(entryPath);
				if (!stat.isDirectory()) {
					continue;
				}
			} catch {
				continue;
			}
			if (isObsoleteMarkerDir(root, entry)) {
				continue;
			}
			const pkg = this._readPackage(entryPath);
			if (pkg) {
				result.push(this._toInfo(pkg, entryPath, isBuiltin));
				continue;
			}
			// Some extensions are packed in a nested folder (e.g. unpacked VSIX layouts).
			let found = false;
			try {
				for (const sub of readdirSync(entryPath)) {
					const subPath = join(entryPath, sub);
					const subPkg = this._readPackage(subPath);
					if (subPkg) {
						result.push(this._toInfo(subPkg, subPath, isBuiltin));
						found = true;
					}
				}
			} catch {
				// ignore
			}
			if (!found && isBuiltin && !entry.startsWith('.')) {
				result.push({
					id: entry,
					name: entry,
					publisher: 'builtin',
					version: '0.0.0',
					path: entryPath,
					isBuiltin: true,
					isActive: true
				});
			}
		}
		return result;
	}

	private _readPackage(directory: string): ExtensionPackage | null {
		const packagePath = join(directory, 'package.json');
		try {
			const content = readFileSync(packagePath, 'utf8');
			const pkg = JSON.parse(content) as ExtensionPackage;
			if (typeof pkg.name === 'string' && typeof pkg.version === 'string') {
				return pkg;
			}
		} catch {
			return null;
		}
		return null;
	}

	private _toInfo(pkg: ExtensionPackage, path: string, isBuiltin: boolean): IRemoteExtensionInfo {
		const publisher = pkg.publisher ?? (isBuiltin ? 'builtin' : 'unknown');
		const name = pkg.name!;
		return {
			id: `${publisher}.${name}`,
			name,
			publisher,
			version: pkg.version!,
			description: pkg.description,
			displayName: pkg.displayName,
			path,
			activationEvents: pkg.activationEvents,
			contributes: pkg.contributes,
			isBuiltin,
			isActive: true
		};
	}
}

function isObsoleteMarkerDir(root: string, entry: string): boolean {
	const marker = join(root, entry, '.obsolete');
	try {
		readFileSync(marker, 'utf8');
		return true;
	} catch {
		return false;
	}
}
