/**
 * Dardcor Code - Extension Execution Location Kind Resolver (Task 626)
 * Mirrors: vs/workbench/api/common/extHostExtensionService.ts (ExtensionKind)
 */

import { IExtensionManifest } from './extension-manifest.js';

export enum ExtensionKind {
	UI = 1,
	Workspace = 2
}

export const ExtensionKindLabel: Record<ExtensionKind, string> = {
	[ExtensionKind.UI]: 'ui',
	[ExtensionKind.Workspace]: 'workspace'
};

export interface IExtensionKindResolverOptions {
	readonly args?: string[];
}

export class ExtensionKindError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ExtensionKindError';
	}
}

/**
 * Determines whether an extension runs inside the UI (main) process or
 * inside the isolated workspace Extension Host process, honoring
 * `--extensionKind` CLI overrides and the manifest's `extensionKind`.
 */
export class ExtensionKindResolver {
	constructor(private readonly _options: IExtensionKindResolverOptions = {}) {}

	public resolve(manifest: IExtensionManifest, defaultKind: ExtensionKind = ExtensionKind.Workspace): ExtensionKind {
		const args = this._options.args ?? [];
		for (let i = 0; i < args.length - 1; i++) {
			if (args[i] === '--extensionKind' || args[i] === '--extension-kind') {
				const value = args[i + 1];
				const kinds = value.split(',');
				for (const raw of kinds) {
					const [id, kind] = this._splitIdAndKind(raw);
					if (id === '*' || id === `${manifest.publisher}.${manifest.name}`) {
						const parsed = ExtensionKindResolver.parseKind(kind);
						if (parsed !== undefined) {
							return parsed;
						}
					}
				}
			}
		}
		return ExtensionKindResolver.fromManifest(manifest, defaultKind);
	}

	public static fromManifest(manifest: IExtensionManifest, defaultKind: ExtensionKind = ExtensionKind.Workspace): ExtensionKind {
		const raw = manifest.extensionKind;
		if (raw === undefined) {
			return defaultKind;
		}
		const kinds = (Array.isArray(raw) ? raw : [raw]).map(k => ExtensionKindResolver.parseKind(k));
		if (kinds.length === 0 || kinds.some(k => k === undefined)) {
			return defaultKind;
		}
		return kinds[0] === ExtensionKind.UI ? ExtensionKind.UI : ExtensionKind.Workspace;
	}

	public static parseKind(value: string | undefined): ExtensionKind | undefined {
		switch (value) {
			case 'ui':
				return ExtensionKind.UI;
			case 'workspace':
			case 'workspaceOnly':
				return ExtensionKind.Workspace;
			default:
				return undefined;
		}
	}

	private _splitIdAndKind(entry: string): [string, string] {
		const idx = entry.lastIndexOf(':');
		if (idx === -1) {
			return [entry, 'workspace'];
		}
		return [entry.substring(0, idx), entry.substring(idx + 1)];
	}
}
