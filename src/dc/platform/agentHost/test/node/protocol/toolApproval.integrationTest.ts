/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../../base/common/path.js';
import { URI } from '../../../../../base/common/uri.js';
import type { IResponsePartAction } from '../../../common/state/sessionActions.js';
import { ResponsePartKind, type MarkdownResponsePart } from '../../../common/state/sessionState.js';
import {
	createAndSubscribeSession,
	defaultChatChannel,
	dispatchTurnStarted,
	getAgentHostE2ETestTimeout,
	getActionEnvelope,
	IServerHandle,
	isActionNotification,
	startServer,
	stopServer,
	TestProtocolClient,
} from '../serverIntegrationTestHelpers.js';

suite('Protocol WebSocket — Permissions & Auto-Approve', function () {

	let server: IServerHandle;
	let client: TestProtocolClient;
	let workspace: string;

	suiteSetup(async function () {
		this.timeout(getAgentHostE2ETestTimeout(15_000, 60_000));
		workspace = mkdtempSync(join(tmpdir(), 'agent-host-tool-approval-'));
		server = await startServer({ env: { VSCODE_AGENT_HOST_MOCK_WORKSPACE: workspace } });
	});

	suiteTeardown(async function () {
		this.timeout(getAgentHostE2ETestTimeout(20_000, 50_000));
		await stopServer(server);
		rmSync(workspace, { recursive: true, force: true });
	});

	setup(async function () {
		this.timeout(10_000);
		client = new TestProtocolClient(server.port);
		await client.connect();
	});

	teardown(function () {
		client.close();
	});


	test('permission request → resolve → response', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-permission');
		dispatchTurnStarted(client, sessionUri, 'turn-perm', 'permission', 1);

		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallStart'));
		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallReady'));

		client.notify('dispatchAction', {
			clientSeq: 2,
			channel: defaultChatChannel(sessionUri),
			action: {
				type: 'chat/toolCallConfirmed',
				turnId: 'turn-perm',
				toolCallId: 'tc-perm-1',
				approved: true,
			},
		});

		const responsePart = await client.waitForNotification(n => isActionNotification(n, 'chat/responsePart'));
		const responsePartAction = getActionEnvelope(responsePart).action as IResponsePartAction;
		assert.strictEqual(responsePartAction.part.kind, ResponsePartKind.Markdown);
		assert.strictEqual((responsePartAction.part as MarkdownResponsePart).content, 'Allowed.');

		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));
	});


	test('auto-approves write to regular file (no pending confirmation)', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-autoapprove', URI.file(workspace).toString());
		client.clearReceived();

		dispatchTurnStarted(client, sessionUri, 'turn-autoapprove', 'write-file', 1);

		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallStart'));
		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallComplete'));
		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));

		const pendingConfirmNotifs = client.receivedNotifications(n => {
			if (!isActionNotification(n, 'chat/toolCallReady')) {
				return false;
			}
			const action = getActionEnvelope(n).action as { confirmed?: string };
			return !action.confirmed;
		});
		assert.strictEqual(pendingConfirmNotifs.length, 0, 'should not have received pending-confirmation toolCallReady for auto-approved write');
	});

	test('blocks write to .env file (requires manual confirmation)', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-autoapprove-deny', URI.file(workspace).toString());
		client.clearReceived();

		dispatchTurnStarted(client, sessionUri, 'turn-deny', 'write-env', 1);

		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallStart'));
		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallReady'));

		client.notify('dispatchAction', {
			clientSeq: 2,
			channel: defaultChatChannel(sessionUri),
			action: {
				type: 'chat/toolCallConfirmed',
				turnId: 'turn-deny',
				toolCallId: 'tc-write-env-1',
				approved: true,
				confirmed: 'user-action',
			},
		});

		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));
	});


	test('auto-approves allowed shell command (no pending confirmation)', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-shell-approve');
		client.clearReceived();

		dispatchTurnStarted(client, sessionUri, 'turn-shell-approve', 'run-safe-command', 1);

		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallStart'));
		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallComplete'));
		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));

		const pendingConfirmNotifs = client.receivedNotifications(n => {
			if (!isActionNotification(n, 'chat/toolCallReady')) {
				return false;
			}
			const action = getActionEnvelope(n).action as { confirmed?: string };
			return !action.confirmed;
		});
		assert.strictEqual(pendingConfirmNotifs.length, 0, 'should not have received pending-confirmation toolCallReady for allowed shell command');
	});

	test('blocks denied shell command (requires manual confirmation)', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-shell-deny');
		client.clearReceived();

		dispatchTurnStarted(client, sessionUri, 'turn-shell-deny', 'run-dangerous-command', 1);

		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallStart'));
		await client.waitForNotification(n => isActionNotification(n, 'chat/toolCallReady'));

		client.notify('dispatchAction', {
			clientSeq: 2,
			channel: defaultChatChannel(sessionUri),
			action: {
				type: 'chat/toolCallConfirmed',
				turnId: 'turn-shell-deny',
				toolCallId: 'tc-shell-deny-1',
				approved: true,
				confirmed: 'user-action',
			},
		});

		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));
	});


	test('dispatches pending_confirmation that arrives without an active turn (does not hang)', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-orphan-confirmation', URI.file(workspace).toString());
		client.clearReceived();

		dispatchTurnStarted(client, sessionUri, 'turn-orphan', 'orphan-confirmation', 1);

		const readyNotif = await client.waitForNotification(n =>
			isActionNotification(n, 'chat/toolCallReady') &&
			(getActionEnvelope(n).action as { toolCallId?: string }).toolCallId === 'tc-orphan',
			8_000);
		assert.strictEqual((getActionEnvelope(readyNotif).action as { toolCallId: string }).toolCallId, 'tc-orphan');

		await client.waitForNotification(n =>
			isActionNotification(n, 'chat/responsePart') &&
			((getActionEnvelope(n).action as { part?: { content?: string } }).part?.content === 'continued-after-hook'),
			8_000);
	});
});
