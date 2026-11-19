/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Uri } from 'vscode';
import { afterEach, beforeEach, expect, suite, test } from 'vitest';
import { CancellationToken } from '../../../../util/dardcor/base/common/cancellation';
import { ResourceMap } from '../../../../util/dardcor/base/common/map';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { ConfigKey, IConfigurationService } from '../../../configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../configuration/test/common/inMemoryConfigurationService';
import { MockFileSystemService } from '../../../filesystem/node/test/mockFileSystemService';
import { IFileSystemService } from '../../../filesystem/common/fileSystemService';
import { ILogService, LogServiceImpl } from '../../../log/common/logService';
import { createPlatformServices, ITestingServicesAccessor } from '../../../test/node/services';
import { TestWorkspaceService } from '../../../test/node/testWorkspaceService';
import { IWorkspaceService } from '../../../workspace/common/workspaceService';
import { INativeEnvService } from '../../../env/common/envService';
import { AgentInstructionsLocator } from '../../dardcor-node/agentInstructionsLocator';
import { mockFiles } from './mockFiles';
import { PromptConfig } from '../../common/promptsService';

class TrustingWorkspaceService extends TestWorkspaceService {
	private readonly _trusted = new ResourceMap<boolean>();

	constructor(folders: URI[]) {
		super(folders, []);
	}

	setTrusted(uri: URI, trusted: boolean): void {
		this._trusted.set(uri, trusted);
	}

	override isResourceTrusted(resource: Uri): Thenable<boolean> {
		return Promise.resolve(this._trusted.get(resource) === true);
	}
}

