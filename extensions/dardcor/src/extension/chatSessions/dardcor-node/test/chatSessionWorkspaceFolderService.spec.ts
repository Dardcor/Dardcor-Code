/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { RepoContext } from '../../../../platform/git/common/gitService';
import { MockGitService } from '../../../../platform/ignore/node/test/mockGitService';
import { ILogService } from '../../../../platform/log/common/logService';
import { mock } from '../../../../util/common/test/simpleMock';
import { constObservable, observableValue } from '../../../../util/dardcor/base/common/observableInternal';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { IChatSessionMetadataStore, RepositoryProperties, WorkspaceFolderEntry } from '../../common/chatSessionMetadataStore';
import { ChatSessionWorkspaceFolderService } from '../chatSessionWorkspaceFolderServiceImpl';

class MockGlobalState implements vscode.Memento {
	private data = new Map<string, unknown>();

	get<T>(key: string, defaultValue?: T): T {
		const value = this.data.get(key);
		return (value ?? defaultValue) as T;
	}

	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			this.data.delete(key);
		} else {
			this.data.set(key, value);
		}
	}

	keys(): readonly string[] {
		return Array.from(this.data.keys());
	}

	setKeysForSync(_keys: readonly string[]): void {
	}
}

class MockExtensionContext extends mock<IVSCodeExtensionContext>() {
	public override globalState = new MockGlobalState();

	override extensionPath = vscode.Uri.file('/mock/extension/path').fsPath;
	override globalStorageUri = vscode.Uri.file('/mock/global/storage');
	override storagePath = vscode.Uri.file('/mock/storage/path').fsPath;
	override globalStoragePath = vscode.Uri.file('/mock/global/storage/path').fsPath;
	override logPath = vscode.Uri.file('/mock/log/path').fsPath;
	override logUri = vscode.Uri.file('/mock/log/uri');
	override extensionUri = vscode.Uri.file('/mock/extension');
}

class MockLogService extends mock<ILogService>() {
	override trace = vi.fn();
	override info = vi.fn();
	override warn = vi.fn();
	override error = vi.fn();
	override debug = vi.fn();
}

class MockMetadataStore extends mock<IChatSessionMetadataStore>() {
	private readonly _data = new Map<string, WorkspaceFolderEntry>();
	private readonly _repoData = new Map<string, RepositoryProperties>();
	override storeWorktreeInfo = vi.fn(async () => { });
	override storeWorkspaceFolderInfo = vi.fn(async (_sessionId: string, _entry: WorkspaceFolderEntry) => {
		this._data.set(_sessionId, _entry);
	});
	override storeRepositoryProperties = vi.fn(async (_sessionId: string, properties: RepositoryProperties) => {
		this._repoData.set(_sessionId, properties);
	});
	override getWorktreeProperties = vi.fn(async () => undefined);
	override getRepositoryProperties = vi.fn(async (_sessionId: string) => this._repoData.get(_sessionId));
	override getSessionWorkspaceFolder = vi.fn(async (_sessionId: string): Promise<vscode.Uri | undefined> => {
		const entry = this._data.get(_sessionId);
		if (entry?.folderPath) {
			return vscode.Uri.file(entry.folderPath);
		}
		return undefined;
	});
	override deleteSessionMetadata = vi.fn(async (_sessionId: string) => {
		this._data.delete(_sessionId);
		this._repoData.delete(_sessionId);
	});
}

