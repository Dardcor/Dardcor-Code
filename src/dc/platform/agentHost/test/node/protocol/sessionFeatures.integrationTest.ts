/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { SubscribeResult } from '../../../common/state/protocol/commands.js';
import { ActionType, type IResponsePartAction, type ITurnStartedAction, type ITitleChangedAction } from '../../../common/state/sessionActions.js';
import type { ListSessionsResult } from '../../../common/state/sessionProtocol.js';
import { MessageKind, PendingMessageKind, ResponsePartKind, ROOT_STATE_URI, type ISessionWithDefaultChat } from '../../../common/state/sessionState.js';
import { MOCK_AUTO_TITLE } from '../mockAgent.js';
import {
	createAndSubscribeSession,
	defaultChatChannel,
	dispatchTurnStarted,
	fetchSessionWithChat,
	getAgentHostE2ETestTimeout,
	getActionEnvelope,
	isActionNotification,
	IServerHandle,
	startServer,
	stopServer,
	TestProtocolClient,
} from '../serverIntegrationTestHelpers.js';

suite('Protocol WebSocket — Session Features', function () {

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


	test('client titleChanged updates session state snapshot', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-titleChanged');

		client.notify('dispatchAction', {
			channel: sessionUri,
			clientSeq: 1,
			action: {
				type: 'session/titleChanged',
				title: 'My Custom Title',
			},
		});

		const titleNotif = await client.waitForNotification(n => isActionNotification(n, 'session/titleChanged'));
		const titleAction = getActionEnvelope(titleNotif).action as ITitleChangedAction;
		assert.strictEqual(titleAction.title, 'My Custom Title');

		const snapshot = await client.call<SubscribeResult>('subscribe', { channel: sessionUri });
		const state = snapshot.snapshot!.state as ISessionWithDefaultChat;
		assert.strictEqual(state.title, 'My Custom Title');
	});

	test('agent-generated titleChanged is broadcast', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-agent-title');
		dispatchTurnStarted(client, sessionUri, 'turn-title', 'with-title', 1);

		const titleNotif = await client.waitForNotification(n => {
			if (!isActionNotification(n, 'session/titleChanged')) {
				return false;
			}
			const action = getActionEnvelope(n).action as ITitleChangedAction;
			return action.title === MOCK_AUTO_TITLE;
		});
		const titleAction = getActionEnvelope(titleNotif).action as ITitleChangedAction;
		assert.strictEqual(titleAction.title, MOCK_AUTO_TITLE);

		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));

		const snapshot = await client.call<SubscribeResult>('subscribe', { channel: sessionUri });
		const state = snapshot.snapshot!.state as ISessionWithDefaultChat;
		assert.strictEqual(state.title, MOCK_AUTO_TITLE);
	});

	test('first turn immediately sets title to user message', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-immediate-title');

		const before = await client.call<SubscribeResult>('subscribe', { channel: sessionUri });
		assert.strictEqual((before.snapshot!.state as ISessionWithDefaultChat).title, '');

		dispatchTurnStarted(client, sessionUri, 'turn-immediate', 'Fix the login bug', 1);

		const titleNotif = await client.waitForNotification(n => isActionNotification(n, 'session/titleChanged'));
		const titleAction = getActionEnvelope(titleNotif).action as ITitleChangedAction;
		assert.strictEqual(titleAction.title, 'Fix the login bug');

		const result = await client.call<ListSessionsResult>('listSessions', { channel: ROOT_STATE_URI });
		const session = result.items.find(s => s.resource === sessionUri);
		assert.ok(session, 'session should appear in listSessions');
		assert.strictEqual(session.title, 'Fix the login bug');
	});

	test('renamed session title persists across listSessions', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-title-list');

		client.notify('dispatchAction', {
			channel: sessionUri,
			clientSeq: 1,
			action: {
				type: 'session/titleChanged',
				title: 'Persisted Title',
			},
		});

		await client.waitForNotification(n => {
			if (!isActionNotification(n, 'session/titleChanged')) {
				return false;
			}
			const action = getActionEnvelope(n).action as ITitleChangedAction;
			return action.title === 'Persisted Title';
		});

		let session: { title: string } | undefined;
		for (let i = 0; i < 20; i++) {
			const result = await client.call<ListSessionsResult>('listSessions', { channel: ROOT_STATE_URI });
			session = result.items.find(s => s.resource === sessionUri);
			if (session?.title === 'Persisted Title') {
				break;
			}
			await timeout(100);
		}
		assert.ok(session, 'session should appear in listSessions');
		assert.strictEqual(session.title, 'Persisted Title');
	});


	test('message model flows through turn dispatch and subscribe', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-message-model');
		client.dispatch({
			channel: defaultChatChannel(sessionUri),
			clientSeq: 1,
			action: {
				type: ActionType.ChatTurnStarted,
				turnId: 'turn-model',
				startedAt: new Date().toISOString(),
				message: { text: 'hello', origin: { kind: MessageKind.User }, model: { id: 'mock-model' } },
			},
		});

		const turnStartedNotif = await client.waitForNotification(n => isActionNotification(n, 'chat/turnStarted'));
		const turnStartedAction = getActionEnvelope(turnStartedNotif).action as ITurnStartedAction;
		assert.deepStrictEqual(turnStartedAction.message.model, { id: 'mock-model' });

		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));

		const state = await fetchSessionWithChat(client, sessionUri);
		assert.deepStrictEqual(state.turns.at(-1)?.message.model, { id: 'mock-model' });
	});


	test('reasoning events produce reasoning response parts and append actions', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-reasoning');
		dispatchTurnStarted(client, sessionUri, 'turn-reasoning', 'with-reasoning', 1);

		const reasoningPart = await client.waitForNotification(n => {
			if (!isActionNotification(n, 'chat/responsePart')) {
				return false;
			}
			const action = getActionEnvelope(n).action as IResponsePartAction;
			return action.part.kind === ResponsePartKind.Reasoning;
		});
		const reasoningAction = getActionEnvelope(reasoningPart).action as IResponsePartAction;
		assert.strictEqual(reasoningAction.part.kind, ResponsePartKind.Reasoning);

		const appendNotif = await client.waitForNotification(n => isActionNotification(n, 'chat/reasoning'));
		const appendAction = getActionEnvelope(appendNotif).action;
		assert.strictEqual(appendAction.type, 'chat/reasoning');
		if (appendAction.type === 'chat/reasoning') {
			assert.strictEqual(appendAction.content, ' about this...');
		}

		const mdPart = await client.waitForNotification(n => {
			if (!isActionNotification(n, 'chat/responsePart')) {
				return false;
			}
			const action = getActionEnvelope(n).action as IResponsePartAction;
			return action.part.kind === ResponsePartKind.Markdown;
		});
		assert.ok(mdPart);

		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));
	});


	test('queued message is auto-consumed when session is idle', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-queue-idle');
		client.clearReceived();

		client.notify('dispatchAction', {
			channel: defaultChatChannel(sessionUri),
			clientSeq: 1,
			action: {
				type: 'chat/pendingMessageSet',
				kind: PendingMessageKind.Queued,
				id: 'q-1',
				message: { text: 'hello', origin: { kind: MessageKind.User } },
			},
		});

		await client.waitForNotification(n => isActionNotification(n, 'chat/turnStarted'));
		await client.waitForNotification(n => isActionNotification(n, 'chat/responsePart'));
		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));

		const state = await fetchSessionWithChat(client, sessionUri);
		assert.ok(state.turns.length >= 1);
		assert.strictEqual(state.turns[state.turns.length - 1].message.text, 'hello');
		assert.ok(!state.queuedMessages?.length, 'queued messages should be empty after consumption');
	});

	test('queued message waits for in-progress turn to complete', async function () {
		this.timeout(15_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-queue-wait');

		dispatchTurnStarted(client, sessionUri, 'turn-first', 'hello', 1);

		await client.waitForNotification(n => isActionNotification(n, 'chat/responsePart'));

		client.notify('dispatchAction', {
			channel: defaultChatChannel(sessionUri),
			clientSeq: 2,
			action: {
				type: 'chat/pendingMessageSet',
				kind: PendingMessageKind.Queued,
				id: 'q-wait-1',
				message: { text: 'hello', origin: { kind: MessageKind.User } },
			},
		});

		const firstComplete = await client.waitForNotification(n => {
			if (!isActionNotification(n, 'chat/turnComplete')) {
				return false;
			}
			return (getActionEnvelope(n).action as { turnId: string }).turnId === 'turn-first';
		});
		const firstSeq = getActionEnvelope(firstComplete).serverSeq;

		const secondComplete = await client.waitForNotification(n => {
			if (!isActionNotification(n, 'chat/turnComplete')) {
				return false;
			}
			const envelope = getActionEnvelope(n);
			return (envelope.action as { turnId: string }).turnId !== 'turn-first'
				&& envelope.serverSeq > firstSeq;
		});
		assert.ok(secondComplete, 'should receive a second turnComplete from the queued message');

		const state = await fetchSessionWithChat(client, sessionUri);
		assert.ok(state.turns.length >= 2, `expected >= 2 turns but got ${state.turns.length}`);
	});


	test('steering message is set and consumed by agent', async function () {
		this.timeout(10_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-steering');

		dispatchTurnStarted(client, sessionUri, 'turn-steer', 'hello', 1);

		client.notify('dispatchAction', {
			channel: defaultChatChannel(sessionUri),
			clientSeq: 2,
			action: {
				type: 'chat/pendingMessageSet',
				kind: PendingMessageKind.Steering,
				id: 'steer-1',
				message: { text: 'Please be concise', origin: { kind: MessageKind.User } },
			},
		});

		const setNotif = await client.waitForNotification(n => isActionNotification(n, 'chat/pendingMessageSet'));
		assert.ok(setNotif, 'should see pendingMessageSet action');

		const removedNotif = await client.waitForNotification(n => isActionNotification(n, 'chat/pendingMessageRemoved'));
		assert.ok(removedNotif, 'should see pendingMessageRemoved after agent consumes steering');

		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));

		const state = await fetchSessionWithChat(client, sessionUri);
		assert.ok(!state.steeringMessage, 'steering message should be cleared after consumption');
	});


	test('truncate session removes turns after specified turn', async function () {
		this.timeout(15_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-truncate');

		dispatchTurnStarted(client, sessionUri, 'turn-t1', 'hello', 1);
		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete') && (getActionEnvelope(n).action as { turnId: string }).turnId === 'turn-t1');

		client.clearReceived();
		dispatchTurnStarted(client, sessionUri, 'turn-t2', 'hello', 2);
		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete') && (getActionEnvelope(n).action as { turnId: string }).turnId === 'turn-t2');

		let state = await fetchSessionWithChat(client, sessionUri);
		assert.strictEqual(state.turns.length, 2);

		client.clearReceived();

		client.notify('dispatchAction', {
			channel: defaultChatChannel(sessionUri),
			clientSeq: 3,
			action: { type: 'chat/truncated', turnId: 'turn-t1' },
		});

		await client.waitForNotification(n => isActionNotification(n, 'chat/truncated'));

		state = await fetchSessionWithChat(client, sessionUri);
		assert.strictEqual(state.turns.length, 1);
		assert.strictEqual(state.turns[0].id, 'turn-t1');
	});

	test('truncate all turns clears session history', async function () {
		this.timeout(15_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-truncate-all');

		dispatchTurnStarted(client, sessionUri, 'turn-ta1', 'hello', 1);
		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));

		client.clearReceived();

		client.notify('dispatchAction', {
			channel: defaultChatChannel(sessionUri),
			clientSeq: 2,
			action: { type: 'chat/truncated' },
		});

		await client.waitForNotification(n => isActionNotification(n, 'chat/truncated'));

		const state = await fetchSessionWithChat(client, sessionUri);
		assert.strictEqual(state.turns.length, 0);
	});

	test('new turn after truncation works correctly', async function () {
		this.timeout(15_000);

		const sessionUri = await createAndSubscribeSession(client, 'test-truncate-resume');

		dispatchTurnStarted(client, sessionUri, 'turn-tr1', 'hello', 1);
		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete') && (getActionEnvelope(n).action as { turnId: string }).turnId === 'turn-tr1');

		client.clearReceived();
		dispatchTurnStarted(client, sessionUri, 'turn-tr2', 'hello', 2);
		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete') && (getActionEnvelope(n).action as { turnId: string }).turnId === 'turn-tr2');

		client.clearReceived();

		client.notify('dispatchAction', {
			channel: defaultChatChannel(sessionUri),
			clientSeq: 3,
			action: { type: 'chat/truncated', turnId: 'turn-tr1' },
		});

		await client.waitForNotification(n => isActionNotification(n, 'chat/truncated'));

		dispatchTurnStarted(client, sessionUri, 'turn-tr3', 'hello', 4);
		await client.waitForNotification(n => isActionNotification(n, 'chat/turnComplete'));

		const state = await fetchSessionWithChat(client, sessionUri);
		assert.strictEqual(state.turns.length, 2);
		assert.strictEqual(state.turns[0].id, 'turn-tr1');
		assert.strictEqual(state.turns[1].id, 'turn-tr3');
	});

});
