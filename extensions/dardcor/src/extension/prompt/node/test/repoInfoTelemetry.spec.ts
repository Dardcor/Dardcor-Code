/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { beforeEach, suite, test, vi } from 'vitest';
import type { FileSystemWatcher, Uri } from 'vscode';
import { CopilotToken, createTestExtendedTokenInfo } from '../../../../platform/authentication/common/dardcorToken';
import { ICopilotTokenStore } from '../../../../platform/authentication/common/dardcorTokenStore';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import { IGitDiffService } from '../../../../platform/git/common/gitDiffService';
import { IGitExtensionService } from '../../../../platform/git/common/gitExtensionService';
import { IGitService } from '../../../../platform/git/common/gitService';
import { NullGitDiffService } from '../../../../platform/git/common/nullGitDiffService';
import { NullGitExtensionService } from '../../../../platform/git/common/nullGitExtensionService';
import { ILogService } from '../../../../platform/log/common/logService';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';
import { createPlatformServices } from '../../../../platform/test/node/services';
import { NullWorkspaceFileIndex } from '../../../../platform/workspaceChunkSearch/node/nullWorkspaceFileIndex';
import { IWorkspaceFileIndex } from '../../../../platform/workspaceChunkSearch/node/workspaceFileIndex';
import { Event } from '../../../../util/dardcor/base/common/event';
import { observableValue } from '../../../../util/dardcor/base/common/observableInternal/observables/observableValue';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { SyncDescriptor } from '../../../../util/dardcor/platform/instantiation/common/descriptors';
import { RepoInfoTelemetry } from '../repoInfoTelemetry';

const Status = {
	INDEX_MODIFIED: 0,
	INDEX_ADDED: 1,
	INDEX_DELETED: 2,
	INDEX_RENAMED: 3,
	INDEX_COPIED: 4,
	MODIFIED: 5,
	DELETED: 6,
	UNTRACKED: 7,
	IGNORED: 8,
	INTENT_TO_ADD: 9,
	INTENT_TO_RENAME: 10,
	TYPE_CHANGED: 11,
	ADDED_BY_US: 12,
	ADDED_BY_THEM: 13,
	DELETED_BY_US: 14,
	DELETED_BY_THEM: 15,
	BOTH_ADDED: 16,
	BOTH_DELETED: 17,
	BOTH_MODIFIED: 18
} as const;