describe('ChatSessionWorkspaceFolderService', () => {
	let service: ChatSessionWorkspaceFolderService;
	let extensionContext: MockExtensionContext;
	let gitService: MockGitService;
	let logService: MockLogService;
	let metadataStore: MockMetadataStore;

	beforeEach(() => {
		extensionContext = new MockExtensionContext();
		logService = new MockLogService();
		gitService = new MockGitService();
		metadataStore = new MockMetadataStore();
		service = new ChatSessionWorkspaceFolderService(gitService, logService, metadataStore, extensionContext);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('trackSessionWorkspaceFolder', () => {
		it('should track a workspace folder for a session', async () => {
			const sessionId = 'session-1';
			const folderPath = vscode.Uri.file('/path/to/folder').fsPath;

			await service.trackSessionWorkspaceFolder(sessionId, folderPath);

			const tracked = await service.getSessionWorkspaceFolder(sessionId);
			expect(tracked?.fsPath).toBe(folderPath);
		});

		it('should update timestamp when tracking a folder', async () => {
			const sessionId = 'session-1';
			const folderPath = vscode.Uri.file('/path/to/folder').fsPath;

			const beforeTime = Date.now();
			await service.trackSessionWorkspaceFolder(sessionId, folderPath);
			const afterTime = Date.now();

			expect(metadataStore.storeWorkspaceFolderInfo).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ folderPath })
			);
			const entry = metadataStore.storeWorkspaceFolderInfo.mock.calls[0][1];
			expect(entry.timestamp).toBeGreaterThanOrEqual(beforeTime);
			expect(entry.timestamp).toBeLessThanOrEqual(afterTime);
		});

		it('should persist data to metadata store', async () => {
			const sessionId = 'session-1';
			const folderPath = vscode.Uri.file('/path/to/folder').fsPath;

			await service.trackSessionWorkspaceFolder(sessionId, folderPath);

			expect(metadataStore.storeWorkspaceFolderInfo).toHaveBeenCalledWith(
				sessionId,
				expect.objectContaining({ folderPath })
			);
		});

		it('should handle multiple concurrent tracking calls', async () => {
			const sessionIds = ['session-1', 'session-2', 'session-3'];
			const folderPaths = [vscode.Uri.file('/path/1').fsPath, vscode.Uri.file('/path/2').fsPath, vscode.Uri.file('/path/3').fsPath];

			await Promise.all(
				sessionIds.map((sessionId, idx) => service.trackSessionWorkspaceFolder(sessionId, folderPaths[idx]))
			);

			for (let i = 0; i < sessionIds.length; i++) {
				const tracked = await service.getSessionWorkspaceFolder(sessionIds[i]);
				expect(tracked?.fsPath).toBe(folderPaths[i]);
			}
		});

		it('should trigger cleanup when exceeding MAX_ENTRIES', async () => {
			const MAX_ENTRIES = 1500;

			const oldData: Record<string, unknown> = {};
			for (let i = 0; i < MAX_ENTRIES; i++) {
				oldData[`session-old-${i}`] = {
					folderPath: vscode.Uri.file(`/old/path/${i}`).fsPath,
					timestamp: Date.now() - 10000 + i
				};
			}
			await extensionContext.globalState.update('github.dardcor.cli.sessionWorkspaceFolders', oldData);

			await service.trackSessionWorkspaceFolder('session-new', vscode.Uri.file('/new/path').fsPath);

			const data = extensionContext.globalState.get<Record<string, unknown>>('github.dardcor.cli.sessionWorkspaceFolders', {});
			const entryCount = Object.keys(data).length;
			expect(entryCount).toBeLessThan(MAX_ENTRIES + 1);
		});
	});

	describe('getSessionWorkspaceFolder', () => {
		it('should return undefined for non-existent session', async () => {
			const result = await service.getSessionWorkspaceFolder('non-existent-session');
			expect(result).toBeUndefined();
		});

		it('should return correct URI for tracked session', async () => {
			const sessionId = 'session-1';
			const folderPath = vscode.Uri.file('/path/to/folder').fsPath;

			await service.trackSessionWorkspaceFolder(sessionId, folderPath);
			const result = await service.getSessionWorkspaceFolder(sessionId);

			expect(result).toBeDefined();
			expect(result?.fsPath).toBe(folderPath);
		});

		it('should return URI object with correct properties', async () => {
			const sessionId = 'session-1';
			const folderPath = vscode.Uri.file('/path/to/folder').fsPath;

			await service.trackSessionWorkspaceFolder(sessionId, folderPath);
			const result = await service.getSessionWorkspaceFolder(sessionId);

			expect(result).toBeInstanceOf(vscode.Uri);
			expect(result?.scheme).toBe('file');
		});

		it('should handle malformed data gracefully', async () => {
			await extensionContext.globalState.update('github.dardcor.cli.sessionWorkspaceFolders', {
				'session-bad': {}
			});

			const result = await service.getSessionWorkspaceFolder('session-bad');
			expect(result).toBeUndefined();
		});

		it('should return undefined if folderPath is empty string', async () => {
			await extensionContext.globalState.update('github.dardcor.cli.sessionWorkspaceFolders', {
				'session-empty': { folderPath: '', timestamp: Date.now() }
			});

			const result = await service.getSessionWorkspaceFolder('session-empty');
			expect(result).toBeUndefined();
		});

		it('should fall back to metadata store when session is not in memory', async () => {
			const folderPath = vscode.Uri.file('/metadata-store/folder').fsPath;
			metadataStore.getSessionWorkspaceFolder.mockResolvedValueOnce(vscode.Uri.file(folderPath));

			const result = await service.getSessionWorkspaceFolder('session-from-store');

			expect(result?.fsPath).toBe(folderPath);
			expect(metadataStore.getSessionWorkspaceFolder).toHaveBeenCalledWith('session-from-store');
		});

		it('should prefer in-memory state over metadata store', async () => {
			const sessionId = 'session-both';
			const inMemoryPath = vscode.Uri.file('/in-memory/folder').fsPath;

			await service.trackSessionWorkspaceFolder(sessionId, inMemoryPath);

			metadataStore.getSessionWorkspaceFolder.mockResolvedValueOnce(vscode.Uri.file('/store/different'));

			const result = await service.getSessionWorkspaceFolder(sessionId);
			expect(result?.fsPath).toBe(inMemoryPath);
		});
	});

	describe('deleteTrackedWorkspaceFolder', () => {
		it('should delete tracked folder for session', async () => {
			const sessionId = 'session-1';
			const folderPath = vscode.Uri.file('/path/to/folder').fsPath;

			await service.trackSessionWorkspaceFolder(sessionId, folderPath);
			expect(await service.getSessionWorkspaceFolder(sessionId)).toBeDefined();

			await service.deleteTrackedWorkspaceFolder(sessionId);
			expect(await service.getSessionWorkspaceFolder(sessionId)).toBeUndefined();
		});

		it('should call metadata store when deleting', async () => {
			const sessionId = 'session-1';
			await service.trackSessionWorkspaceFolder(sessionId, vscode.Uri.file('/path/to/folder').fsPath);

			await service.deleteTrackedWorkspaceFolder(sessionId);

			expect(metadataStore.deleteSessionMetadata).toHaveBeenCalledWith(sessionId);
		});

		it('should invalidate workspace changes cache when deleting a tracked folder', async () => {
			const repo = {
				rootUri: URI.file('/repo'),
				kind: 'repository' as const,
				isUsingVirtualFileSystem: false,
				headBranchName: 'main',
				headCommitHash: 'abc123',
				headIncomingChanges: 0,
				headOutgoingChanges: 0,
				upstreamBranchName: undefined,
				upstreamRemote: undefined,
				isRebasing: false,
				remotes: [],
				remoteFetchUrls: [],
				worktrees: [],
				changes: { mergeChanges: [], indexChanges: [], workingTree: [], untrackedChanges: [] },
				headBranchNameObs: constObservable('main'),
				headCommitHashObs: observableValue('test-head-commit', 'abc123'),
				upstreamBranchNameObs: constObservable(undefined),
				upstreamRemoteObs: constObservable(undefined),
				isRebasingObs: constObservable(false),
				isIgnored: async () => false,
			} as RepoContext;

			gitService.getRepository = vi.fn().mockResolvedValue(repo);

			const sessionId1 = 'session-1';
			const sessionId2 = 'session-2';
			const sharedProperties = {
				repositoryPath: '/repo',
				branchName: 'main',
				baseBranchName: 'origin/main',
			};

			await service.trackSessionWorkspaceFolder(sessionId1, '/repo', sharedProperties);
			await service.trackSessionWorkspaceFolder(sessionId2, '/repo', sharedProperties);

			await service.getWorkspaceChanges(sessionId1);
			await service.deleteTrackedWorkspaceFolder(sessionId1);
			await service.getWorkspaceChanges(sessionId2);

			expect(gitService.getRepository).toHaveBeenCalledTimes(2);
		});

		it('should handle deletion of non-existent session', async () => {
			await expect(service.deleteTrackedWorkspaceFolder('non-existent')).resolves.toBeUndefined();
		});

		it('should not affect other sessions when deleting one', async () => {
			const session1 = 'session-1';
			const session2 = 'session-2';

			await service.trackSessionWorkspaceFolder(session1, vscode.Uri.file('/path/1').fsPath);
			await service.trackSessionWorkspaceFolder(session2, vscode.Uri.file('/path/2').fsPath);

			await service.deleteTrackedWorkspaceFolder(session1);

			expect(await service.getSessionWorkspaceFolder(session1)).toBeUndefined();
			expect(await service.getSessionWorkspaceFolder(session2)).toBeDefined();
		});
	});

	describe('cleanupOldEntries', () => {
		it('should keep newer entries and remove older ones', async () => {
			const MAX_ENTRIES = 1500;

			const oldData: Record<string, unknown> = {};
			for (let i = 0; i < MAX_ENTRIES; i++) {
				oldData[`session-old-${i}`] = {
					folderPath: vscode.Uri.file(`/old/path/${i}`).fsPath,
					timestamp: 1000 + i
				};
			}
			await extensionContext.globalState.update('github.dardcor.cli.sessionWorkspaceFolders', oldData);

			const now = Date.now();
			const data = extensionContext.globalState.get<Record<string, unknown>>('github.dardcor.cli.sessionWorkspaceFolders', {});
			(data as any)['session-new'] = {
				folderPath: vscode.Uri.file('/new/path').fsPath,
				timestamp: now
			};
			await extensionContext.globalState.update('github.dardcor.cli.sessionWorkspaceFolders', data);

			await service.trackSessionWorkspaceFolder('session-trigger', vscode.Uri.file('/trigger/path').fsPath);

			const finalData = extensionContext.globalState.get<Record<string, unknown>>('github.dardcor.cli.sessionWorkspaceFolders', {});

			expect(finalData['session-new']).toBeDefined();
		});
	});

	describe('integration scenarios', () => {
		describe('getWorkspaceChanges - cache invalidation', () => {
			let headCommitHash: ReturnType<typeof observableValue<string | undefined>>;

			function makeRepoContext(overrides?: Partial<RepoContext>): RepoContext {
				headCommitHash = observableValue('test-head-commit', 'abc123');
				return {
					rootUri: URI.file('/repo'),
					kind: 'repository',
					headBranchName: 'main',
					headCommitHash: 'abc123',
					upstreamBranchName: undefined,
					upstreamRemote: undefined,
					isRebasing: false,
					remotes: [],
					remoteFetchUrls: [],
					worktrees: [],
					changes: { mergeChanges: [], indexChanges: [], workingTree: [], untrackedChanges: [] },
					headBranchNameObs: constObservable('main'),
					headCommitHashObs: headCommitHash,
					upstreamBranchNameObs: constObservable(undefined),
					upstreamRemoteObs: constObservable(undefined),
					isRebasingObs: constObservable(false),
					isIgnored: async () => false,
					...overrides,
				} as RepoContext;
			}

			it('should return cached changes on second call', async () => {
				const repo = makeRepoContext();
				gitService.getRepository = vi.fn().mockResolvedValue(repo);
				gitService.diffIndexWithHEADShortStats = vi.fn().mockResolvedValue({ insertions: 1, deletions: 0 });

				const sessionId = 'session-1';
				await metadataStore.storeRepositoryProperties(sessionId, {
					repositoryPath: '/repo',
					branchName: 'main',
				});

				const first = await service.getWorkspaceChanges(sessionId);
				const second = await service.getWorkspaceChanges(sessionId);

				expect(first).toBe(second);
				expect(gitService.getRepository).toHaveBeenCalledTimes(1);
			});

			it('should invalidate cache when clearWorkspaceChanges is called', async () => {
				const repo = makeRepoContext();
				gitService.getRepository = vi.fn().mockResolvedValue(repo);
				gitService.diffIndexWithHEADShortStats = vi.fn().mockResolvedValue({ insertions: 1, deletions: 0 });

				const sessionId = 'session-1';
				await metadataStore.storeRepositoryProperties(sessionId, {
					repositoryPath: '/repo',
					branchName: 'main',
				});

				await service.getWorkspaceChanges(sessionId);
				service.clearWorkspaceChanges(sessionId);

				await service.getWorkspaceChanges(sessionId);
				expect(gitService.getRepository).toHaveBeenCalledTimes(2);
			});

			it('should invalidate cache when handleRequestCompleted is called', async () => {
				const repo = makeRepoContext();
				gitService.getRepository = vi.fn().mockResolvedValue(repo);
				gitService.diffIndexWithHEADShortStats = vi.fn().mockResolvedValue({ insertions: 1, deletions: 0 });

				const sessionId = 'session-1';
				await metadataStore.storeRepositoryProperties(sessionId, {
					repositoryPath: '/repo',
					branchName: 'main',
				});

				await service.getWorkspaceChanges(sessionId);
				await service.handleRequestCompleted(sessionId);

				await service.getWorkspaceChanges(sessionId);
				expect(gitService.getRepository).toHaveBeenCalledTimes(2);
			});

			it('should return empty array when repository has no changes', async () => {
				const repo = makeRepoContext({ changes: undefined });
				gitService.getRepository = vi.fn().mockResolvedValue(repo);
				await metadataStore.storeRepositoryProperties('session-1', {
					repositoryPath: '/repo',
					branchName: 'main',
				});

				const result = await service.getWorkspaceChanges('session-1');
				expect(result).toEqual([]);
			});

			it('should return empty array when no repository is found', async () => {
				gitService.getRepository = vi.fn().mockResolvedValue(undefined);
				await metadataStore.storeRepositoryProperties('session-1', {
					repositoryPath: '/repo',
					branchName: 'main',
				});

				const result = await service.getWorkspaceChanges('session-1');
				expect(result).toEqual([]);
			});

			it('should cache empty result when session has no repository properties', async () => {
				const result1 = await service.getWorkspaceChanges('no-repo-session');
				const result2 = await service.getWorkspaceChanges('no-repo-session');

				expect(result1).toEqual([]);
				expect(result2).toEqual([]);
				expect(metadataStore.getRepositoryProperties).toHaveBeenCalledTimes(1);
			});

			it('should clear negative cache when repository properties are later provided via trackSessionWorkspaceFolder', async () => {
				const repo = makeRepoContext();
				gitService.getRepository = vi.fn().mockResolvedValue(repo);

				const result1 = await service.getWorkspaceChanges('late-init-session');
				expect(result1).toEqual([]);

				await service.trackSessionWorkspaceFolder('late-init-session', '/repo', {
					repositoryPath: '/repo',
					branchName: 'main',
				});

				const result2 = await service.getWorkspaceChanges('late-init-session');
				expect(result2).toBeDefined();
				expect(metadataStore.getRepositoryProperties).toHaveBeenCalledTimes(2);
			});

			it('should not re-fetch when cache is valid for a folder', async () => {
				const repo = makeRepoContext();
				gitService.getRepository = vi.fn().mockResolvedValue(repo);
				gitService.diffIndexWithHEADShortStats = vi.fn().mockResolvedValue({ insertions: 1, deletions: 0 });

				const sessionId = 'session-1';
				await metadataStore.storeRepositoryProperties(sessionId, {
					repositoryPath: '/repo',
					branchName: 'main',
				});

				await service.getWorkspaceChanges(sessionId);
				service.clearWorkspaceChanges(sessionId);
				await service.getWorkspaceChanges(sessionId);

				service.clearWorkspaceChanges(sessionId);
				await service.getWorkspaceChanges(sessionId);

				expect(gitService.getRepository).toHaveBeenCalledTimes(3);
			});

			it('should track changes per workspace folder independently', async () => {
				const repo1 = makeRepoContext();
				const repo2 = makeRepoContext();

				const folder1 = vscode.Uri.file('/repo1');
				const folder2 = vscode.Uri.file('/repo2');

				gitService.getRepository = vi.fn()
					.mockImplementation((uri: URI) => {
						if (uri.fsPath === folder1.fsPath) {
							return Promise.resolve(repo1);
						}
						return Promise.resolve(repo2);
					});
				gitService.diffIndexWithHEADShortStats = vi.fn().mockResolvedValue({ insertions: 0, deletions: 0 });

				const sessionId1 = 'session-1';
				const sessionId2 = 'session-2';

				await service.trackSessionWorkspaceFolder(sessionId1, folder1.fsPath, {
					repositoryPath: folder1.fsPath,
					branchName: 'main',
				});
				await service.trackSessionWorkspaceFolder(sessionId2, folder2.fsPath, {
					repositoryPath: folder2.fsPath,
					branchName: 'main',
				});

				await service.getWorkspaceChanges(sessionId1);
				await service.getWorkspaceChanges(sessionId2);

				service.clearWorkspaceChanges(sessionId1);

				await service.getWorkspaceChanges(sessionId2);
				await service.getWorkspaceChanges(sessionId1);

				const calls = (gitService.getRepository as ReturnType<typeof vi.fn>).mock.calls;
				const sessionId1Calls = calls.filter((c: URI[]) => c[0].fsPath === folder1.fsPath).length;
				const sessionId2Calls = calls.filter((c: URI[]) => c[0].fsPath === folder2.fsPath).length;
				expect(sessionId1Calls).toBe(2);
				expect(sessionId2Calls).toBe(1);
			});

			it('should serialize git operations for different sessions sharing the same repo, base branch and branch', async () => {
				const repo = makeRepoContext();
				const repoPath = '/shared-repo';

				gitService.getRepository = vi.fn().mockImplementation(async () => {
					await new Promise(resolve => setTimeout(resolve, 10));
					return repo;
				});

				const sessionId1 = 'session-A';
				const sessionId2 = 'session-B';

				await metadataStore.storeRepositoryProperties(sessionId1, {
					repositoryPath: repoPath,
					branchName: 'feature',
					baseBranchName: 'main',
				});
				await metadataStore.storeRepositoryProperties(sessionId2, {
					repositoryPath: repoPath,
					branchName: 'feature',
					baseBranchName: 'main',
				});

				const [result1, result2] = await Promise.all([
					service.getWorkspaceChanges(sessionId1),
					service.getWorkspaceChanges(sessionId2),
				]);

				expect(result1).toBeDefined();
				expect(result2).toBeDefined();

				expect(result1).toBe(result2);
				expect(gitService.getRepository).toHaveBeenCalledTimes(1);
			});

			it('should not share cache for sessions with different branch names in the same repo and base branch', async () => {
				const repo = makeRepoContext();
				const repoPath = '/shared-repo';

				gitService.getRepository = vi.fn().mockImplementation(async () => {
					await new Promise(resolve => setTimeout(resolve, 10));
					return repo;
				});

				await metadataStore.storeRepositoryProperties('session-main', {
					repositoryPath: repoPath,
					branchName: 'main',
					baseBranchName: 'origin/main',
				});
				await metadataStore.storeRepositoryProperties('session-feature', {
					repositoryPath: repoPath,
					branchName: 'feature',
					baseBranchName: 'origin/main',
				});

				await Promise.all([
					service.getWorkspaceChanges('session-main'),
					service.getWorkspaceChanges('session-feature'),
				]);

				expect(gitService.getRepository).toHaveBeenCalledTimes(2);
			});

			it('should invalidate cache for all sessions when clearWorkspaceChanges is called with folder URI', async () => {
				const folder = vscode.Uri.file('/shared-folder');
				const repo = makeRepoContext({ rootUri: URI.file('/shared-folder') });

				gitService.getRepository = vi.fn().mockResolvedValue(repo);
				gitService.diffIndexWithHEADShortStats = vi.fn().mockResolvedValue({ insertions: 1, deletions: 0 });

				const sessionId1 = 'session-1';
				const sessionId2 = 'session-2';

				await service.trackSessionWorkspaceFolder(sessionId1, folder.fsPath, {
					repositoryPath: folder.fsPath,
					branchName: 'main',
				});
				await service.trackSessionWorkspaceFolder(sessionId2, folder.fsPath, {
					repositoryPath: folder.fsPath,
					branchName: 'develop',
				});

				await service.getWorkspaceChanges(sessionId1);
				await service.getWorkspaceChanges(sessionId2);
				expect(gitService.getRepository).toHaveBeenCalledTimes(2);

				const clearedIds = service.clearWorkspaceChanges(folder);
				expect(clearedIds).toContain(sessionId1);
				expect(clearedIds).toContain(sessionId2);

				await service.getWorkspaceChanges(sessionId1);
				await service.getWorkspaceChanges(sessionId2);
				expect(gitService.getRepository).toHaveBeenCalledTimes(4);
			});

			it('should return empty array when clearWorkspaceChanges is called with untracked folder URI', () => {
				const unknownFolder = vscode.Uri.file('/unknown-folder');
				const result = service.clearWorkspaceChanges(unknownFolder);
				expect(result).toEqual([]);
			});

			it('should populate folder associations eagerly on trackSessionWorkspaceFolder', async () => {
				const folder = vscode.Uri.file('/my-folder');
				const sessionId = 'session-eager';

				expect(service.clearWorkspaceChanges(folder)).toEqual([]);

				await service.trackSessionWorkspaceFolder(sessionId, folder.fsPath);

				expect(service.clearWorkspaceChanges(folder)).toEqual([sessionId]);
			});

			it('should clean up folder associations on deleteTrackedWorkspaceFolder', async () => {
				const folder = vscode.Uri.file('/cleanup-folder');
				const sessionId = 'session-cleanup';

				await service.trackSessionWorkspaceFolder(sessionId, folder.fsPath);
				expect(service.clearWorkspaceChanges(folder)).toEqual([sessionId]);

				await service.deleteTrackedWorkspaceFolder(sessionId);
				expect(service.clearWorkspaceChanges(folder)).toEqual([]);
			});
		});
	});
});
