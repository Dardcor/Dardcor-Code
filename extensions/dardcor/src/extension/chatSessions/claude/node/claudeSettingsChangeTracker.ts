/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../../platform/filesystem/common/fileTypes';
import { ILogService } from '../../../../platform/log/common/logService';
import { URI } from '../../../../util/dardcor/base/common/uri';

export type SettingsPathResolver = () => URI[];

interface DirectoryResolverConfig {
	resolver: () => URI[];
	extension?: string;
}

export class ClaudeSettingsChangeTracker {
	private readonly _pathResolvers: SettingsPathResolver[] = [];
	private readonly _directoryResolvers: DirectoryResolverConfig[] = [];
	private _snapshot: Map<string, number> = new Map();

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@ILogService private readonly logService: ILogService,
	) { }

	registerPathResolver(resolver: SettingsPathResolver): void {
		this._pathResolvers.push(resolver);
	}

	registerDirectoryResolver(resolver: () => URI[], extension?: string): void {
		this._directoryResolvers.push({ resolver, extension });
	}

	private async _enumerateDirectory(dir: URI, extension?: string): Promise<URI[]> {
		const files: URI[] = [];
		try {
			const entries = await this.fileSystemService.readDirectory(dir);
			for (const [name, type] of entries) {
				if (type & FileType.File) {
					if (!extension || name.endsWith(extension)) {
						files.push(URI.joinPath(dir, name));
					}
				}
			}
		} catch {
		}
		return files;
	}

	private async _getAllPaths(): Promise<URI[]> {
		const syncPaths = this._pathResolvers.flatMap(resolver => resolver());

		const directoryFiles: URI[] = [];
		for (const config of this._directoryResolvers) {
			const dirs = config.resolver();
			for (const dir of dirs) {
				const files = await this._enumerateDirectory(dir, config.extension);
				directoryFiles.push(...files);
			}
		}

		return [...syncPaths, ...directoryFiles];
	}

	async takeSnapshot(): Promise<void> {
		this._snapshot.clear();

		const allPaths = await this._getAllPaths();

		for (const uri of allPaths) {
			try {
				const stat = await this.fileSystemService.stat(uri);
				this._snapshot.set(uri.toString(), stat.mtime);
				this.logService.trace(`[ClaudeSettingsChangeTracker] Snapshot: ${uri.fsPath} mtime=${stat.mtime}`);
			} catch {
				this._snapshot.set(uri.toString(), 0);
				this.logService.trace(`[ClaudeSettingsChangeTracker] Snapshot: ${uri.fsPath} (does not exist)`);
			}
		}
	}

	private async _checkUri(uri: URI): Promise<URI | undefined> {
		const uriString = uri.toString();
		const snapshotMtime = this._snapshot.get(uriString);

		try {
			const stat = await this.fileSystemService.stat(uri);
			if (snapshotMtime === undefined) {
				this.logService.trace(`[ClaudeSettingsChangeTracker] New file detected: ${uri.fsPath}`);
				return uri;
			} else if (stat.mtime > snapshotMtime) {
				this.logService.trace(`[ClaudeSettingsChangeTracker] Changed: ${uri.fsPath} (${snapshotMtime} -> ${stat.mtime})`);
				return uri;
			}
		} catch {
			if (snapshotMtime !== undefined && snapshotMtime > 0) {
				this.logService.trace(`[ClaudeSettingsChangeTracker] Deleted: ${uri.fsPath}`);
				return uri;
			}
		}
		return undefined;
	}

	private async *_changedFilesGenerator(): AsyncGenerator<URI> {
		const seenPaths = new Set<string>();

		for (const resolver of this._pathResolvers) {
			for (const uri of resolver()) {
				seenPaths.add(uri.toString());
				const changed = await this._checkUri(uri);
				if (changed) {
					yield changed;
				}
			}
		}

		for (const config of this._directoryResolvers) {
			for (const dir of config.resolver()) {
				const files = await this._enumerateDirectory(dir, config.extension);
				for (const uri of files) {
					seenPaths.add(uri.toString());
					const changed = await this._checkUri(uri);
					if (changed) {
						yield changed;
					}
				}
			}
		}

		for (const [uriString, mtime] of this._snapshot) {
			if (!seenPaths.has(uriString) && mtime > 0) {
				const uri = URI.parse(uriString);
				this.logService.trace(`[ClaudeSettingsChangeTracker] Deleted (not in current paths): ${uri.fsPath}`);
				yield uri;
			}
		}
	}

	async hasChanges(): Promise<boolean> {
		for await (const _uri of this._changedFilesGenerator()) {
			return true;
		}
		return false;
	}
}
