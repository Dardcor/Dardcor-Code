/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import assert from 'assert';
import { ToolCallContributorKind, ToolResultContentType, type ToolCallContributor } from '../../../common/state/sessionState.js';
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

suite('Protocol WebSocket — Client Tools', function () {

	let server: IServerHandle;
	let client: TestProtocolClient;

	suiteSetup(async function () {
		this.timeout(getAgentHostE2ETestTimeout(15_000, 60_000));
		server = await startServer();
	});

	suiteTeardown(async function () {
		this.timeout(getAgentHostE2ETestTimeout(20_000, 50_000));
		await stopServer(server);
	});

	setup(async function () {
		this.timeout(10_000);
		client = new TestProtocolClient(server.port);
		await client.connect();
	});

	teardown(function () {
		client.close();
	});


	test('client tool_start emits toolCallStart then toolCallReady (auto-confirmed)', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-client-tool');
		dispatchTurnStarted(client, sessionUri, 'turn-ct', 'client-tool', 1);

		const [toolStartNotif, toolReadyNotif] = await Promise.all([
			client.waitForNotification(n => isActionNotification(n, 'chat/toolCallStart')),
			client.waitForNotification(n => isActionNotification(n, 'chat/toolCallReady')),
		]);
		const toolStartAction = getActionEnvelope(toolStartNotif).action as {
			toolCallId: string;
			contributor?: ToolCallContributor;
		};
		assert.strictEqual(toolStartAction.toolCallId, 'tc-client-1');
		assert.deepStrictEqual(toolStartAction.contributor, { kind: ToolCallContributorKind.Client, clientId: 'test-client-tool' });

		const toolReadyAction = getActionEnvelope(toolReadyNotif).action as {
			toolCallId: string;
			confirmed?: string;
		};
		assert.strictEqual(toolReadyAction.toolCallId, 'tc-client-1');
		assert.strictEqual(toolReadyAction.confirmed, 'not-needed');

		client.notify('dispatchAction', {
			clientSeq: 2,
			channel: defaultChatChannel(sessionUri),
			action: {
				type: 'chat/toolCallComplete',
				turnId: 'turn-ct',
				toolCallId: 'tc-client-1',
				result: {
					success: true,
					pastTenseMessage: 'Ran tests',
					content: [{ type: ToolResultContentType.Text, text: 'all passed' }],
				},
			},
		});

		await client.waitForNotification(
			n => isActionNotification(n, 'chat/turnComplete'),
		);
	});


	test('client tool with permission fires toolCallReady with confirmationTitle', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-client-perm');
		dispatchTurnStarted(client, sessionUri, 'turn-cp', 'client-tool-with-permission', 1);

		const toolStartNotif = await client.waitForNotification(
			n => isActionNotification(n, 'chat/toolCallStart'),
		);
		const toolStartAction = getActionEnvelope(toolStartNotif).action as {
			toolCallId: string;
			contributor?: ToolCallContributor;
		};
		assert.strictEqual(toolStartAction.toolCallId, 'tc-client-perm-1');
		assert.deepStrictEqual(toolStartAction.contributor, { kind: ToolCallContributorKind.Client, clientId: 'test-client-tool' });

		const toolReadyNotif = await client.waitForNotification(
			n => isActionNotification(n, 'chat/toolCallReady'),
		);
		const toolReadyAction = getActionEnvelope(toolReadyNotif).action as {
			toolCallId: string;
			confirmationTitle?: string;
			confirmed?: string;
		};
		assert.strictEqual(toolReadyAction.toolCallId, 'tc-client-perm-1');
		assert.strictEqual(toolReadyAction.confirmationTitle, 'Allow Run Tests?');
		assert.strictEqual(toolReadyAction.confirmed, undefined);

		client.notify('dispatchAction', {
			clientSeq: 2,
			channel: defaultChatChannel(sessionUri),
			action: {
				type: 'chat/toolCallConfirmed',
				turnId: 'turn-cp',
				toolCallId: 'tc-client-perm-1',
				approved: true,
			},
		});

		await client.waitForNotification(
			n => isActionNotification(n, 'chat/turnComplete'),
		);
	});


	test('tool_ready without confirmationTitle auto-confirms with NotNeeded', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-ready-auto');
		dispatchTurnStarted(client, sessionUri, 'turn-ra', 'client-tool', 1);

		await client.waitForNotification(
			n => isActionNotification(n, 'chat/toolCallStart'),
		);

		client.notify('dispatchAction', {
			clientSeq: 2,
			channel: defaultChatChannel(sessionUri),
			action: {
				type: 'chat/toolCallComplete',
				turnId: 'turn-ra',
				toolCallId: 'tc-client-1',
				result: {
					success: true,
					pastTenseMessage: 'Done',
					content: [{ type: ToolResultContentType.Text, text: 'ok' }],
				},
			},
		});

		await client.waitForNotification(
			n => isActionNotification(n, 'chat/turnComplete'),
		);
	});
});
