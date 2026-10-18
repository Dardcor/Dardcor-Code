/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../files/common/files.js';
import { CompletionItem, CompletionItemKind } from '../../../common/state/protocol/commands.js';
import { MessageAttachmentKind } from '../../../common/state/sessionState.js';
import { AgentHostSkillCompletionProvider } from '../../../node/agentHostSkillCompletionProvider.js';
import type { ISdkResolvedCustomizations } from '../../../node/claude/claudeSdkPipeline.js';
import { buildDiscoveredCustomizations } from '../../../node/claude/customizations/claudeSessionCustomizationDiscovery.js';
import { scanClaudeDiskCustomizations } from '../../../node/claude/customizations/scan/claudeAgentSkillScan.js';
import { MockAgent } from '../mockAgent.js';
import { claudeTestUserHome as userHome, claudeTestWorkspace as workspace, createInMemoryFileService, seedFile } from './claudeCustomizationTestUtils.js';

suite('Claude .claude/commands → slash completion (end-to-end)', () => {

	const disposables = new DisposableStore();
	let fileService: IFileService;
	const seed = (path: string, content = '') => seedFile(fileService, path, content);

	setup(() => {
		fileService = createInMemoryFileService(disposables);
	});

	teardown(() => {
		disposables.clear();
	});
	ensureNoDisposablesAreLeakedInTestSuite();

	const sdkWith = (...names: string[]): ISdkResolvedCustomizations =>
		({ agents: [], commands: names.map(name => ({ name, description: '', argumentHint: '' })), mcpServers: [], plugins: [] });

	async function slashCompletions(text: string, sdk: ISdkResolvedCustomizations | undefined): Promise<readonly CompletionItem[]> {
		const discovered = await scanClaudeDiskCustomizations(workspace, userHome, fileService);
		const customizations = buildDiscoveredCustomizations(discovered, [], [], [], workspace, userHome, sdk);

		const agent = disposables.add(new MockAgent('mock'));
		agent.getSessionCustomizations = async () => customizations;
		const provider = disposables.add(new AgentHostSkillCompletionProvider(() => agent));

		return provider.provideCompletionItems({ kind: CompletionItemKind.UserMessage, channel: 'mock:/session', text, offset: text.length }, CancellationToken.None);
	}

	const insertTexts = (items: readonly CompletionItem[]) => items.map(i => i.insertText.trim());

	test('a flat .claude/commands/*.md file becomes a /<name> completion (pre-session)', async () => {
		const commandUri = await seed('/workspace/.claude/commands/speckit.specify.md', '---\ndescription: Create a spec\n---\nBody');

		const items = await slashCompletions('/speckit', undefined);

		assert.deepStrictEqual(items, [{
			insertText: '/speckit.specify ',
			rangeStart: 0,
			rangeEnd: 8,
			attachment: {
				type: MessageAttachmentKind.Simple,
				label: '/speckit.specify',
				_meta: {
					uri: commandUri.toString(),
					name: 'speckit.specify',
					displayName: 'speckit.specify',
					description: 'Create a spec',
				},
			},
		}]);
	});

	test('the command survives the live SDK filter once a session materializes', async () => {
		await seed('/workspace/.claude/commands/speckit.specify.md', '---\ndescription: Create a spec\n---\nBody');

		assert.deepStrictEqual(insertTexts(await slashCompletions('/speckit', sdkWith('speckit.specify'))), ['/speckit.specify']);
	});

	test('a command the live SDK did not load is dropped post-materialize', async () => {
		await seed('/workspace/.claude/commands/speckit.specify.md', '---\ndescription: Create a spec\n---\nBody');

		assert.deepStrictEqual(insertTexts(await slashCompletions('/speckit', sdkWith())), []);
	});

	test('user-scope .claude/commands are surfaced too (pre-session)', async () => {
		await seed('/home/.claude/commands/global.md', 'body');

		assert.deepStrictEqual(insertTexts(await slashCompletions('/global', undefined)), ['/global']);
	});

	test('a skill wins over a same-named command (no duplicate completion)', async () => {
		await seed('/workspace/.claude/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: The skill\n---\nbody');
		await seed('/workspace/.claude/commands/deploy.md', '---\nname: deploy\ndescription: The command\n---\nbody');

		assert.deepStrictEqual(insertTexts(await slashCompletions('/deploy', sdkWith('deploy'))), ['/deploy']);
	});
});
