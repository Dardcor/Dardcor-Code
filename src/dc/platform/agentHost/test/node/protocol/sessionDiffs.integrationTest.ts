/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as cp from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../../base/common/path.js';
import { URI } from '../../../../../base/common/uri.js';
import { SubscribeResult } from '../../../common/state/protocol/commands.js';
import type { ChangesetContentChangedAction, SessionAddedParams } from '../../../common/state/sessionActions.js';
import { PROTOCOL_VERSION } from '../../../common/state/protocol/version/registry.js';
import {
	dispatchTurnStarted,
	getAgentHostE2ETestTimeout,
	getActionEnvelope,
	IServerHandle,
	isActionNotification,
	nextSessionUri,
	startServer,
	stopServer,
	TestProtocolClient,
} from '../serverIntegrationTestHelpers.js';

const hasGit = (() => {
	try { cp.execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

(hasGit ? suite : suite.skip)('Protocol WebSocket — Git-driven session changeset', function () {

	let server: IServerHandle;
	let client: TestProtocolClient;
	let tmpRoot: string;

	suiteSetup(async function () {
		this.timeout(getAgentHostE2ETestTimeout(15_000, 60_000));
		server = await startServer();
	});

	suiteTeardown(async function () {
		this.timeout(getAgentHostE2ETestTimeout(20_000, 50_000));
		await stopServer(server);
	});

	setup(async function () {
		this.timeout(getAgentHostE2ETestTimeout(10_000, 30_000));
		tmpRoot = mkdtempSync(join(tmpdir(), 'agent-host-proto-diff-'));
		const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
		const run = (...args: string[]) => cp.execFileSync('git', args, { cwd: tmpRoot, env, stdio: 'pipe' });
		run('init', '-q', '-b', 'main');
		writeFileSync(join(tmpRoot, 'seed.txt'), 'seed\n');
		run('add', '.');
		run('commit', '-q', '-m', 'init');

		client = new TestProtocolClient(server.port);
		await client.connect();
	});

	teardown(function () {
		client.close();
		if (tmpRoot) {
			try {
				rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
			} catch {
			}
		}
	});

	test('terminal-driven file edit (no ToolResultFileEditContent) lands in the session changeset', async function () {
		this.timeout(getAgentHostE2ETestTimeout(15_000, 90_000));

		await client.call('initialize', { protocolVersions: [PROTOCOL_VERSION], clientId: 'test-git-diffs' });

		const workingDirectory = URI.file(tmpRoot).toString();
		await client.call('createSession', { channel: nextSessionUri(), provider: 'mock', workingDirectories: [workingDirectory] });

		const addedNotif = await client.waitForNotification(n =>
			n.method === 'root/sessionAdded'
		);
		const sessionUri = (addedNotif.params as SessionAddedParams).summary.resource;

		await client.call<SubscribeResult>('subscribe', { channel: sessionUri });
		const branchChangesetUri = `${sessionUri}/changeset/branch`;
		await client.call<SubscribeResult>('subscribe', { channel: branchChangesetUri });
		client.clearReceived();

		const editedFile = join(tmpRoot, 'from-terminal.txt');
		dispatchTurnStarted(client, sessionUri, 'turn-1', `terminal-edit:${editedFile}`, 1);

		const fileUri = (edit: ChangesetContentChangedAction['files'][number]['edit']) =>
			edit.after?.uri ?? edit.before?.uri;
		const matchesEditedFile = (action: ChangesetContentChangedAction) =>
			action.files.some(f => {
				const u = fileUri(f.edit);
				return typeof u === 'string' && u.endsWith('/from-terminal.txt');
			});
		const contentChangedNotif = await client.waitForNotification(n => {
			if (!isActionNotification(n, 'changeset/contentChanged')) {
				return false;
			}
			return matchesEditedFile(getActionEnvelope(n).action as ChangesetContentChangedAction);
		}, getAgentHostE2ETestTimeout(10_000, 30_000));
		const action = getActionEnvelope(contentChangedNotif).action as ChangesetContentChangedAction;
		const file = action.files.find(f => {
			const u = fileUri(f.edit);
			return typeof u === 'string' && u.endsWith('/from-terminal.txt');
		});
		assert.ok(file, 'expected the edited file in the changeset content');
		assert.ok(file.edit.after, 'expected after-side for newly added file');
		assert.ok(!file.edit.before, 'newly added file should have no before-side');
	});
});
