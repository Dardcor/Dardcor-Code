/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { afterEach, beforeEach, suite, test, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import { Scalar } from 'yaml';
import { PromptsType } from '../../../../platform/customInstructions/common/promptTypes';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { CustomAgentDetails, CustomAgentListItem, CustomAgentListOptions } from '../../../../platform/github/common/githubService';
import { MockAuthenticationService } from '../../../../platform/ignore/node/test/mockAuthenticationService';
import { MockGitService } from '../../../../platform/ignore/node/test/mockGitService';
import { MockWorkspaceService } from '../../../../platform/ignore/node/test/mockWorkspaceService';
import { ILogService } from '../../../../platform/log/common/logService';
import { DisposableStore } from '../../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { parse } from '../../../../util/dardcor/base/common/yaml';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { GitHubOrgChatResourcesService } from '../githubOrgChatResourcesService';
import { GitHubOrgCustomAgentProvider, looksLikeNumber, yamlString } from '../githubOrgCustomAgentProvider';
import { MockOctoKitService } from './mockOctoKitService';

suite('GitHubOrgCustomAgentProvider', () => {
	let disposables: DisposableStore;
	let mockOctoKitService: MockOctoKitService;
	let mockFileSystem: MockFileSystemService;
	let mockGitService: MockGitService;
	let mockWorkspaceService: MockWorkspaceService;
	let mockExtensionContext: Partial<ExtensionContext>;
	let mockAuthService: MockAuthenticationService;
	let accessor: any;
	let provider: GitHubOrgCustomAgentProvider;
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
		mockOctoKitService.clearAgents();
	});

	function createProvider() {
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

		provider = new GitHubOrgCustomAgentProvider(
			mockOctoKitService,
			accessor.get(ILogService),
			resourcesService,
		);
		disposables.add(provider);
		return provider;
	}

	async function waitForPolling(): Promise<void> {
		await vi.advanceTimersByTimeAsync(10);
	}

	function prepopulateCache(orgName: string, files: Map<string, string>): void {
		const cacheDir = URI.file(`${storagePath}/github/${orgName}/agents`);
		const dirEntries: [string, import('../../../../platform/filesystem/common/fileTypes').FileType][] = [];
		for (const [filename, content] of files) {
			mockFileSystem.mockFile(URI.joinPath(cacheDir, filename), content);
			dirEntries.push([filename, 1 ]);
		}
		mockFileSystem.mockDirectory(cacheDir, dirEntries);
	}

	test('returns empty array when user has no organizations', async () => {
		mockOctoKitService.setUserOrganizations([]);
		mockWorkspaceService.setWorkspaceFolders([]);
		const provider = createProvider();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.deepEqual(agents, []);
	});

	test('returns empty array when no organizations and no cached files', async () => {
		mockOctoKitService.setUserOrganizations([]);
		mockWorkspaceService.setWorkspaceFolders([]);
		const provider = createProvider();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.deepEqual(agents, []);
	});

	test.skip('returns cached agents on first call', async () => {
		mockOctoKitService.setUserOrganizations([]);
		mockWorkspaceService.setWorkspaceFolders([]);

		const agentContent = `---
name: Test Agent
description: A test agent
---
Test prompt content`;
		prepopulateCache('testorg', new Map([['test_agent.agent.md', agentContent]]));

		mockOctoKitService.setUserOrganizations(['testorg']);

		const provider = createProvider();

		await waitForPolling();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.equal(agents.length, 1);
		const agentName = agents[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(agentName, 'test_agent');
	});

	test('fetches and caches agents from API', async () => {
		const mockAgent: CustomAgentListItem = {
			name: 'api_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'API Agent',
			description: 'An agent from API',
			tools: ['tool1'],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'API prompt content',
		};
		mockOctoKitService.setAgentDetails('api_agent', mockDetails);

		const provider = createProvider();

		await waitForPolling();

		const agents2 = await provider.provideCustomAgents({}, {} as any);
		assert.equal(agents2.length, 1);
		const agentName2 = agents2[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(agentName2, 'api_agent');

		const agents3 = await provider.provideCustomAgents({}, {} as any);
		assert.equal(agents3.length, 1);
		const agentName3 = agents3[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(agentName3, 'api_agent');
	});

	test('generates correct markdown format for agents', async () => {
		const provider = createProvider();

		const mockAgent: CustomAgentListItem = {
			name: 'full_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Full Agent',
			description: 'A fully configured agent',
			tools: ['tool1', 'tool2'],
			version: 'v1',
			argument_hint: 'Provide context',
			target: 'vscode',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'Detailed prompt content',
			model: 'gpt-4',
			disable_model_invocation: true,
		};
		mockOctoKitService.setAgentDetails('full_agent', mockDetails);

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		const content = await resourcesService.readCacheFile(PromptsType.agent, 'testorg', 'full_agent.agent.md');

		const expectedContent = `---
name: Full Agent
description: A fully configured agent
tools:
  - tool1
  - tool2
argument-hint: Provide context
target: vscode
model: gpt-4
disable-model-invocation: true
---
Detailed prompt content
`;

		assert.equal(content, expectedContent);
	});

	test('generates markdown with user-invocable property', async () => {
		const provider = createProvider();

		const mockAgent: CustomAgentListItem = {
			name: 'invocable_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Invocable Agent',
			description: 'An agent with user-invocable set',
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'Invocable prompt content',
			user_invocable: true,
		};
		mockOctoKitService.setAgentDetails('invocable_agent', mockDetails);

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		const content = await resourcesService.readCacheFile(PromptsType.agent, 'testorg', 'invocable_agent.agent.md');

		const expectedContent = `---
name: Invocable Agent
description: An agent with user-invocable set
user-invocable: true
---
Invocable prompt content
`;

		assert.equal(content, expectedContent);
	});

	test('generates markdown with false values for disable-model-invocation and user-invocable', async () => {
		const provider = createProvider();

		const mockAgent: CustomAgentListItem = {
			name: 'false_flags_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'False Flags Agent',
			description: 'Agent with false boolean flags',
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'False flags prompt',
			disable_model_invocation: false,
			user_invocable: false,
		};
		mockOctoKitService.setAgentDetails('false_flags_agent', mockDetails);

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		const content = await resourcesService.readCacheFile(PromptsType.agent, 'testorg', 'false_flags_agent.agent.md');

		const expectedContent = `---
name: False Flags Agent
description: Agent with false boolean flags
disable-model-invocation: false
user-invocable: false
---
False flags prompt
`;

		assert.equal(content, expectedContent);
	});

	test('preserves agent name in filename', async () => {
		const provider = createProvider();

		const mockAgent: CustomAgentListItem = {
			name: 'my-agent_name',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'My Agent',
			description: 'Test filename',
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'Prompt content',
		};
		mockOctoKitService.setAgentDetails('my-agent_name', mockDetails);

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		const content = await resourcesService.readCacheFile(PromptsType.agent, 'testorg', 'my-agent_name.agent.md');
		assert.ok(content, 'File should exist with agent name as filename');
	});

	test.skip('fires change event when cache is updated on first fetch', async () => {
		const provider = createProvider();

		const mockAgent: CustomAgentListItem = {
			name: 'changing_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Changing Agent',
			description: 'Will change',
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'Initial prompt',
		};
		mockOctoKitService.setAgentDetails('changing_agent', mockDetails);

		let eventFired = false;
		provider.onDidChangeCustomAgents(() => {
			eventFired = true;
		});

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		assert.equal(eventFired, true);
	});

	test('handles API errors gracefully', async () => {
		const provider = createProvider();

		mockOctoKitService.getCustomAgents = async () => {
			throw new Error('API Error');
		};

		const agents = await provider.provideCustomAgents({}, {} as any);
		assert.deepEqual(agents, []);
	});

	test('passes query options to API correctly', async () => {
		const provider = createProvider();

		let capturedOptions: CustomAgentListOptions | undefined;
		mockOctoKitService.getCustomAgents = async (owner: string, repo: string, options?: CustomAgentListOptions) => {
			capturedOptions = options;
			return [];
		};

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		assert.ok(capturedOptions);
		assert.deepEqual(capturedOptions.includeSources, ['org', 'enterprise']);
	});

	test('prevents concurrent fetches when called multiple times rapidly', async () => {
		const provider = createProvider();

		let apiCallCount = 0;
		mockOctoKitService.getCustomAgents = async () => {
			apiCallCount++;
			await new Promise(resolve => {
				const realSetTimeout = globalThis.setTimeout;
				realSetTimeout(resolve, 50);
			});
			return [];
		};

		const promise1 = provider.provideCustomAgents({}, {} as any);
		const promise2 = provider.provideCustomAgents({}, {} as any);
		const promise3 = provider.provideCustomAgents({}, {} as any);

		await Promise.all([promise1, promise2, promise3]);
		await waitForPolling();

		assert.equal(apiCallCount, 1);
	});

	test('handles partial agent detail fetch failures gracefully', async () => {
		const agents: CustomAgentListItem[] = [
			{
				name: 'agent1',
				repo_owner_id: 1,
				repo_owner: 'testorg',
				repo_id: 1,
				repo_name: 'testrepo',
				display_name: 'Agent 1',
				description: 'First agent',
				tools: [],
				version: 'v1',
			},
			{
				name: 'agent2',
				repo_owner_id: 1,
				repo_owner: 'testorg',
				repo_id: 1,
				repo_name: 'testrepo',
				display_name: 'Agent 2',
				description: 'Second agent',
				tools: [],
				version: 'v1',
			},
		];
		mockOctoKitService.setCustomAgents(agents);

		mockOctoKitService.setAgentDetails('agent1', {
			...agents[0],
			prompt: 'Agent 1 prompt',
		});

		const agentContent = `---
name: Agent 1
description: First agent
---
Agent 1 prompt`;
		prepopulateCache('testorg', new Map([['agent1.agent.md', agentContent]]));

		const provider = createProvider();
		await waitForPolling();

		const cachedAgents = await provider.provideCustomAgents({}, {} as any);
		assert.equal(cachedAgents.length, 1);
		const cachedAgentName = cachedAgents[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(cachedAgentName, 'agent1');
	});

	test('caches agents in memory after first successful fetch', async () => {
		const initialAgent: CustomAgentListItem = {
			name: 'initial_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Initial Agent',
			description: 'First agent',
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([initialAgent]);
		mockOctoKitService.setAgentDetails('initial_agent', {
			...initialAgent,
			prompt: 'Initial prompt',
		});

		const provider = createProvider();
		await waitForPolling();

		const agents1 = await provider.provideCustomAgents({}, {} as any);
		assert.equal(agents1.length, 1);
		const agentName1 = agents1[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(agentName1, 'initial_agent');

		const newAgent: CustomAgentListItem = {
			name: 'new_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'New Agent',
			description: 'Newly added agent',
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([initialAgent, newAgent]);
		mockOctoKitService.setAgentDetails('new_agent', {
			...newAgent,
			prompt: 'New prompt',
		});

		const agents2 = await provider.provideCustomAgents({}, {} as any);
		assert.equal(agents2.length, 1);
		const agentName2ForMemory = agents2[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(agentName2ForMemory, 'initial_agent');
	});

	test('memory cache persists after first successful fetch', async () => {
		const agents: CustomAgentListItem[] = [
			{
				name: 'agent1',
				repo_owner_id: 1,
				repo_owner: 'testorg',
				repo_id: 1,
				repo_name: 'testrepo',
				display_name: 'Agent 1',
				description: 'First agent',
				tools: [],
				version: 'v1',
			},
			{
				name: 'agent2',
				repo_owner_id: 1,
				repo_owner: 'testorg',
				repo_id: 1,
				repo_name: 'testrepo',
				display_name: 'Agent 2',
				description: 'Second agent',
				tools: [],
				version: 'v1',
			},
		];
		mockOctoKitService.setCustomAgents(agents);
		mockOctoKitService.setAgentDetails('agent1', { ...agents[0], prompt: 'Prompt 1' });
		mockOctoKitService.setAgentDetails('agent2', { ...agents[1], prompt: 'Prompt 2' });

		const provider = createProvider();
		await waitForPolling();

		const cachedAgents1 = await provider.provideCustomAgents({}, {} as any);
		assert.equal(cachedAgents1.length, 2);

		mockOctoKitService.setCustomAgents([agents[0]]);

		const cachedAgents2 = await provider.provideCustomAgents({}, {} as any);
		assert.equal(cachedAgents2.length, 2);
		const cachedAgent2Name1 = cachedAgents2[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		const cachedAgent2Name2 = cachedAgents2[1].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(cachedAgent2Name1, 'agent1');
		assert.equal(cachedAgent2Name2, 'agent2');
	});

	test.skip('does not fire change event when content is identical', async () => {
		const provider = createProvider();

		const mockAgent: CustomAgentListItem = {
			name: 'stable_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Stable Agent',
			description: 'Unchanging agent',
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);
		mockOctoKitService.setAgentDetails('stable_agent', {
			...mockAgent,
			prompt: 'Stable prompt',
		});

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		let changeEventCount = 0;
		provider.onDidChangeCustomAgents(() => {
			changeEventCount++;
		});

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		assert.equal(changeEventCount, 0);
	});

	test('memory cache persists even when API returns empty list', async () => {
		const mockAgent: CustomAgentListItem = {
			name: 'temporary_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Temporary Agent',
			description: 'Will be removed',
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);
		mockOctoKitService.setAgentDetails('temporary_agent', {
			...mockAgent,
			prompt: 'Temporary prompt',
		});

		const provider = createProvider();
		await waitForPolling();

		const agents1 = await provider.provideCustomAgents({}, {} as any);
		assert.equal(agents1.length, 1);

		mockOctoKitService.setCustomAgents([]);

		const agents2 = await provider.provideCustomAgents({}, {} as any);
		assert.equal(agents2.length, 1);
		const temporaryAgentName = agents2[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(temporaryAgentName, 'temporary_agent');
	});

	test('generates markdown with only required fields', async () => {
		const provider = createProvider();

		const mockAgent: CustomAgentListItem = {
			name: 'minimal_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Minimal Agent',
			description: 'Minimal description',
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'Minimal prompt',
		};
		mockOctoKitService.setAgentDetails('minimal_agent', mockDetails);

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		const content = await resourcesService.readCacheFile(PromptsType.agent, 'testorg', 'minimal_agent.agent.md');
		assert.ok(content, 'Agent file should exist');

		assert.ok(content.includes('name: Minimal Agent'));
		assert.ok(content.includes('description: Minimal description'));
		assert.ok(!content.includes('tools:'));
		assert.ok(!content.includes('argument-hint:'));
		assert.ok(!content.includes('target:'));
		assert.ok(!content.includes('model:'));
		assert.ok(!content.includes('disable-model-invocation:'));
	});

	test('excludes tools field when array contains only wildcard', async () => {
		const provider = createProvider();

		const mockAgent: CustomAgentListItem = {
			name: 'wildcard_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Wildcard Agent',
			description: 'Agent with wildcard tools',
			tools: ['*'],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'Wildcard prompt',
		};
		mockOctoKitService.setAgentDetails('wildcard_agent', mockDetails);

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		const content = await resourcesService.readCacheFile(PromptsType.agent, 'testorg', 'wildcard_agent.agent.md');
		assert.ok(content, 'Agent file should exist');

		assert.ok(!content.includes('tools:'));
	});

	test.skip('handles malformed frontmatter in cached files', async () => {
		mockOctoKitService.setUserOrganizations([]);
		mockWorkspaceService.setWorkspaceFolders([]);

		const validContent = `---
name: Valid Agent
description: A valid agent
---
Valid prompt`;
		const noFrontmatterContent = `Just some content without any frontmatter`;
		prepopulateCache('testorg', new Map([
			['valid_agent.agent.md', validContent],
			['no_frontmatter.agent.md', noFrontmatterContent],
		]));

		mockOctoKitService.setUserOrganizations(['testorg']);

		const provider = createProvider();

		await waitForPolling();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.equal(agents.length, 2);
		const validAgentName = agents[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(validAgentName, 'valid_agent');
		const noFrontmatterAgentName = agents[1].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(noFrontmatterAgentName, 'no_frontmatter');
	});

	test('fetches agents from preferred organization only', async () => {
		const provider = createProvider();

		mockOctoKitService.setUserOrganizations(['testorg', 'otherorg1', 'otherorg2']);

		const capturedOrgs: string[] = [];
		mockOctoKitService.getCustomAgents = async (owner: string, repo: string) => {
			capturedOrgs.push(owner);
			return [];
		};

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		assert.equal(capturedOrgs.length, 1);
		assert.ok(capturedOrgs.includes('testorg'));
	});

	test('generates markdown with long description on single line', async () => {
		const provider = createProvider();

		const longDescription = 'Just for fun agent that teaches computer science concepts (while pretending to plot world domination).';
		const mockAgent: CustomAgentListItem = {
			name: 'world_domination',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'World Domination',
			description: longDescription,
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: '# World Domination Agent\n\nYou are a world-class computer scientist.',
		};
		mockOctoKitService.setAgentDetails('world_domination', mockDetails);

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		const content = await resourcesService.readCacheFile(PromptsType.agent, 'testorg', 'world_domination.agent.md');

		const expectedContent = `---
name: World Domination
description: Just for fun agent that teaches computer science concepts (while pretending to plot world domination).
---
# World Domination Agent

You are a world-class computer scientist.
`;

		assert.equal(content, expectedContent);
	});

	test('generates markdown with special characters properly escaped in description', async () => {
		const provider = createProvider();

		const descriptionWithSpecialChars = `Agent with "double quotes", 'single quotes', colons:, and #comments in the description`;
		const mockAgent: CustomAgentListItem = {
			name: 'special_chars_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Special Chars Agent',
			description: descriptionWithSpecialChars,
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'Test prompt with special characters',
		};
		mockOctoKitService.setAgentDetails('special_chars_agent', mockDetails);

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		const content = await resourcesService.readCacheFile(PromptsType.agent, 'testorg', 'special_chars_agent.agent.md');

		const expectedContent = `---
name: Special Chars Agent
description: "Agent with \\"double quotes\\", 'single quotes', colons:, and #comments in the description"
---
Test prompt with special characters
`;

		assert.equal(content, expectedContent);
	});

	test('generates markdown with multiline description containing newlines', async () => {
		const provider = createProvider();

		const descriptionWithNewlines = 'First line of description.\nSecond line of description.\nThird line.';
		const mockAgent: CustomAgentListItem = {
			name: 'multiline_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 1,
			repo_name: 'testrepo',
			display_name: 'Multiline Agent',
			description: descriptionWithNewlines,
			tools: [],
			version: 'v1',
		};
		mockOctoKitService.setCustomAgents([mockAgent]);

		const mockDetails: CustomAgentDetails = {
			...mockAgent,
			prompt: 'Test prompt',
		};
		mockOctoKitService.setAgentDetails('multiline_agent', mockDetails);

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		const content = await resourcesService.readCacheFile(PromptsType.agent, 'testorg', 'multiline_agent.agent.md');

		const expectedContent = `---
name: Multiline Agent
description: "First line of description.\\nSecond line of description.\\nThird line."
---
Test prompt
`;

		assert.equal(content, expectedContent);
	});

	test('aborts fetch if user signs out during process', async () => {
		const provider = createProvider();

		mockOctoKitService.setUserOrganizations(['org1', 'org2']);
		mockOctoKitService.getOrganizationRepositories = async (org) => ['repo'];

		let callCount = 0;
		const originalGetCustomAgents = mockOctoKitService.getCustomAgents;
		mockOctoKitService.getCustomAgents = async (owner, repo, options) => {
			callCount++;
			if (callCount === 1) {
				mockOctoKitService.getCurrentAuthedUser = async () => undefined as any;
			}
			return originalGetCustomAgents.call(mockOctoKitService, owner, repo, options, {});
		};

		await provider.provideCustomAgents({}, {} as any);
		await waitForPolling();

		assert.equal(callCount, 1);
	});

	test('deduplicates enterprise agents that appear in multiple organizations', async () => {
		mockOctoKitService.setUserOrganizations(['orgA', 'orgB']);
		mockWorkspaceService.setWorkspaceFolders([]);

		const enterpriseAgent: CustomAgentListItem = {
			name: 'enterprise_agent',
			repo_owner_id: 999,
			repo_owner: 'enterprise_org',
			repo_id: 123,
			repo_name: 'enterprise_repo',
			display_name: 'Enterprise Agent',
			description: 'Shared enterprise agent',
			tools: [],
			version: 'v1.0',
		};

		mockOctoKitService.getCustomAgents = async (owner: string, repo: string) => {
			return [enterpriseAgent];
		};

		mockOctoKitService.setAgentDetails('enterprise_agent', {
			...enterpriseAgent,
			prompt: 'Enterprise prompt',
		});

		const provider = createProvider();
		await waitForPolling();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.equal(agents.length, 1);
		const enterpriseAgentName = agents[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(enterpriseAgentName, 'enterprise_agent');

		const orgAContent = await resourcesService.readCacheFile(PromptsType.agent, 'orga', 'enterprise_agent.agent.md');
		const orgBContent = await resourcesService.readCacheFile(PromptsType.agent, 'orgb', 'enterprise_agent.agent.md');
		const orgAHasAgent = orgAContent !== undefined;
		const orgBHasAgent = orgBContent !== undefined;

		assert.ok(orgAHasAgent && !orgBHasAgent, 'Enterprise agent should only be cached in first org');
	});

	test('deduplicates agents with same repo regardless of version', async () => {
		mockOctoKitService.setUserOrganizations(['orgA', 'orgB']);

		const agentV1: CustomAgentListItem = {
			name: 'versioned_agent',
			repo_owner_id: 999,
			repo_owner: 'enterprise_org',
			repo_id: 123,
			repo_name: 'enterprise_repo',
			display_name: 'Versioned Agent',
			description: 'Agent version 1',
			tools: [],
			version: 'v1.0',
		};

		const agentV2: CustomAgentListItem = {
			name: 'versioned_agent',
			repo_owner_id: 999,
			repo_owner: 'enterprise_org',
			repo_id: 123,
			repo_name: 'enterprise_repo',
			display_name: 'Versioned Agent',
			description: 'Agent version 2',
			tools: [],
			version: 'v2.0',
		};

		let callCount = 0;
		mockOctoKitService.getCustomAgents = async (owner: string, repo: string) => {
			callCount++;
			if (callCount === 1) {
				return [agentV1, agentV2];
			} else {
				return [agentV1, agentV2];
			}
		};

		mockOctoKitService.getCustomAgentDetails = async (owner: string, repo: string, agentName: string, version?: string) => {
			if (version === 'v1.0') {
				return { ...agentV1, prompt: 'Version 1 prompt' };
			} else if (version === 'v2.0') {
				return { ...agentV2, prompt: 'Version 2 prompt' };
			}
			return undefined;
		};

		const provider = createProvider();
		await waitForPolling();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.equal(agents.length, 1);
		const versionedAgentName = agents[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(versionedAgentName, 'versioned_agent');
	});

	test('handles agents with same name but different repo owners from single org', async () => {
		mockOctoKitService.setUserOrganizations(['testorg']);

		const orgAAgent: CustomAgentListItem = {
			name: 'shared_agent',
			repo_owner_id: 1,
			repo_owner: 'testorg',
			repo_id: 10,
			repo_name: 'org_repo',
			display_name: 'Org Agent',
			description: 'Agent from org repo',
			tools: [],
			version: 'v1.0',
		};

		const enterpriseAgent: CustomAgentListItem = {
			name: 'shared_agent',
			repo_owner_id: 999,
			repo_owner: 'enterprise_org',
			repo_id: 100,
			repo_name: 'enterprise_repo',
			display_name: 'Enterprise Agent',
			description: 'Agent from enterprise',
			tools: [],
			version: 'v1.0',
		};

		mockOctoKitService.getCustomAgents = async (owner: string, repo: string) => {
			return [orgAAgent, enterpriseAgent];
		};

		mockOctoKitService.getCustomAgentDetails = async (owner: string, repo: string, agentName: string, version?: string) => {
			if (owner === 'testorg') {
				return { ...orgAAgent, prompt: 'Org prompt' };
			} else if (owner === 'enterprise_org') {
				return { ...enterpriseAgent, prompt: 'Enterprise prompt' };
			}
			return undefined;
		};

		const provider = createProvider();
		await waitForPolling();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.equal(agents.length, 1);
		const agentName = agents[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(agentName, 'shared_agent');
	});

	test('deduplicates enterprise agents even when API returns them in different order', async () => {
		mockOctoKitService.setUserOrganizations(['orgA', 'orgB', 'orgC']);

		const enterpriseAgent1: CustomAgentListItem = {
			name: 'enterprise_agent1',
			repo_owner_id: 999,
			repo_owner: 'enterprise_org',
			repo_id: 123,
			repo_name: 'enterprise_repo',
			display_name: 'Enterprise Agent 1',
			description: 'First enterprise agent',
			tools: [],
			version: 'v1.0',
		};

		const enterpriseAgent2: CustomAgentListItem = {
			name: 'enterprise_agent2',
			repo_owner_id: 999,
			repo_owner: 'enterprise_org',
			repo_id: 123,
			repo_name: 'enterprise_repo',
			display_name: 'Enterprise Agent 2',
			description: 'Second enterprise agent',
			tools: [],
			version: 'v1.0',
		};

		let callCount = 0;
		mockOctoKitService.getCustomAgents = async (owner: string, repo: string) => {
			callCount++;
			if (callCount === 1) {
				return [enterpriseAgent1, enterpriseAgent2];
			} else if (callCount === 2) {
				return [enterpriseAgent2, enterpriseAgent1];
			} else {
				return [enterpriseAgent1, enterpriseAgent2];
			}
		};

		mockOctoKitService.getCustomAgentDetails = async (owner: string, repo: string, agentName: string, version?: string) => {
			if (agentName === 'enterprise_agent1') {
				return { ...enterpriseAgent1, prompt: 'Prompt 1' };
			} else if (agentName === 'enterprise_agent2') {
				return { ...enterpriseAgent2, prompt: 'Prompt 2' };
			}
			return undefined;
		};

		const provider = createProvider();
		await waitForPolling();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.equal(agents.length, 2);

		const agentNames = agents.map(a => a.uri.path.split('/').pop()?.replace('.agent.md', '')).sort();
		assert.deepEqual(agentNames, ['enterprise_agent1', 'enterprise_agent2']);
	});

	test('deduplication key does not include version so different versions are deduplicated', async () => {
		mockOctoKitService.setUserOrganizations(['orgA']);

		const agentV1: CustomAgentListItem = {
			name: 'multi_version_agent',
			repo_owner_id: 999,
			repo_owner: 'enterprise_org',
			repo_id: 123,
			repo_name: 'enterprise_repo',
			display_name: 'Multi Version Agent',
			description: 'Agent with multiple versions',
			tools: [],
			version: 'v1.0',
		};

		const agentV2: CustomAgentListItem = {
			...agentV1,
			version: 'v2.0',
		};

		mockOctoKitService.getCustomAgents = async () => {
			return [agentV1, agentV2];
		};

		mockOctoKitService.getCustomAgentDetails = async (owner: string, repo: string, agentName: string, version?: string) => {
			if (version === 'v1.0') {
				return { ...agentV1, prompt: 'Prompt for v1' };
			} else if (version === 'v2.0') {
				return { ...agentV2, prompt: 'Prompt for v2' };
			}
			return undefined;
		};

		const provider = createProvider();
		await waitForPolling();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.equal(agents.length, 1);
		const multiVersionAgentName = agents[0].uri.path.split('/').pop()?.replace('.agent.md', '');
		assert.equal(multiVersionAgentName, 'multi_version_agent');
	});
});

suite('looksLikeNumber', () => {

	test('returns false for empty string', () => {
		assert.strictEqual(looksLikeNumber(''), false);
	});

	test('returns true for integers', () => {
		assert.strictEqual(looksLikeNumber('0'), true);
		assert.strictEqual(looksLikeNumber('123'), true);
		assert.strictEqual(looksLikeNumber('-456'), true);
	});

	test('returns true for decimals', () => {
		assert.strictEqual(looksLikeNumber('3.14'), true);
		assert.strictEqual(looksLikeNumber('-0.5'), true);
		assert.strictEqual(looksLikeNumber('.5'), true);
	});

	test('returns false for non-numeric strings', () => {
		assert.strictEqual(looksLikeNumber('abc'), false);
		assert.strictEqual(looksLikeNumber('12abc'), false);
		assert.strictEqual(looksLikeNumber('hello'), false);
	});

	test('returns false for special number representations', () => {
		assert.strictEqual(looksLikeNumber('1e10'), false);
		assert.strictEqual(looksLikeNumber('1.5e-3'), false);
		assert.strictEqual(looksLikeNumber('Infinity'), false);
		assert.strictEqual(looksLikeNumber('-Infinity'), false);
		assert.strictEqual(looksLikeNumber('NaN'), false);
	});

	test('returns false for hex/octal representations', () => {
		assert.strictEqual(looksLikeNumber('0x1F'), false);
		assert.strictEqual(looksLikeNumber('0o17'), false);
		assert.strictEqual(looksLikeNumber('0b101'), false);
	});

	test('returns false for strings with spaces', () => {
		assert.strictEqual(looksLikeNumber(' 123'), false);
		assert.strictEqual(looksLikeNumber('123 '), false);
	});
});

suite('yamlString', () => {

	test('returns plain string for simple text', () => {
		const result = yamlString('hello');
		assert.strictEqual(result, 'hello');
	});

	test('returns plain string for text with spaces', () => {
		const result = yamlString('hello world');
		assert.strictEqual(result, 'hello world');
	});

	suite('quoting for special characters', () => {

		test('quotes strings containing hash (comment)', () => {
			const result = yamlString('value with # hash');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'value with # hash');
			assert.strictEqual(result.type, Scalar.QUOTE_SINGLE);
		});

		test('quotes strings containing colon', () => {
			const result = yamlString('key: value');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'key: value');
		});

		test('quotes strings containing brackets', () => {
			const result = yamlString('array [1, 2]');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'array [1, 2]');
		});

		test('quotes strings containing braces', () => {
			const result = yamlString('object {a: 1}');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'object {a: 1}');
		});

		test('quotes strings containing comma', () => {
			const result = yamlString('a, b, c');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'a, b, c');
		});

		test('quotes strings containing newline', () => {
			const result = yamlString('line1\nline2');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'line1\nline2');
			assert.strictEqual(result.type, Scalar.QUOTE_DOUBLE);
		});

		test('quotes strings containing carriage return', () => {
			const result = yamlString('line1\rline2');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'line1\rline2');
			assert.strictEqual(result.type, Scalar.QUOTE_DOUBLE);
		});
	});

	suite('quoting for values starting with quotes', () => {

		test('quotes strings starting with single quote', () => {
			const result = yamlString(`'quoted value`);
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, `'quoted value`);
		});

		test('quotes strings starting with double quote', () => {
			const result = yamlString(`"quoted value`);
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, `"quoted value`);
		});
	});

	suite('quoting for whitespace', () => {

		test('quotes strings with leading space', () => {
			const result = yamlString(' leading space');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, ' leading space');
		});

		test('quotes strings with trailing space', () => {
			const result = yamlString('trailing space ');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'trailing space ');
		});
	});

	suite('quoting for YAML keywords', () => {

		test('quotes "true" to preserve as string', () => {
			const result = yamlString('true');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'true');
		});

		test('quotes "false" to preserve as string', () => {
			const result = yamlString('false');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'false');
		});

		test('quotes "null" to preserve as string', () => {
			const result = yamlString('null');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, 'null');
		});

		test('quotes "~" to preserve as string', () => {
			const result = yamlString('~');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, '~');
		});

		test('does not quote "True" (case sensitive)', () => {
			const result = yamlString('True');
			assert.strictEqual(result, 'True');
		});

		test('does not quote "FALSE" (case sensitive)', () => {
			const result = yamlString('FALSE');
			assert.strictEqual(result, 'FALSE');
		});
	});

	suite('quoting for numeric strings', () => {

		test('quotes integer strings', () => {
			const result = yamlString('123');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, '123');
		});

		test('quotes negative integers', () => {
			const result = yamlString('-456');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, '-456');
		});

		test('quotes decimal strings', () => {
			const result = yamlString('3.14');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.value, '3.14');
		});

		test('does not quote non-numeric strings that look similar', () => {
			const result = yamlString('v1.0');
			assert.strictEqual(result, 'v1.0');
		});
	});

	suite('quote type selection', () => {

		test('uses single quotes by default when quoting', () => {
			const result = yamlString('value with # hash');
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.type, Scalar.QUOTE_SINGLE);
		});

		test('does not quote string with only single quote (no special chars)', () => {
			const result = yamlString(`it's a value`);
			assert.strictEqual(result, `it's a value`);
		});

		test('uses double quotes when value has single quote and special chars', () => {
			const result = yamlString(`it's a value: with colon`);
			assert.ok(result instanceof Scalar);
			assert.strictEqual(result.type, Scalar.QUOTE_DOUBLE);
		});
	});
});

