/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { afterEach, beforeEach, suite, test, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import { INSTRUCTION_FILE_EXTENSION, PromptsType } from '../../../../platform/customInstructions/common/promptTypes';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { MockAuthenticationService } from '../../../../platform/ignore/node/test/mockAuthenticationService';
import { MockGitService } from '../../../../platform/ignore/node/test/mockGitService';
import { MockWorkspaceService } from '../../../../platform/ignore/node/test/mockWorkspaceService';
import { ILogService } from '../../../../platform/log/common/logService';
import { DisposableStore } from '../../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { GitHubOrgChatResourcesService } from '../githubOrgChatResourcesService';
import { GitHubOrgInstructionsProvider } from '../githubOrgInstructionsProvider';
import { MockOctoKitService } from './mockOctoKitService';

suite('GitHubOrgInstructionsProvider', () => {
	let disposables: DisposableStore;
	let mockOctoKitService: MockOctoKitService;
	let mockFileSystem: MockFileSystemService;
	let mockGitService: MockGitService;
	let mockWorkspaceService: MockWorkspaceService;
	let mockExtensionContext: Partial<ExtensionContext>;
	let mockAuthService: MockAuthenticationService;
	let accessor: any;
	let provider: GitHubOrgInstructionsProvider;
	let resourcesService: GitHubOrgChatResourcesService;

	const storagePath = '/tmp/test-storage';
	const storageUri = URI.file(storagePath);

	beforeEach(() => {
		vi.useFakeTimers();
		disposables = new DisposableStore();

		mockOctoKitService = new MockOctoKitService();
		mockFileSystem = new MockFileSystemService();
		mockGitService = new MockGitService();
		mockWorkspaceService = new MockWorkspaceService();
		mockExtensionContext = {
			globalStorageUri: storageUri,
		};
		mockAuthService = new MockAuthenticationService();

		mockOctoKitService.setUserOrganizations(['testorg']);
		mockWorkspaceService.setWorkspaceFolders([URI.file('/workspace')]);
		mockGitService.setRepositoryFetchUrls({
			rootUri: URI.file('/workspace'),
			remoteFetchUrls: ['https://github.com/testorg/repo.git']
		});

		const testingServiceCollection = createExtensionUnitTestingServices(disposables);
		accessor = disposables.add(testingServiceCollection.createTestingAccessor());
	});

	afterEach(() => {
		vi.useRealTimers();
		disposables.dispose();
		mockOctoKitService.reset();
	});

	function createProvider(): GitHubOrgInstructionsProvider {
		resourcesService = new GitHubOrgChatResourcesService(
			mockAuthService as any,
			mockExtensionContext as any,
			mockFileSystem,
			mockGitService,
			accessor.get(ILogService),
			mockOctoKitService,
			mockWorkspaceService,
		);
		disposables.add(resourcesService);

		provider = new GitHubOrgInstructionsProvider(
			accessor.get(ILogService),
			mockOctoKitService,
			resourcesService,
		);
		disposables.add(provider);
		return provider;
	}

	async function waitForPolling(): Promise<void> {
		await vi.advanceTimersByTimeAsync(10);
	}

	function prepopulateCache(orgName: string, files: Map<string, string>): void {
		const cacheDir = URI.file(`${storagePath}/github/${orgName}/instructions`);
		const dirEntries: [string, import('../../../../platform/filesystem/common/fileTypes').FileType][] = [];
		for (const [filename, content] of files) {
			mockFileSystem.mockFile(URI.joinPath(cacheDir, filename), content);
			dirEntries.push([filename, 1 ]);
		}
		mockFileSystem.mockDirectory(cacheDir, dirEntries);
	}

	test('returns empty array when no organization available', async () => {
		mockOctoKitService.setUserOrganizations([]);
		mockWorkspaceService.setWorkspaceFolders([]);
		const provider = createProvider();

		const instructions = await provider.provideInstructions({}, {} as any);

		assert.deepEqual(instructions, []);
	});

	test('returns cached instructions when available', async () => {
		const orgId = 'testorg';

		const instructionContent = '# Custom Instructions\nThese are custom instructions for the organization.';
		prepopulateCache(orgId, new Map([
			[`default${INSTRUCTION_FILE_EXTENSION}`, instructionContent]
		]));

		const provider = createProvider();

		const instructions = await provider.provideInstructions({}, {} as any);

		assert.equal(instructions.length, 1);
		assert.ok(instructions[0].uri.path.endsWith(`default${INSTRUCTION_FILE_EXTENSION}`));
	});

	test('returns empty array when cache is empty', async () => {
		const provider = createProvider();

		const instructions = await provider.provideInstructions({}, {} as any);

		assert.deepEqual(instructions, []);
	});

	test.skip('pollInstructions writes instructions to cache when found', async () => {
		const orgId = 'testorg';
		const instructionContent = '# Organization Instructions\nBe helpful and concise.';

		mockOctoKitService.setOrgInstructions(orgId, instructionContent);

		createProvider();
		await waitForPolling();

		const cachedContent = await resourcesService.readCacheFile(
			PromptsType.instructions,
			orgId,
			`default${INSTRUCTION_FILE_EXTENSION}`
		);

		const expectedContent = `---\napplyTo: '**'\n---\n${instructionContent}`;
		assert.equal(cachedContent, expectedContent);
	});

	test.skip('pollInstructions does nothing when no instructions found', async () => {
		mockOctoKitService.setOrgInstructions('testorg', undefined);

		createProvider();
		await waitForPolling();

		const cachedContent = await resourcesService.readCacheFile(
			PromptsType.instructions,
			'testorg',
			`default${INSTRUCTION_FILE_EXTENSION}`
		);

		assert.isUndefined(cachedContent);
	});

	test.skip('fires change event when instructions content changes', async () => {
		const instructionContent = '# New Instructions\nUpdated content.';

		mockOctoKitService.setOrgInstructions('testorg', instructionContent);

		const provider = createProvider();

		let eventFired = false;
		provider.onDidChangeInstructions(() => {
			eventFired = true;
		});

		await waitForPolling();

		assert.isTrue(eventFired, 'Change event should fire when instructions are updated');
	});

	test.skip('fires change event on every successful poll with instructions', async () => {
		const instructionContent = '# Stable Instructions\nThis content will not change.';

		mockOctoKitService.setOrgInstructions('testorg', instructionContent);

		prepopulateCache('testorg', new Map([
			[`default${INSTRUCTION_FILE_EXTENSION}`, instructionContent]
		]));

		const provider = createProvider();

		let changeEventCount = 0;
		provider.onDidChangeInstructions(() => {
			changeEventCount++;
		});

		await waitForPolling();

		assert.equal(changeEventCount, 1, 'Change event fires on every successful poll');
	});

	test.skip('pollInstructions handles API errors gracefully without throwing', async () => {
		mockOctoKitService.getOrgCustomInstructions = async () => {
			throw new Error('API Error');
		};

		createProvider();

		let errorThrown = false;
		try {
			await waitForPolling();
		} catch (e: any) {
			errorThrown = true;
		}

		assert.isFalse(errorThrown, 'API errors should be handled internally and not propagate');
	});

	test('returns instructions from correct organization', async () => {
		prepopulateCache('org1', new Map([
			[`default${INSTRUCTION_FILE_EXTENSION}`, 'Org1 instructions']
		]));
		prepopulateCache('org2', new Map([
			[`default${INSTRUCTION_FILE_EXTENSION}`, 'Org2 instructions']
		]));

		mockOctoKitService.setUserOrganizations(['org1', 'org2']);
		mockGitService.setRepositoryFetchUrls({
			rootUri: URI.file('/workspace'),
			remoteFetchUrls: ['https://github.com/org2/repo.git']
		});

		const provider = createProvider();

		const instructions = await provider.provideInstructions({}, {} as any);

		assert.equal(instructions.length, 1);
		assert.ok(instructions[0].uri.path.includes('org2'));
	});

	test('handles cache read errors gracefully', async () => {
		const provider = createProvider();

		const originalReadDirectory = mockFileSystem.readDirectory.bind(mockFileSystem);
		mockFileSystem.readDirectory = async () => {
			throw new Error('Cache read error');
		};

		const instructions = await provider.provideInstructions({}, {} as any);

		assert.deepEqual(instructions, []);

		mockFileSystem.readDirectory = originalReadDirectory;
	});

	test('respects cancellation token in provideInstructions', async () => {
		prepopulateCache('testorg', new Map([
			[`default${INSTRUCTION_FILE_EXTENSION}`, 'Some instructions']
		]));

		const provider = createProvider();

		const cancelledToken = {
			isCancellationRequested: true,
			onCancellationRequested: () => ({ dispose: () => { } })
		};

		const instructions = await provider.provideInstructions({}, cancelledToken as any);

		assert.deepEqual(instructions, []);
	});

	test('uses correct file extension for instruction files', async () => {
		const instructionContent = '# Test Instructions';

		mockOctoKitService.setOrgInstructions('testorg', instructionContent);

		const provider = createProvider();
		await waitForPolling();

		const cachedContent = await resourcesService.readCacheFile(
			PromptsType.instructions,
			'testorg',
			`default${INSTRUCTION_FILE_EXTENSION}`
		);

		const expectedContent = `---\napplyTo: '**'\n---\n${instructionContent}`;
		assert.equal(cachedContent, expectedContent);

		prepopulateCache('testorg', new Map([
			[`default${INSTRUCTION_FILE_EXTENSION}`, instructionContent]
		]));

		const instructions = await provider.provideInstructions({}, {} as any);
		assert.equal(instructions.length, 1);
		assert.ok(instructions[0].uri.path.endsWith(INSTRUCTION_FILE_EXTENSION));
	});

	test('disposes polling subscription when provider is disposed', () => {
		const provider = createProvider();

		provider.dispose();

		assert.ok(true, 'Provider disposed without errors');
	});

	test('multiple instruction files are returned when present', async () => {
		prepopulateCache('testorg', new Map([
			[`default${INSTRUCTION_FILE_EXTENSION}`, 'Default instructions'],
			[`custom${INSTRUCTION_FILE_EXTENSION}`, 'Custom instructions'],
			[`team${INSTRUCTION_FILE_EXTENSION}`, 'Team instructions'],
		]));

		const provider = createProvider();

		const instructions = await provider.provideInstructions({}, {} as any);

		assert.equal(instructions.length, 3);
	});
});