suite('RepoInfoTelemetry', () => {
	let accessor: ReturnType<ReturnType<typeof createPlatformServices>['createTestingAccessor']>;
	let telemetryService: ITelemetryService;
	let gitService: IGitService;
	let gitDiffService: IGitDiffService;
	let gitExtensionService: IGitExtensionService;
	let dardcorTokenStore: ICopilotTokenStore;
	let logService: ILogService;
	let fileSystemService: IFileSystemService;
	let workspaceFileIndex: IWorkspaceFileIndex;
	let configurationService: IConfigurationService;
	let mockWatcher: MockFileSystemWatcher;

	beforeEach(() => {
		const services = createPlatformServices();
		services.define(IGitDiffService, new SyncDescriptor(NullGitDiffService));
		services.define(IGitExtensionService, new NullGitExtensionService());
		services.define(IWorkspaceFileIndex, new SyncDescriptor(NullWorkspaceFileIndex));

		const activeRepository = observableValue<any>('test-git-activeRepo', undefined);
		const mockGitService: IGitService = {
			_serviceBrand: undefined,
			activeRepository,
			onDidOpenRepository: Event.None,
			onDidCloseRepository: Event.None,
			onDidFinishInitialization: Event.None,
			get repositories() {
				const repo = activeRepository.get();
				return repo ? [repo] : [];
			},
			isInitialized: true,
			initRepository: vi.fn(),
			openRepository: vi.fn(),
			getRepository: vi.fn(),
			getRepository2: vi.fn(),
			getRecentRepositories: vi.fn(),
			getRepositoryFetchUrls: vi.fn(),
			generateRandomBranchName: vi.fn(),
			initialize: vi.fn(),
			diffBetweenWithStats: vi.fn(),
			diffBetweenPatch: vi.fn(),
			diffWith: vi.fn(),
			diffIndexWithHEADShortStats: vi.fn(),
			getMergeBase: vi.fn(),
			restore: vi.fn(),
			add: vi.fn(),
			createWorktree: vi.fn(),
			deleteWorktree: vi.fn(),
			migrateChanges: vi.fn(),
			applyPatch: vi.fn(),
			commit: vi.fn(),
			getRefs: vi.fn(),
			getBranch: vi.fn(),
			getBranchBase: vi.fn(),
			isBranchProtected: vi.fn(),
			exec: vi.fn(),
			dispose: vi.fn()
		};
		services.define(IGitService, mockGitService);

		accessor = services.createTestingAccessor();

		telemetryService = accessor.get(ITelemetryService);
		gitService = accessor.get(IGitService);
		gitDiffService = accessor.get(IGitDiffService);
		gitExtensionService = accessor.get(IGitExtensionService);
		dardcorTokenStore = accessor.get(ICopilotTokenStore);
		logService = accessor.get(ILogService);
		fileSystemService = accessor.get(IFileSystemService);
		workspaceFileIndex = accessor.get(IWorkspaceFileIndex);
		configurationService = accessor.get(IConfigurationService);

		mockWatcher = new MockFileSystemWatcher();

		vi.spyOn(fileSystemService, 'createFileSystemWatcher').mockReturnValue(mockWatcher as any);

		(telemetryService as any).sendMSFTTelemetryEvent = vi.fn();
		(telemetryService as any).sendInternalMSFTTelemetryEvent = vi.fn();
		(telemetryService as any).sendEnhancedGHTelemetryEvent = vi.fn();
	});


	test('should not send any telemetry for non-internal users', async () => {
		const nonInternalToken = new CopilotToken(createTestExtendedTokenInfo({
			token: 'test-token',
			sku: 'free_limited_dardcor',
			expires_at: 9999999999,
			refresh_in: 180000,
			organization_list: [],
			isVscodeTeamMember: false,
			username: 'testUser',
			dardcor_plan: 'unknown',
		}));
		dardcorTokenStore.dardcorToken = nonInternalToken;

		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();
		await repoTelemetry.sendEndTelemetry();

		assert.strictEqual((telemetryService.sendMSFTTelemetryEvent as any).mock.calls.length, 0, 'sendMSFTTelemetryEvent should not be called for non-internal users');
		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 0, 'sendInternalMSFTTelemetryEvent should not be called for non-internal users');
	});

	test('should send telemetry for internal users', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[0], 'request.repoInfo');
		assert.strictEqual(call[1].location, 'begin');
		assert.strictEqual(call[1].telemetryMessageId, 'test-message-id');
		assert.ok(call[2], 'measurements parameter should be present');
		assert.strictEqual(typeof call[2].workspaceFileCount, 'number');
	});

	test('should send begin telemetry only once', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();
		await repoTelemetry.sendBeginTelemetryIfNeeded();
		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
	});

	test('should send end telemetry after begin', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();
		await repoTelemetry.sendEndTelemetry();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 2);
		const beginCall = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		const endCall = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[1];

		assert.strictEqual(beginCall[1].location, 'begin');
		assert.strictEqual(endCall[1].location, 'end');
		assert.strictEqual(beginCall[1].telemetryMessageId, endCall[1].telemetryMessageId);
	});

	test('should send end telemetry when begin has success result', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();
		await repoTelemetry.sendEndTelemetry();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 2);
		const beginCall = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		const endCall = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[1];
		assert.strictEqual(beginCall[1].location, 'begin');
		assert.strictEqual(beginCall[1].result, 'success');
		assert.strictEqual(endCall[1].location, 'end');
		assert.strictEqual(endCall[1].result, 'success');
	});

	test('should send end telemetry when begin has noChanges result', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();
		await repoTelemetry.sendEndTelemetry();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 2);
		const beginCall = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		const endCall = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[1];
		assert.strictEqual(beginCall[1].location, 'begin');
		assert.strictEqual(beginCall[1].result, 'noChanges');
		assert.strictEqual(endCall[1].location, 'end');
		assert.strictEqual(endCall[1].result, 'noChanges');
	});

	test('should skip end telemetry when begin has failure result', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const manyChanges = Array.from({ length: 101 }, (_, i) => ({
			uri: URI.file(`/test/repo/file${i}.ts`),
			originalUri: URI.file(`/test/repo/file${i}.ts`),
			renameUri: undefined,
			status: Status.MODIFIED
		}));
		vi.spyOn(gitService, 'diffWith').mockResolvedValue(manyChanges as any);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();
		await repoTelemetry.sendEndTelemetry();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const beginCall = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(beginCall[1].location, 'begin');
		assert.strictEqual(beginCall[1].result, 'tooManyChanges');
	});


	test('should not send telemetry when no active repository', async () => {
		setupInternalUser();

		vi.spyOn(gitService.activeRepository, 'get').mockReturnValue(undefined);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 0);
	});

	test('should send telemetry with noChanges result when no changes from upstream', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'noChanges');
		assert.strictEqual(call[1].diffsJSON, undefined);
		assert.strictEqual(call[1].remoteUrl, 'https://github.com/microsoft/vscode.git');
		assert.strictEqual(call[1].headCommitHash, 'abc123');
	});

	test('should not send telemetry when no GitHub or ADO remote', async () => {
		setupInternalUser();

		vi.spyOn(gitService.activeRepository, 'get').mockReturnValue({
			rootUri: URI.file('/test/repo'),
			changes: {
				mergeChanges: [],
				indexChanges: [],
				workingTree: [],
				untrackedChanges: []
			},
			remotes: [],
			remoteFetchUrls: [],
			upstreamRemote: undefined,
		} as any);

		mockGitExtensionWithUpstream('abc123', 'https://gitlab.com/user/repo.git');

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 0);
	});

	test('should send telemetry with correct repoType for Azure DevOps repository', async () => {
		setupInternalUser();

		vi.spyOn(gitService.activeRepository, 'get').mockReturnValue({
			rootUri: URI.file('/test/repo'),
			changes: {
				mergeChanges: [],
				indexChanges: [],
				workingTree: [{
					uri: URI.file('/test/repo/file.ts'),
					originalUri: URI.file('/test/repo/file.ts'),
					renameUri: undefined,
					status: Status.MODIFIED
				}],
				untrackedChanges: []
			},
			remotes: ['origin'],
			remoteFetchUrls: ['https://dev.azure.com/myorg/myproject/_git/myrepo'],
			upstreamRemote: 'origin',
			headBranchName: 'main',
			headCommitHash: 'abc123',
			upstreamBranchName: 'origin/main',
			isRebasing: false,
		} as any);

		mockGitExtensionWithUpstream('abc123def456', 'https://dev.azure.com/myorg/myproject/_git/myrepo');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[0], 'request.repoInfo');
		assert.strictEqual(call[1].repoType, 'ado');
		assert.strictEqual(call[1].remoteUrl, 'https://dev.azure.com/myorg/myproject/_git/myrepo');
		assert.strictEqual(call[1].headCommitHash, 'abc123def456');
		assert.strictEqual(call[1].result, 'success');
	});

	test('should normalize remote URL when logging telemetry', async () => {
		setupInternalUser();

		const sshUrl = 'git@github.com:microsoft/vscode.git';
		vi.spyOn(gitService.activeRepository, 'get').mockReturnValue({
			rootUri: URI.file('/test/repo'),
			changes: {
				mergeChanges: [],
				indexChanges: [],
				workingTree: [{
					uri: URI.file('/test/repo/file.ts'),
					originalUri: URI.file('/test/repo/file.ts'),
					renameUri: undefined,
					status: Status.MODIFIED
				}],
				untrackedChanges: []
			},
			remotes: ['origin'],
			remoteFetchUrls: [sshUrl],
			upstreamRemote: 'origin',
			headBranchName: 'main',
			headCommitHash: 'abc123',
			upstreamBranchName: 'origin/main',
			isRebasing: false,
		} as any);

		mockGitExtensionWithUpstream('abc123def456', sshUrl);
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].remoteUrl, 'https://github.com/microsoft/vscode.git');
		assert.notStrictEqual(call[1].remoteUrl, sshUrl);
	});

	test('should not send telemetry when no upstream commit', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();

		mockGitExtensionWithUpstream(undefined);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 0);
	});

	test('should send telemetry with valid GitHub repository', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123def456');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[0], 'request.repoInfo');
		assert.strictEqual(call[1].remoteUrl, 'https://github.com/microsoft/vscode.git');
		assert.strictEqual(call[1].headCommitHash, 'abc123def456');
		assert.strictEqual(call[1].result, 'success');
	});


	test('should detect file creation during diff', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockImplementation(async () => {
			mockWatcher.triggerCreate(URI.file('/test/repo/newfile.ts') as any);

			return [{
				uri: URI.file('/test/repo/file.ts'),
				originalUri: URI.file('/test/repo/file.ts'),
				renameUri: undefined,
				status: Status.MODIFIED
			}] as any;
		});

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'filesChanged');
		assert.strictEqual(call[1].diffsJSON, undefined);
	});

	test('should detect file modification during diff', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockImplementation(async () => {
			mockWatcher.triggerChange(URI.file('/test/repo/file.ts') as any);

			return [{
				uri: URI.file('/test/repo/file.ts'),
				originalUri: URI.file('/test/repo/file.ts'),
				renameUri: undefined,
				status: Status.MODIFIED
			}] as any;
		});

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'filesChanged');
		assert.strictEqual(call[1].diffsJSON, undefined);
	});

	test('should detect file deletion during diff', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockImplementation(async () => {
			mockWatcher.triggerDelete(URI.file('/test/repo/oldfile.ts') as any);

			return [{
				uri: URI.file('/test/repo/file.ts'),
				originalUri: URI.file('/test/repo/file.ts'),
				renameUri: undefined,
				status: Status.MODIFIED
			}] as any;
		});

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'filesChanged');
		assert.strictEqual(call[1].diffsJSON, undefined);
	});

	test('should detect file change during diff processing', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED
		}] as any);

		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockImplementation(async () => {
			mockWatcher.triggerChange(URI.file('/test/repo/file.ts') as any);
			return [{
				uri: URI.file('/test/repo/file.ts'),
				originalUri: URI.file('/test/repo/file.ts'),
				renameUri: undefined,
				status: Status.MODIFIED,
				diff: 'some diff content'
			}];
		});

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'filesChanged');
		assert.strictEqual(call[1].diffsJSON, undefined);
	});

	test('should properly dispose file watcher', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual(mockWatcher.isDisposed, true);
	});


	test('should skip with virtualFileSystem result when core.virtualfilesystem is set', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const mockApi = gitExtensionService.getExtensionApi();
		const mockRepo = mockApi!.getRepository(URI.file('/test/repo'))!;
		vi.spyOn(mockRepo, 'getConfig').mockImplementation(async key => {
			if (key === 'core.virtualfilesystem') {
				return '/path/to/vfs-hook';
			}
			return '';
		});

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'virtualFileSystem');
		assert.strictEqual(call[1].diffsJSON, undefined);

		assert.strictEqual((gitService.diffWith as any).mock.calls.length, 0);
	});

	test('should skip with virtualFileSystem result when core.sparsecheckout is true', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const mockApi = gitExtensionService.getExtensionApi();
		const mockRepo = mockApi!.getRepository(URI.file('/test/repo'))!;
		vi.spyOn(mockRepo, 'getConfig').mockImplementation(async key => {
			if (key === 'core.sparsecheckout') {
				return 'true';
			}
			return '';
		});

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'virtualFileSystem');
		assert.strictEqual((gitService.diffWith as any).mock.calls.length, 0);
	});

	test('should skip with virtualFileSystem result when getConfig throws', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const mockApi = gitExtensionService.getExtensionApi();
		const mockRepo = mockApi!.getRepository(URI.file('/test/repo'))!;
		vi.spyOn(mockRepo, 'getConfig').mockRejectedValue(new Error('git config failed'));

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'virtualFileSystem');
		assert.strictEqual((gitService.diffWith as any).mock.calls.length, 0);
	});


	test('should skip with tooManyCommits result when commit count exceeds limit', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const mockApi = gitExtensionService.getExtensionApi();
		const mockRepo = mockApi!.getRepository(URI.file('/test/repo'))!;
		vi.spyOn(mockRepo, 'log').mockResolvedValue(
			Array.from({ length: 30 }, (_, i) => ({ hash: `commit${i}`, message: `msg${i}` })) as any
		);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'tooManyCommits');
		assert.strictEqual(call[1].diffsJSON, undefined);
		assert.strictEqual((gitService.diffWith as any).mock.calls.length, 0);
	});

	test('should proceed normally when commit count is below limit', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const mockApi = gitExtensionService.getExtensionApi();
		const mockRepo = mockApi!.getRepository(URI.file('/test/repo'))!;
		vi.spyOn(mockRepo, 'log').mockResolvedValue(
			Array.from({ length: 5 }, (_, i) => ({ hash: `commit${i}`, message: `msg${i}` })) as any
		);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'success');
		assert.ok(call[1].diffsJSON);
	});

	test('should skip with tooManyCommits result when log throws', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const mockApi = gitExtensionService.getExtensionApi();
		const mockRepo = mockApi!.getRepository(URI.file('/test/repo'))!;
		vi.spyOn(mockRepo, 'log').mockRejectedValue(new Error('git log failed'));

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'tooManyCommits');
		assert.strictEqual((gitService.diffWith as any).mock.calls.length, 0);
	});


	test('should detect when there are too many changes', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const manyChanges = Array.from({ length: 101 }, (_, i) => ({
			uri: URI.file(`/test/repo/file${i}.ts`),
			originalUri: URI.file(`/test/repo/file${i}.ts`),
			renameUri: undefined,
			status: Status.MODIFIED
		}));

		vi.spyOn(gitService, 'diffWith').mockResolvedValue(manyChanges as any);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'tooManyChanges');
		assert.strictEqual(call[1].diffsJSON, undefined);
		assert.strictEqual(call[1].remoteUrl, 'https://github.com/microsoft/vscode.git');
		assert.strictEqual(call[1].headCommitHash, 'abc123');
	});

	test('should detect when diff is too large', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED
		}] as any);

		const largeDiff = 'x'.repeat(901 * 1024);
		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED,
			diff: largeDiff
		}]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'diffTooLarge');
		assert.strictEqual(call[1].diffsJSON, undefined);
		assert.strictEqual(call[1].remoteUrl, 'https://github.com/microsoft/vscode.git');
		assert.strictEqual(call[1].headCommitHash, 'abc123');
	});

	test('should detect diffTooLarge via character capacity even when under the byte budget', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED
		}] as any);

		const largeDiff = 'x'.repeat(500 * 1024);
		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED,
			diff: largeDiff
		}]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'diffTooLarge');
		assert.strictEqual(call[1].diffsJSON, undefined);
	});

	test('should detect diffTooLarge via byte budget even when under the character capacity', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED
		}] as any);

		const largeDiff = '\u4e2d'.repeat(350 * 1024);
		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED,
			diff: largeDiff
		}]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'diffTooLarge');
		assert.strictEqual(call[1].diffsJSON, undefined);
	});

	test('should chunk large diffs across multiple diffsJSON columns', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED
		}] as any);

		const largeDiff = 'x'.repeat(30 * 1024);
		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED,
			diff: largeDiff
		}]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		const call = (telemetryService.sendEnhancedGHTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'success');

		const chunkColumns: string[] = [];
		for (let n = 1; ; n++) {
			const key = n === 1 ? 'diffsJSON' : `diffsJSON_${n < 10 ? '0' : ''}${n}`;
			const value = call[1][key];
			if (value === undefined) {
				break;
			}
			assert.ok(value.length <= 8192, `${key} exceeds 8192 characters`);
			chunkColumns.push(value);
		}

		assert.ok(chunkColumns.length > 1, 'expected the diff to be split across multiple columns');

		const diffs = JSON.parse(chunkColumns.join(''));
		assert.strictEqual(diffs.length, 1);
		assert.strictEqual(diffs[0].diff, largeDiff);
	});

	test('should send diff when within size limits', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED
		}] as any);

		const normalDiff = 'some normal diff content';
		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED,
			diff: normalDiff
		}]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'success');
		assert.ok(call[1].diffsJSON);

		const diffs = JSON.parse(call[1].diffsJSON);
		assert.strictEqual(diffs.length, 1);
		assert.strictEqual(diffs[0].diff, normalDiff);
	});

	test('should handle multiple files in diff', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([
			{
				uri: URI.file('/test/repo/file1.ts'),
				originalUri: URI.file('/test/repo/file1.ts'),
				renameUri: undefined,
				status: Status.MODIFIED
			},
			{
				uri: URI.file('/test/repo/file2.ts'),
				originalUri: URI.file('/test/repo/file2.ts'),
				renameUri: undefined,
				status: Status.INDEX_ADDED
			},
			{
				uri: URI.file('/test/repo/file3.ts'),
				originalUri: URI.file('/test/repo/file3.ts'),
				renameUri: undefined,
				status: Status.DELETED
			}
		] as any);

		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue([
			{
				uri: URI.file('/test/repo/file1.ts'),
				originalUri: URI.file('/test/repo/file1.ts'),
				renameUri: undefined,
				status: Status.MODIFIED,
				diff: 'diff for file1'
			},
			{
				uri: URI.file('/test/repo/file2.ts'),
				originalUri: URI.file('/test/repo/file2.ts'),
				renameUri: undefined,
				status: Status.INDEX_ADDED,
				diff: 'diff for file2'
			},
			{
				uri: URI.file('/test/repo/file3.ts'),
				originalUri: URI.file('/test/repo/file3.ts'),
				renameUri: undefined,
				status: Status.DELETED,
				diff: 'diff for file3'
			}
		]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'success');

		const diffs = JSON.parse(call[1].diffsJSON);
		assert.strictEqual(diffs.length, 3);
		assert.strictEqual(diffs[0].status, 'MODIFIED');
		assert.strictEqual(diffs[1].status, 'INDEX_ADDED');
		assert.strictEqual(diffs[2].status, 'DELETED');
	});

	test('should handle renamed files in diff', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/newname.ts'),
			originalUri: URI.file('/test/repo/oldname.ts'),
			renameUri: URI.file('/test/repo/newname.ts'),
			status: Status.INDEX_RENAMED
		}] as any);

		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue([{
			uri: URI.file('/test/repo/newname.ts'),
			originalUri: URI.file('/test/repo/oldname.ts'),
			renameUri: URI.file('/test/repo/newname.ts'),
			status: Status.INDEX_RENAMED,
			diff: 'diff content'
		}]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'success');

		const diffs = JSON.parse(call[1].diffsJSON);
		assert.strictEqual(diffs.length, 1);
		assert.strictEqual(diffs[0].status, 'INDEX_RENAMED');
		assert.ok(diffs[0].renameUri);
	});

	test('should include untracked files from both workingTreeChanges and untrackedChanges', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();

		const mockRepo = {
			getMergeBase: vi.fn(),
			getBranchBase: vi.fn(),
			getCommit: vi.fn(),
			getConfig: vi.fn().mockResolvedValue(''),
			log: vi.fn().mockResolvedValue([]),
			state: {
				HEAD: {
					upstream: {
						commit: 'abc123',
						remote: 'origin',
					},
				},
				remotes: [{
					name: 'origin',
					fetchUrl: 'https://github.com/microsoft/vscode.git',
					pushUrl: 'https://github.com/microsoft/vscode.git',
					isReadOnly: false,
				}],
				workingTreeChanges: [{
					uri: URI.file('/test/repo/filea.txt'),
					originalUri: URI.file('/test/repo/filea.txt'),
					renameUri: undefined,
					status: Status.UNTRACKED
				}],
				untrackedChanges: [{
					uri: URI.file('/test/repo/fileb.txt'),
					originalUri: URI.file('/test/repo/fileb.txt'),
					renameUri: undefined,
					status: Status.UNTRACKED
				}],
			},
		};

		mockRepo.getCommit.mockResolvedValue({
			hash: 'abc123',
			message: 'test commit',
			commitDate: new Date(),
		});

		mockRepo.getMergeBase.mockImplementation(async (ref1: string, ref2: string) => {
			if (ref1 === 'HEAD' && ref2 === '@{upstream}') {
				return 'abc123';
			}
			return undefined;
		});

		mockRepo.getBranchBase.mockResolvedValue(undefined);

		const mockApi = {
			getRepository: () => mockRepo,
		};
		vi.spyOn(gitExtensionService, 'getExtensionApi').mockReturnValue(mockApi as any);

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/modified.ts'),
			originalUri: URI.file('/test/repo/modified.ts'),
			renameUri: undefined,
			status: Status.MODIFIED
		}] as any);

		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue([
			{
				uri: URI.file('/test/repo/modified.ts'),
				originalUri: URI.file('/test/repo/modified.ts'),
				renameUri: undefined,
				status: Status.MODIFIED,
				diff: 'modified content'
			},
			{
				uri: URI.file('/test/repo/filea.txt'),
				originalUri: URI.file('/test/repo/filea.txt'),
				renameUri: undefined,
				status: Status.UNTRACKED,
				diff: 'new file a'
			},
			{
				uri: URI.file('/test/repo/fileb.txt'),
				originalUri: URI.file('/test/repo/fileb.txt'),
				renameUri: undefined,
				status: Status.UNTRACKED,
				diff: 'new file b'
			}
		]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'success');

		const diffs = JSON.parse(call[1].diffsJSON);
		assert.strictEqual(diffs.length, 3, 'Should include 1 modified file + 2 untracked files');

		const uris = diffs.map((d: any) => d.uri);
		assert.ok(uris.includes('file:///test/repo/modified.ts'), 'Should include modified file');
		assert.ok(uris.includes('file:///test/repo/filea.txt'), 'Should include filea.txt from workingTreeChanges');
		assert.ok(uris.includes('file:///test/repo/fileb.txt'), 'Should include fileb.txt from untrackedChanges');

		const fileaEntry = diffs.find((d: any) => d.uri === 'file:///test/repo/filea.txt');
		const filebEntry = diffs.find((d: any) => d.uri === 'file:///test/repo/fileb.txt');
		assert.strictEqual(fileaEntry.status, 'UNTRACKED');
		assert.strictEqual(filebEntry.status, 'UNTRACKED');
	});


	test('should include workspaceFileCount in measurements', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		(workspaceFileIndex as any).fileCount = 250;

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.ok(call[2], 'measurements parameter should exist');
		assert.strictEqual(call[2].workspaceFileCount, 250);
	});

	test('should include changedFileCount in measurements', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const changes = Array.from({ length: 5 }, (_, i) => ({
			uri: URI.file(`/test/repo/file${i}.ts`),
			originalUri: URI.file(`/test/repo/file${i}.ts`),
			renameUri: undefined,
			status: Status.MODIFIED
		}));

		vi.spyOn(gitService, 'diffWith').mockResolvedValue(changes as any);

		vi.spyOn(gitDiffService, 'getChangeDiffs').mockResolvedValue(
			changes.map((c, i) => ({
				uri: URI.file(`/test/repo/file${i}.ts`),
				originalUri: URI.file(`/test/repo/file${i}.ts`),
				renameUri: undefined,
				status: Status.MODIFIED,
				diff: `diff for file${i}`
			}))
		);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.ok(call[2], 'measurements parameter should exist');
		assert.strictEqual(call[2].changedFileCount, 5);
	});

	test('should set changedFileCount to 0 when no changes', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.ok(call[2], 'measurements parameter should exist');
		assert.strictEqual(call[2].changedFileCount, 0);
	});

	test('should include measurements in both begin and end telemetry', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		(workspaceFileIndex as any).fileCount = 150;

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();
		await repoTelemetry.sendEndTelemetry();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 2);

		const beginCall = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.ok(beginCall[2], 'begin measurements should exist');
		assert.strictEqual(beginCall[2].workspaceFileCount, 150);
		assert.strictEqual(beginCall[2].changedFileCount, 1);

		const endCall = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[1];
		assert.ok(endCall[2], 'end measurements should exist');
		assert.strictEqual(endCall[2].workspaceFileCount, 150);
		assert.strictEqual(endCall[2].changedFileCount, 1);
	});

	test('should include measurements even when diff is too large', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED
		}] as any);

		const largeDiff = 'x'.repeat(901 * 1024);
		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED,
			diff: largeDiff
		}]);

		(workspaceFileIndex as any).fileCount = 200;

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'diffTooLarge');
		assert.ok(call[2], 'measurements should still be present');
		assert.strictEqual(call[2].workspaceFileCount, 200);
		assert.strictEqual(call[2].changedFileCount, 1);
	});

	test('should include measurements when there are too many changes', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const manyChanges = Array.from({ length: 101 }, (_, i) => ({
			uri: URI.file(`/test/repo/file${i}.ts`),
			originalUri: URI.file(`/test/repo/file${i}.ts`),
			renameUri: undefined,
			status: Status.MODIFIED
		}));

		vi.spyOn(gitService, 'diffWith').mockResolvedValue(manyChanges as any);

		(workspaceFileIndex as any).fileCount = 300;

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'tooManyChanges');
		assert.ok(call[2], 'measurements should still be present');
		assert.strictEqual(call[2].workspaceFileCount, 300);
		assert.strictEqual(call[2].changedFileCount, 101);
	});

	test('should include diffSizeBytes in measurements when diffs are present', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		const testDiff = 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new';
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: testDiff }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'success');
		assert.ok(call[2], 'measurements parameter should be present');
		assert.strictEqual(typeof call[2].diffSizeBytes, 'number');
		assert.ok(call[2].diffSizeBytes > 0, 'diffSizeBytes should be greater than 0');

		const expectedDiffsJSON = JSON.stringify([{
			uri: 'file:///test/repo/file.ts',
			originalUri: 'file:///test/repo/file.ts',
			renameUri: undefined,
			status: 'MODIFIED',
			diff: testDiff
		}]);
		const expectedSize = Buffer.byteLength(expectedDiffsJSON, 'utf8');
		assert.strictEqual(call[2].diffSizeBytes, expectedSize);
	});


	test('should handle errors during git diff gracefully', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockRejectedValue(new Error('Git error'));

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 0);
	});

	test('should handle errors during diff processing gracefully', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');

		vi.spyOn(gitService, 'diffWith').mockResolvedValue([{
			uri: URI.file('/test/repo/file.ts'),
			originalUri: URI.file('/test/repo/file.ts'),
			renameUri: undefined,
			status: Status.MODIFIED
		}] as any);

		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockRejectedValue(new Error('Diff processing error'));

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 0);
	});


	test('should skip telemetry when disableRepoInfoTelemetry setting is enabled', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		(configurationService as InMemoryConfigurationService).setConfig(
			ConfigKey.TeamInternal.DisableRepoInfoTelemetry, true
		);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 0);
	});

	test('should return mergeBaseTooOld when upstream commit is older than 30 days', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('old-commit-abc');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const mockApi = gitExtensionService.getExtensionApi();
		const mockRepo = mockApi!.getRepository(URI.file('/test/repo'))!;
		(mockRepo as any).getCommit.mockResolvedValue({
			hash: 'old-commit-abc',
			message: 'old commit',
			commitDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
		});

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'mergeBaseTooOld');
		assert.strictEqual(call[1].diffsJSON, undefined);
	});

	test('should proceed normally when upstream commit is within 30 days', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('recent-commit');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);


		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'success');
	});

	test('should return mergeBaseTooOld when getCommit fails', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const mockApi = gitExtensionService.getExtensionApi();
		const mockRepo = mockApi!.getRepository(URI.file('/test/repo'))!;
		(mockRepo as any).getCommit.mockRejectedValue(new Error('Failed to get commit'));

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'mergeBaseTooOld');
	});

	test('should return mergeBaseTooOld when commit date is undefined', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const mockApi = gitExtensionService.getExtensionApi();
		const mockRepo = mockApi!.getRepository(URI.file('/test/repo'))!;
		(mockRepo as any).getCommit.mockResolvedValue({
			hash: 'abc123',
			message: 'commit without date',
			commitDate: undefined,
		});

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[1].result, 'mergeBaseTooOld');
	});


	test('should send one telemetry event per repository in a multi-repo workspace', async () => {
		setupInternalUser();

		const repoAUri = URI.file('/test/repoA');
		const repoBUri = URI.file('/test/repoB');
		mockMultiRepoSetup([
			{ rootUri: repoAUri, remoteUrl: 'https://github.com/microsoft/vscode.git' },
			{ rootUri: repoBUri, remoteUrl: 'https://github.com/microsoft/typescript.git' },
		], repoAUri);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		const calls = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls;
		assert.strictEqual(calls.length, 2, 'should emit one event per repo');

		const propsByRepoIndex = new Map<number, any>();
		for (const call of calls) {
			assert.strictEqual(call[0], 'request.repoInfo');
			propsByRepoIndex.set(call[2].repoIndex, { props: call[1], measurements: call[2] });
		}

		const first = propsByRepoIndex.get(0)!;
		const second = propsByRepoIndex.get(1)!;
		assert.strictEqual(first.measurements.repoCount, 2);
		assert.strictEqual(second.measurements.repoCount, 2);
		assert.strictEqual(first.props.isActiveRepository, 'true');
		assert.strictEqual(second.props.isActiveRepository, 'false');
		assert.strictEqual(first.props.remoteUrl, 'https://github.com/microsoft/vscode.git');
		assert.strictEqual(second.props.remoteUrl, 'https://github.com/microsoft/typescript.git');
	});

	test('should include repoIndex/repoCount/isActiveRepository for single-repo workspace', async () => {
		setupInternalUser();
		mockGitServiceWithRepository();
		mockGitExtensionWithUpstream('abc123');
		mockGitDiffService([{ uri: '/test/repo/file.ts', diff: 'some diff' }]);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		assert.strictEqual((telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls.length, 1);
		const call = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls[0];
		assert.strictEqual(call[2].repoIndex, 0);
		assert.strictEqual(call[2].repoCount, 1);
		assert.strictEqual(call[1].isActiveRepository, 'true');
	});

	test('should gate end telemetry per repo', async () => {
		setupInternalUser();

		const repoAUri = URI.file('/test/repoA');
		const repoBUri = URI.file('/test/repoB');
		mockMultiRepoSetup([
			{ rootUri: repoAUri, remoteUrl: 'https://github.com/microsoft/vscode.git' },
			{ rootUri: repoBUri, remoteUrl: 'https://github.com/microsoft/typescript.git', changeCount: 101 },
		], repoAUri);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();
		await repoTelemetry.sendEndTelemetry();

		const calls = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls;
		assert.strictEqual(calls.length, 3);

		const beginCalls = calls.filter((c: any) => c[1].location === 'begin');
		const endCalls = calls.filter((c: any) => c[1].location === 'end');
		assert.strictEqual(beginCalls.length, 2);
		assert.strictEqual(endCalls.length, 1);
		assert.strictEqual(endCalls[0][1].remoteUrl, 'https://github.com/microsoft/vscode.git');
		assert.strictEqual(endCalls[0][1].result, 'success');
	});

	test('should cap telemetry at 5 repos with active repo always included', async () => {
		setupInternalUser();

		const repos = Array.from({ length: 7 }, (_, i) => ({
			rootUri: URI.file(`/test/repo${i}`),
			remoteUrl: `https://github.com/microsoft/repo${i}.git`,
		}));
		const activeRepoUri = repos[5].rootUri;
		mockMultiRepoSetup(repos, activeRepoUri);

		const repoTelemetry = new RepoInfoTelemetry(
			'test-message-id',
			telemetryService,
			gitService,
			gitDiffService,
			gitExtensionService,
			logService,
			fileSystemService,
			workspaceFileIndex,
			configurationService,
			dardcorTokenStore
		);

		await repoTelemetry.sendBeginTelemetryIfNeeded();

		const calls = (telemetryService.sendInternalMSFTTelemetryEvent as any).mock.calls;
		assert.strictEqual(calls.length, 5);

		for (const call of calls) {
			assert.strictEqual(call[2].repoCount, 7);
		}

		const activeCalls = calls.filter((c: any) => c[1].isActiveRepository === 'true');
		assert.strictEqual(activeCalls.length, 1);
		assert.strictEqual(activeCalls[0][1].remoteUrl, 'https://github.com/microsoft/repo5.git');
	});


	function setupInternalUser() {
		const internalToken = new CopilotToken(createTestExtendedTokenInfo({
			token: 'tid=test;rt=1',
			sku: 'free_limited_dardcor',
			expires_at: 9999999999,
			refresh_in: 180000,
			organization_list: ['4535c7beffc844b46bb1ed4aa04d759a'],
			isVscodeTeamMember: true,
			username: 'testUser',
			dardcor_plan: 'unknown',
		}));
		dardcorTokenStore.dardcorToken = internalToken;
	}

	function mockGitServiceWithRepository() {
		vi.spyOn(gitService.activeRepository, 'get').mockReturnValue({
			rootUri: URI.file('/test/repo'),
			changes: {
				mergeChanges: [],
				indexChanges: [],
				workingTree: [{
					uri: URI.file('/test/repo/file.ts'),
					originalUri: URI.file('/test/repo/file.ts'),
					renameUri: undefined,
					status: Status.MODIFIED
				}],
				untrackedChanges: []
			},
			remotes: ['origin'],
			remoteFetchUrls: ['https://github.com/microsoft/vscode.git'],
			upstreamRemote: 'origin',
			headBranchName: 'main',
			headCommitHash: 'abc123',
			upstreamBranchName: 'origin/main',
			isRebasing: false,
		} as any);
	}

	function mockGitExtensionWithUpstream(upstreamCommit: string | undefined, remoteUrl: string = 'https://github.com/microsoft/vscode.git') {
		const mockRepo = {
			getMergeBase: vi.fn(),
			getBranchBase: vi.fn(),
			getCommit: vi.fn(),
			getConfig: vi.fn().mockResolvedValue(''),
			log: vi.fn().mockResolvedValue([]),
			state: {
				HEAD: {
					upstream: upstreamCommit ? {
						commit: upstreamCommit,
						remote: 'origin',
					} : undefined,
				},
				remotes: [{
					name: 'origin',
					fetchUrl: remoteUrl,
					pushUrl: remoteUrl,
					isReadOnly: false,
				}],
				workingTreeChanges: [],
				untrackedChanges: [],
			},
		};

		mockRepo.getMergeBase.mockImplementation(async (ref1: string, ref2: string) => {
			if (ref1 === 'HEAD' && ref2 === '@{upstream}') {
				return upstreamCommit;
			}
			return undefined;
		});

		mockRepo.getBranchBase.mockResolvedValue(undefined);

		mockRepo.getCommit.mockResolvedValue({
			hash: upstreamCommit ?? 'abc123',
			message: 'test commit',
			commitDate: new Date(),
		});

		const mockApi = {
			getRepository: () => mockRepo,
		};
		vi.spyOn(gitExtensionService, 'getExtensionApi').mockReturnValue(mockApi as any);
	}

	function mockGitDiffService(diffs: any[]) {
		const changes = diffs.map(d => ({
			uri: URI.file(d.uri || '/test/repo/file.ts'),
			originalUri: URI.file(d.originalUri || d.uri || '/test/repo/file.ts'),
			renameUri: d.renameUri ? URI.file(d.renameUri) : undefined,
			status: d.status || Status.MODIFIED
		}));

		vi.spyOn(gitService, 'diffWith').mockResolvedValue(
			diffs.length > 0 ? changes as any : []
		);

		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockResolvedValue(
			diffs.map(d => ({
				uri: URI.file(d.uri || '/test/repo/file.ts'),
				originalUri: URI.file(d.originalUri || d.uri || '/test/repo/file.ts'),
				renameUri: d.renameUri ? URI.file(d.renameUri) : undefined,
				status: d.status || Status.MODIFIED,
				diff: d.diff || 'test diff'
			}))
		);
	}

	function mockMultiRepoSetup(
		repos: Array<{ rootUri: URI; remoteUrl: string; upstreamCommit?: string; changeCount?: number }>,
		activeRootUri: URI
	) {
		const repoContexts = repos.map(r => ({
			rootUri: r.rootUri,
			changes: {
				mergeChanges: [],
				indexChanges: [],
				workingTree: [{
					uri: URI.joinPath(r.rootUri, 'file.ts'),
					originalUri: URI.joinPath(r.rootUri, 'file.ts'),
					renameUri: undefined,
					status: Status.MODIFIED
				}],
				untrackedChanges: []
			},
			remotes: ['origin'],
			remoteFetchUrls: [r.remoteUrl],
			upstreamRemote: 'origin',
			headBranchName: 'main',
			headCommitHash: r.upstreamCommit ?? 'abc123',
			upstreamBranchName: 'origin/main',
			isRebasing: false,
		}));

		const active = repoContexts.find(r => r.rootUri.toString() === activeRootUri.toString());
		vi.spyOn(gitService.activeRepository, 'get').mockReturnValue(active as any);
		Object.defineProperty(gitService, 'repositories', {
			configurable: true,
			get: () => repoContexts,
		});

		const reposByPath = new Map<string, any>();
		for (const ctx of repoContexts) {
			const r = repos.find(x => x.rootUri.toString() === ctx.rootUri.toString())!;
			const upstreamCommit = r.upstreamCommit ?? 'abc123';
			const mockRepo: any = {
				getMergeBase: vi.fn(async (ref1: string, ref2: string) =>
					(ref1 === 'HEAD' && ref2 === '@{upstream}') ? upstreamCommit : undefined
				),
				getBranchBase: vi.fn().mockResolvedValue(undefined),
				getCommit: vi.fn().mockResolvedValue({
					hash: upstreamCommit,
					message: 'test commit',
					commitDate: new Date(),
				}),
				getConfig: vi.fn().mockResolvedValue(''),
				log: vi.fn().mockResolvedValue([]),
				state: {
					HEAD: { upstream: { commit: upstreamCommit, remote: 'origin' } },
					remotes: [{ name: 'origin', fetchUrl: r.remoteUrl, pushUrl: r.remoteUrl, isReadOnly: false }],
					workingTreeChanges: [],
					untrackedChanges: [],
				},
			};
			reposByPath.set(ctx.rootUri.toString(), mockRepo);
		}
		vi.spyOn(gitExtensionService, 'getExtensionApi').mockReturnValue({
			getRepository: (uri: URI) => reposByPath.get(uri.toString()),
		} as any);

		vi.spyOn(gitService, 'diffWith').mockImplementation(async (uri: URI) => {
			const r = repos.find(x => x.rootUri.toString() === uri.toString());
			const count = r?.changeCount ?? 1;
			return Array.from({ length: count }, (_, i) => ({
				uri: URI.joinPath(uri, `file${i}.ts`),
				originalUri: URI.joinPath(uri, `file${i}.ts`),
				renameUri: undefined,
				status: Status.MODIFIED,
			})) as any;
		});

		vi.spyOn(gitDiffService, 'getWorkingTreeDiffsFromRef').mockImplementation(async (repositoryOrUri: any) => {
			const uri: URI = URI.isUri(repositoryOrUri) ? repositoryOrUri : repositoryOrUri.rootUri;
			const r = repos.find(x => x.rootUri.toString() === uri.toString());
			const count = r?.changeCount ?? 1;
			return Array.from({ length: count }, (_, i) => ({
				uri: URI.joinPath(uri, `file${i}.ts`),
				originalUri: URI.joinPath(uri, `file${i}.ts`),
				renameUri: undefined,
				status: Status.MODIFIED,
				diff: 'test diff',
			})) as any;
		});
	}
});