suite('AgentInstructionsLocator', () => {
	let accessor: ITestingServicesAccessor;
	let configService: InMemoryConfigurationService;
	let fileSystem: MockFileSystemService;
	let workspaceService: TrustingWorkspaceService;
	let locator: AgentInstructionsLocator;

	const parentFolder = '/collect-agent-parent-test';
	const rootFolder = `${parentFolder}/repo`;
	const rootFolderUri = URI.file(rootFolder);
	const parentFolderUri = URI.file(parentFolder);

	beforeEach(async () => {
		const services = createPlatformServices();

		workspaceService = new TrustingWorkspaceService([rootFolderUri]);
		services.define(IWorkspaceService, workspaceService);

		fileSystem = new MockFileSystemService();
		services.define(IFileSystemService, fileSystem);

		configService = new InMemoryConfigurationService(new DefaultsOnlyConfigurationService());
		services.define(IConfigurationService, configService);

		await configService.setNonExtensionConfig(PromptConfig.USE_AGENT_MD, true);
		await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, false);

		accessor = services.createTestingAccessor();

		locator = new AgentInstructionsLocator(
			accessor.get(IFileSystemService),
			accessor.get(IWorkspaceService),
			accessor.get(INativeEnvService),
			accessor.get(IConfigurationService),
			accessor.get(ILogService) ?? new LogServiceImpl([]),
		);
	});

	afterEach(() => {
		accessor?.dispose();
	});

	test('should collect parent folder dardcor-instructions.md and AGENTS.md when includeWorkspaceFolderParents is enabled', async () => {
		await mockFiles(fileSystem, [
			{ path: `${parentFolder}/.git/HEAD`, contents: ['ref: refs/heads/main'] },
			{ path: `${parentFolder}/AGENTS.md`, contents: ['Parent agent guidelines'] },
			{ path: `${parentFolder}/.github/dardcor-instructions.md`, contents: ['Parent dardcor instructions'] },
			{ path: `${rootFolder}/src/file.ts`, contents: ['console.log("test");'] },
		]);

		workspaceService.setTrusted(parentFolderUri, true);

		await configService.setNonExtensionConfig(PromptConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS, false);
		await configService.setConfig(ConfigKey.UseInstructionFiles, true);

		let result = await locator.listAgentInstructions(CancellationToken.None);
		let paths = result.map(f => f.uri.path);

		expect(paths).not.toContain(`${parentFolder}/.github/dardcor-instructions.md`);
		expect(paths).not.toContain(`${parentFolder}/AGENTS.md`);

		await configService.setNonExtensionConfig(PromptConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS, true);
		await configService.setConfig(ConfigKey.UseInstructionFiles, true);

		result = await locator.listAgentInstructions(CancellationToken.None);
		paths = result.map(f => f.uri.path);

		expect(paths).toContain(`${parentFolder}/.github/dardcor-instructions.md`);
		expect(paths).toContain(`${parentFolder}/AGENTS.md`);
	});

	test('dardcor-instructions and AGENTS.md', async () => {
		await mockFiles(fileSystem, [
			{ path: `${rootFolder}/codestyle.md`, contents: ['Can you see this?'] },
			{ path: `${rootFolder}/AGENTS.md`, contents: ['What about this?'] },
			{ path: `${rootFolder}/README.md`, contents: ['Thats my project?'] },
			{
				path: `${rootFolder}/.github/dardcor-instructions.md`,
				contents: ['Be nice and friendly. Also look at instructions at #file:../codestyle.md and [more-codestyle.md](./more-codestyle.md).'],
			},
			{ path: `${rootFolder}/.github/more-codestyle.md`, contents: ['I like it clean.'] },
			{ path: `${rootFolder}/folder1/AGENTS.md`, contents: ['An AGENTS.md file in another repo'] },
		]);

		await configService.setNonExtensionConfig(PromptConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS, true);

		const result = await locator.listAgentInstructions(CancellationToken.None);
		const paths = result.map(f => f.uri.path).sort();

		expect(paths).toEqual([
			`${rootFolder}/.github/dardcor-instructions.md`,
			`${rootFolder}/AGENTS.md`,
		].sort());
	});

	test('should collect CLAUDE.md when enabled', async () => {
		await mockFiles(fileSystem, [
			{ path: `${rootFolder}/CLAUDE.md`, contents: ['Claude guidelines'] },
			{ path: `${rootFolder}/src/file.ts`, contents: ['console.log("test");'] },
		]);

		await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, true);
		let result = await locator.listAgentInstructions(CancellationToken.None);
		let paths = result.map(f => f.uri.path);
		expect(paths).toContain(`${rootFolder}/CLAUDE.md`);

		await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, false);
		result = await locator.listAgentInstructions(CancellationToken.None);
		paths = result.map(f => f.uri.path);
		expect(paths).not.toContain(`${rootFolder}/CLAUDE.md`);
	});

	test('should collect .claude/CLAUDE.md when enabled', async () => {
		await mockFiles(fileSystem, [
			{ path: `${rootFolder}/.claude/CLAUDE.md`, contents: ['Claude guidelines'] },
			{ path: `${rootFolder}/src/file.ts`, contents: ['console.log("test");'] },
		]);

		await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, true);
		let result = await locator.listAgentInstructions(CancellationToken.None);
		let paths = result.map(f => f.uri.path);
		expect(paths).toContain(`${rootFolder}/.claude/CLAUDE.md`);

		await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, false);
		result = await locator.listAgentInstructions(CancellationToken.None);
		paths = result.map(f => f.uri.path);
		expect(paths).not.toContain(`${rootFolder}/.claude/CLAUDE.md`);
	});

	test('should collect ~/.claude/CLAUDE.md when enabled', async () => {
		const userHome = '/home/testuser';
		await mockFiles(fileSystem, [
			{ path: `${userHome}/.claude/CLAUDE.md`, contents: ['Claude guidelines from home'] },
			{ path: `${rootFolder}/src/file.ts`, contents: ['console.log("test");'] },
		]);

		await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, true);
		let result = await locator.listAgentInstructions(CancellationToken.None);
		let paths = result.map(f => f.uri.path);
		expect(paths).toContain(`${userHome}/.claude/CLAUDE.md`);

		await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, false);
		result = await locator.listAgentInstructions(CancellationToken.None);
		paths = result.map(f => f.uri.path);
		expect(paths).not.toContain(`${userHome}/.claude/CLAUDE.md`);
	});

	test('should collect ~/.dardcor/dardcor-instructions.md when enabled', async () => {
		const userHome = '/home/testuser';
		await mockFiles(fileSystem, [
			{ path: `${userHome}/.dardcor/dardcor-instructions.md`, contents: ['Copilot guidelines from home'] },
			{ path: `${rootFolder}/src/file.ts`, contents: ['console.log("test");'] },
		]);

		await configService.setConfig(ConfigKey.UseInstructionFiles, true);
		let result = await locator.listAgentInstructions(CancellationToken.None);
		let paths = result.map(f => f.uri.path);
		expect(paths).toContain(`${userHome}/.dardcor/dardcor-instructions.md`);

		await configService.setConfig(ConfigKey.UseInstructionFiles, false);
		result = await locator.listAgentInstructions(CancellationToken.None);
		paths = result.map(f => f.uri.path);
		expect(paths).not.toContain(`${userHome}/.dardcor/dardcor-instructions.md`);
	});

	test('should collect parent folder CLAUDE configurations when includeWorkspaceFolderParents is enabled', async () => {
		await mockFiles(fileSystem, [
			{ path: `${parentFolder}/.git/HEAD`, contents: ['ref: refs/heads/main'] },
			{ path: `${parentFolder}/CLAUDE.md`, contents: ['Parent Claude guidelines'] },
			{ path: `${parentFolder}/.claude/CLAUDE.md`, contents: ['Parent .claude Claude guidelines'] },
			{ path: `${rootFolder}/src/file.ts`, contents: ['console.log("test");'] },
		]);

		workspaceService.setTrusted(parentFolderUri, true);
		await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, true);

		await configService.setNonExtensionConfig(PromptConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS, false);
		let result = await locator.listAgentInstructions(CancellationToken.None);
		let paths = result.map(f => f.uri.path);
		expect(paths).not.toContain(`${parentFolder}/CLAUDE.md`);
		expect(paths).not.toContain(`${parentFolder}/.claude/CLAUDE.md`);

		await configService.setNonExtensionConfig(PromptConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS, true);
		result = await locator.listAgentInstructions(CancellationToken.None);
		paths = result.map(f => f.uri.path);
		expect(paths).toContain(`${parentFolder}/CLAUDE.md`);
		expect(paths).toContain(`${parentFolder}/.claude/CLAUDE.md`);
	});

	suite('multi-root workspace', () => {
		const rootFolder1 = '/multi-root-1';
		const rootFolder2 = '/multi-root-2';
		const rootFolder1Uri = URI.file(rootFolder1);
		const rootFolder2Uri = URI.file(rootFolder2);

		function createMultiRootLocator(): AgentInstructionsLocator {
			const multiRootWorkspaceService = new TrustingWorkspaceService([rootFolder1Uri, rootFolder2Uri]);
			return new AgentInstructionsLocator(
				accessor.get(IFileSystemService),
				multiRootWorkspaceService,
				accessor.get(INativeEnvService),
				accessor.get(IConfigurationService),
				accessor.get(ILogService) ?? new LogServiceImpl([]),
			);
		}

		test('should collect CLAUDE.md from multi-root workspace', async () => {
			await mockFiles(fileSystem, [
				{ path: `${rootFolder1}/CLAUDE.md`, contents: ['Claude guidelines from root 1'] },
				{ path: `${rootFolder2}/CLAUDE.md`, contents: ['Claude guidelines from root 2'] },
			]);

			await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, true);
			const multiRootLocator = createMultiRootLocator();
			const result = await multiRootLocator.listAgentInstructions(CancellationToken.None);
			const paths = result.map(f => f.uri.path);

			expect(paths).toContain(`${rootFolder1}/CLAUDE.md`);
			expect(paths).toContain(`${rootFolder2}/CLAUDE.md`);
		});

		test('should collect .claude/CLAUDE.md from multi-root workspace', async () => {
			await mockFiles(fileSystem, [
				{ path: `${rootFolder1}/.claude/CLAUDE.md`, contents: ['Root 1 .claude'] },
				{ path: `${rootFolder2}/.claude/CLAUDE.md`, contents: ['Root 2 .claude'] },
			]);

			await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, true);
			const multiRootLocator = createMultiRootLocator();
			const result = await multiRootLocator.listAgentInstructions(CancellationToken.None);
			const paths = result.map(f => f.uri.path);

			expect(paths).toContain(`${rootFolder1}/.claude/CLAUDE.md`);
			expect(paths).toContain(`${rootFolder2}/.claude/CLAUDE.md`);
		});

		test('should collect both root CLAUDE.md and .claude/CLAUDE.md from multi-root workspace', async () => {
			await mockFiles(fileSystem, [
				{ path: `${rootFolder1}/CLAUDE.md`, contents: ['Root 1'] },
				{ path: `${rootFolder1}/.claude/CLAUDE.md`, contents: ['Root 1 .claude'] },
				{ path: `${rootFolder2}/CLAUDE.md`, contents: ['Root 2'] },
				{ path: `${rootFolder2}/.claude/CLAUDE.md`, contents: ['Root 2 .claude'] },
			]);

			await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, true);
			const multiRootLocator = createMultiRootLocator();
			const result = await multiRootLocator.listAgentInstructions(CancellationToken.None);
			const paths = result.map(f => f.uri.path);

			expect(paths).toContain(`${rootFolder1}/CLAUDE.md`);
			expect(paths).toContain(`${rootFolder1}/.claude/CLAUDE.md`);
			expect(paths).toContain(`${rootFolder2}/CLAUDE.md`);
			expect(paths).toContain(`${rootFolder2}/.claude/CLAUDE.md`);
		});

		test('should not collect CLAUDE.md from multi-root workspace when disabled', async () => {
			await mockFiles(fileSystem, [
				{ path: `${rootFolder1}/CLAUDE.md`, contents: ['Root 1'] },
				{ path: `${rootFolder2}/CLAUDE.md`, contents: ['Root 2'] },
			]);

			await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, false);
			const multiRootLocator = createMultiRootLocator();
			const result = await multiRootLocator.listAgentInstructions(CancellationToken.None);
			const paths = result.map(f => f.uri.path);

			expect(paths).not.toContain(`${rootFolder1}/CLAUDE.md`);
			expect(paths).not.toContain(`${rootFolder2}/CLAUDE.md`);
		});

		test('should collect both CLAUDE.md and CLAUDE.local.md from multi-root workspace', async () => {
			await mockFiles(fileSystem, [
				{ path: `${rootFolder1}/CLAUDE.md`, contents: ['Root 1'] },
				{ path: `${rootFolder1}/CLAUDE.local.md`, contents: ['Root 1 local'] },
				{ path: `${rootFolder2}/CLAUDE.md`, contents: ['Root 2'] },
				{ path: `${rootFolder2}/CLAUDE.local.md`, contents: ['Root 2 local'] },
			]);

			await configService.setNonExtensionConfig(PromptConfig.USE_CLAUDE_MD, true);
			const multiRootLocator = createMultiRootLocator();
			const result = await multiRootLocator.listAgentInstructions(CancellationToken.None);
			const paths = result.map(f => f.uri.path);

			expect(paths).toContain(`${rootFolder1}/CLAUDE.md`);
			expect(paths).toContain(`${rootFolder1}/CLAUDE.local.md`);
			expect(paths).toContain(`${rootFolder2}/CLAUDE.md`);
			expect(paths).toContain(`${rootFolder2}/CLAUDE.local.md`);
		});

		test('should collect AGENTS.md and dardcor-instructions.md from multi-root workspace', async () => {
			await mockFiles(fileSystem, [
				{ path: `${rootFolder1}/AGENTS.md`, contents: ['Root 1 agents'] },
				{ path: `${rootFolder1}/.github/dardcor-instructions.md`, contents: ['Root 1 dardcor'] },
				{ path: `${rootFolder2}/AGENTS.md`, contents: ['Root 2 agents'] },
				{ path: `${rootFolder2}/.github/dardcor-instructions.md`, contents: ['Root 2 dardcor'] },
			]);

			await configService.setConfig(ConfigKey.UseInstructionFiles, true);
			const multiRootLocator = createMultiRootLocator();
			const result = await multiRootLocator.listAgentInstructions(CancellationToken.None);
			const paths = result.map(f => f.uri.path);

			expect(paths).toContain(`${rootFolder1}/AGENTS.md`);
			expect(paths).toContain(`${rootFolder1}/.github/dardcor-instructions.md`);
			expect(paths).toContain(`${rootFolder2}/AGENTS.md`);
			expect(paths).toContain(`${rootFolder2}/.github/dardcor-instructions.md`);
		});
	});
});
