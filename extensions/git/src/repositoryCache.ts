/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogOutputChannel, Memento, Uri, workspace } from 'vscode';
import { LRUCache } from './cache';
import type { Remote, RepositoryAccessDetails } from './api/git';
import { isDescendant } from './util';

export interface RepositoryCacheInfo {
	repositoryPath: string;
	workspacePath: string;
	lastTouchedTime?: number;
}

function isRepositoryCacheInfo(obj: unknown): obj is RepositoryCacheInfo {
	if (!obj || typeof obj !== 'object') {
		return false;
	}
	const rec = obj as Record<string, unknown>;
	return typeof rec.workspacePath === 'string' && typeof rec.repositoryPath === 'string' &&
		(rec.lastTouchedTime === undefined || typeof rec.lastTouchedTime === 'number');
}

export class RepositoryCache {

	private static readonly STORAGE_KEY = 'git.repositoryCache';
	private static readonly MAX_REPO_ENTRIES = 30;
	private static readonly MAX_FOLDER_ENTRIES = 10;

	private normalizeRepoUrl(url: string): string {
		try {
			const trimmed = url.trim();
			return trimmed.replace(/(?:\.git)?\/*$/i, '');
		} catch {
			return url;
		}
	}

	private readonly lru = new LRUCache<string, LRUCache<string, RepositoryCacheInfo>>(RepositoryCache.MAX_REPO_ENTRIES);

	private _recentRepositories: Map<string, number> | undefined;

	get recentRepositories(): Iterable<RepositoryAccessDetails> {
		if (!this._recentRepositories) {
			this._recentRepositories = new Map<string, number>();

			for (const [_, inner] of this.lru) {
				for (const [, repositoryDetails] of inner) {
					if (!repositoryDetails.repositoryPath || !repositoryDetails.lastTouchedTime) {
						continue;
					}

					const repositoryLastAccessTime = this._recentRepositories.get(repositoryDetails.repositoryPath);
					if (repositoryLastAccessTime && repositoryDetails.lastTouchedTime <= repositoryLastAccessTime) {
						continue;
					}

					this._recentRepositories.set(repositoryDetails.repositoryPath, repositoryDetails.lastTouchedTime);
				}
			}
		}

		return Array.from(this._recentRepositories.entries()).map(([rootPath, lastAccessTime]) =>
			({ rootUri: Uri.file(rootPath), lastAccessTime } satisfies RepositoryAccessDetails));
	}

	constructor(public readonly _globalState: Memento, private readonly _logger: LogOutputChannel) {
		this.load();
	}

	protected get _workspaceFile() {
		return workspace.workspaceFile;
	}

	protected get _workspaceFolders() {
		return workspace.workspaceFolders;
	}

	set(repoUrl: string, rootPath: string): void {
		const key = this.normalizeRepoUrl(repoUrl);
		let foldersLru = this.lru.get(key);
		if (!foldersLru) {
			foldersLru = new LRUCache<string, RepositoryCacheInfo>(RepositoryCache.MAX_FOLDER_ENTRIES);
		}
		const folderPathOrWorkspaceFile: string | undefined = this._findWorkspaceForRepo(rootPath);
		if (!folderPathOrWorkspaceFile) {
			return;
		}

		foldersLru.set(folderPathOrWorkspaceFile, {
			repositoryPath: rootPath,
			workspacePath: folderPathOrWorkspaceFile,
			lastTouchedTime: Date.now()
		});
		this.lru.set(key, foldersLru);
		this.save();
	}

	private _findWorkspaceForRepo(rootPath: string): string | undefined {
		let folderPathOrWorkspaceFile: string | undefined;
		try {
			if (this._workspaceFile && this._workspaceFile.scheme === 'file') {
				folderPathOrWorkspaceFile = this._workspaceFile.fsPath;
			} else if (this._workspaceFolders && this._workspaceFolders.length) {
				const sorted = [...this._workspaceFolders].sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length);
				for (const folder of sorted) {
					const folderPath = folder.uri.fsPath;
					if (isDescendant(folderPath, rootPath) || isDescendant(rootPath, folderPath)) {
						folderPathOrWorkspaceFile = folderPath;
						break;
					}
				}
			}
			return folderPathOrWorkspaceFile;
		} catch {
			return;
		}
	}

	update(addedRemotes: Remote[], removedRemotes: Remote[], rootPath: string): void {
		for (const remote of removedRemotes) {
			const url = remote.fetchUrl;
			if (!url) {
				continue;
			}
			const relatedWorkspace = this._findWorkspaceForRepo(rootPath);
			if (relatedWorkspace) {
				this.delete(url, relatedWorkspace);
			}
		}

		for (const remote of addedRemotes) {
			const url = remote.fetchUrl;
			if (!url) {
				continue;
			}
			this.set(url, rootPath);
		}
	}

	get(repoUrl: string): RepositoryCacheInfo[] | undefined {
		const key = this.normalizeRepoUrl(repoUrl);
		const inner = this.lru.get(key);
		return inner ? Array.from(inner.values()) : undefined;
	}

	delete(repoUrl: string, folderPathOrWorkspaceFile: string) {
		const key = this.normalizeRepoUrl(repoUrl);
		const inner = this.lru.get(key);
		if (!inner) {
			return;
		}
		if (!inner.remove(folderPathOrWorkspaceFile)) {
			return;
		}
		if (inner.size === 0) {
			this.lru.remove(key);
		} else {
			this.lru.set(key, inner);
		}
		this.save();
	}

	private load(): void {
		try {
			const raw = this._globalState.get<[string, [string, RepositoryCacheInfo][]][]>(RepositoryCache.STORAGE_KEY);
			if (!Array.isArray(raw)) {
				return;
			}
			for (const [repo, storedFolders] of raw) {
				if (typeof repo !== 'string' || !Array.isArray(storedFolders)) {
					continue;
				}
				const inner = new LRUCache<string, RepositoryCacheInfo>(RepositoryCache.MAX_FOLDER_ENTRIES);
				for (const entry of storedFolders) {
					if (!Array.isArray(entry) || entry.length !== 2) {
						continue;
					}
					const [folderPath, info] = entry;
					if (typeof folderPath !== 'string' || !isRepositoryCacheInfo(info)) {
						continue;
					}

					inner.set(folderPath, info);
				}
				if (inner.size) {
					this.lru.set(repo, inner);
				}
			}
		} catch {
			this._logger.warn('[CachedRepositories][load] Failed to load cached repositories from global state.');
		}
	}

	private save(): void {
		const serialized: [string, [string, RepositoryCacheInfo][]][] = [];
		for (const [repo, inner] of this.lru) {
			const folders: [string, RepositoryCacheInfo][] = [];
			for (const [folder, info] of inner) {
				folders.push([folder, info]);
			}
			serialized.push([repo, folders]);
		}
		void this._globalState.update(RepositoryCache.STORAGE_KEY, serialized);

		this._recentRepositories?.clear();
		this._recentRepositories = undefined;
	}
}