suite('yamlString round-trip with custom YAML parser', () => {

	function roundTrip(value: string): string | undefined {
		const yamlValue = yamlString(value);
		let yamlStr: string;

		if (yamlValue instanceof Scalar) {
			if (yamlValue.type === Scalar.QUOTE_SINGLE) {
				yamlStr = `'${value}'`;
			} else {
				yamlStr = `"${value.replace(/"/g, '\\"')}"`;
			}
		} else {
			yamlStr = value;
		}

		const yaml = `key: ${yamlStr}`;
		const parsed = parse(yaml);

		if (parsed?.type === 'map' && parsed.properties.length > 0) {
			const prop = parsed.properties[0];
			if (prop.value.type === 'scalar') {
				return prop.value.value;
			}
		}
		return undefined;
	}

	test('round-trips plain string', () => {
		assert.strictEqual(roundTrip('hello world'), 'hello world');
	});

	test('round-trips string with hash', () => {
		assert.strictEqual(roundTrip('value # comment'), 'value # comment');
	});

	test('round-trips string with colon', () => {
		assert.strictEqual(roundTrip('key: value'), 'key: value');
	});

	test('round-trips boolean keyword as string', () => {
		assert.strictEqual(roundTrip('true'), 'true');
		assert.strictEqual(roundTrip('false'), 'false');
	});

	test('round-trips null keyword as string', () => {
		assert.strictEqual(roundTrip('null'), 'null');
	});

	test('round-trips numeric string', () => {
		assert.strictEqual(roundTrip('123'), '123');
		assert.strictEqual(roundTrip('3.14'), '3.14');
	});

	test('round-trips string with leading/trailing whitespace', () => {
		assert.strictEqual(roundTrip('  padded  '), '  padded  ');
	});

	test('round-trips string with single quotes (no special chars)', () => {
		assert.strictEqual(roundTrip(`it's working`), `it's working`);
	});

	test('round-trips string with single quotes and special chars', () => {
		assert.strictEqual(roundTrip(`it's a value: with colon`), `it's a value: with colon`);
	});
});