class MockFileSystemWatcher implements FileSystemWatcher {
	private _createHandlers: ((e: Uri) => any)[] = [];
	private _changeHandlers: ((e: Uri) => any)[] = [];
	private _deleteHandlers: ((e: Uri) => any)[] = [];
	public isDisposed = false;
	public ignoreCreateEvents = false;
	public ignoreChangeEvents = false;
	public ignoreDeleteEvents = false;

	get onDidCreate(): Event<Uri> {
		return (listener) => {
			this._createHandlers.push(listener);
			return {
				dispose: () => {
					const index = this._createHandlers.indexOf(listener);
					if (index > -1) {
						this._createHandlers.splice(index, 1);
					}
				}
			};
		};
	}

	get onDidChange(): Event<Uri> {
		return (listener) => {
			this._changeHandlers.push(listener);
			return {
				dispose: () => {
					const index = this._changeHandlers.indexOf(listener);
					if (index > -1) {
						this._changeHandlers.splice(index, 1);
					}
				}
			};
		};
	}

	get onDidDelete(): Event<Uri> {
		return (listener) => {
			this._deleteHandlers.push(listener);
			return {
				dispose: () => {
					const index = this._deleteHandlers.indexOf(listener);
					if (index > -1) {
						this._deleteHandlers.splice(index, 1);
					}
				}
			};
		};
	}

	triggerCreate(uri: Uri): void {
		this._createHandlers.forEach(h => h(uri));
	}

	triggerChange(uri: Uri): void {
		this._changeHandlers.forEach(h => h(uri));
	}

	triggerDelete(uri: Uri): void {
		this._deleteHandlers.forEach(h => h(uri));
	}

	dispose(): void {
		this.isDisposed = true;
		this._createHandlers = [];
		this._changeHandlers = [];
		this._deleteHandlers = [];
	}
}
