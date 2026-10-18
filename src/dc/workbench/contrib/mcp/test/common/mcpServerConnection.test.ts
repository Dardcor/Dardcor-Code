/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { autorun, observableValue } from '../../../../../base/common/observable.js';
import { upcast } from '../../../../../base/common/types.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogger, ILoggerService, LogLevel, NullLogger } from '../../../../../platform/log/common/log.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IOutputService } from '../../../../services/output/common/output.js';
import { TestLoggerService, TestProductService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { IMcpHostDelegate, IMcpMessageTransport } from '../../common/mcpRegistryTypes.js';
import { McpServerConnection } from '../../common/mcpServerConnection.js';
import { McpCollectionDefinition, McpConnectionState, McpServerDefinition, McpServerLaunch, McpServerTransportType, McpServerTrust } from '../../common/mcpTypes.js';
import { TestMcpMessageTransport } from './mcpRegistryTypes.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { Event } from '../../../../../base/common/event.js';
import { McpTaskManager } from '../../common/mcpTaskManager.js';

class TestMcpHostDelegate extends Disposable implements IMcpHostDelegate {
	private readonly _transport: TestMcpMessageTransport;
	private _canStartValue = true;

	priority = 0;

	constructor() {
		super();
		this._transport = this._register(new TestMcpMessageTransport());
	}

	substituteVariables(serverDefinition: McpServerDefinition, launch: McpServerLaunch): Promise<McpServerLaunch> {
		return Promise.resolve(launch);
	}

	canStart(): boolean {
		return this._canStartValue;
	}

	start(): IMcpMessageTransport {
		if (!this._canStartValue) {
			throw new Error('Cannot start server');
		}
		return this._transport;
	}

	getTransport(): TestMcpMessageTransport {
		return this._transport;
	}

	setCanStart(value: boolean): void {
		this._canStartValue = value;
	}

	waitForInitialProviderPromises(): Promise<void> {
		return Promise.resolve();
	}
}

suite('Workbench - MCP - ServerConnection', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let delegate: TestMcpHostDelegate;
	let transport: TestMcpMessageTransport;
	let collection: McpCollectionDefinition;
	let serverDefinition: McpServerDefinition;

	setup(() => {
		delegate = store.add(new TestMcpHostDelegate());
		transport = delegate.getTransport();

		const services = new ServiceCollection(
			[ILoggerService, store.add(new TestLoggerService())],
			[IOutputService, upcast({ showChannel: () => { } })],
			[IStorageService, store.add(new TestStorageService())],
			[IProductService, TestProductService],
		);

		instantiationService = store.add(new TestInstantiationService(services));

		collection = {
			id: 'test-collection',
			label: 'Test Collection',
			remoteAuthority: null,
			serverDefinitions: observableValue('serverDefs', []),
			trustBehavior: McpServerTrust.Kind.Trusted,
			scope: StorageScope.APPLICATION,
			configTarget: ConfigurationTarget.USER,
			order: 0,
		};

		serverDefinition = {
			id: 'test-server',
			label: 'Test Server',
			cacheNonce: 'a',
			launch: {
				type: McpServerTransportType.Stdio,
				command: 'test-command',
				args: [],
				env: {},
				envFile: undefined,
				cwd: '/test',
				sandbox: undefined
			}
		};
	});

	function waitForHandler(cnx: McpServerConnection) {
		const handler = cnx.handler.get();
		if (handler) {
			return Promise.resolve(handler);
		}

		return new Promise(resolve => {
			const disposable = autorun(reader => {
				const handler = cnx.handler.read(reader);
				if (handler) {
					disposable.dispose();
					resolve(handler);
				}
			});
		});
	}

	test('should start and set state to Running when transport succeeds', async () => {
		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			serverDefinition,
			delegate,
			serverDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const startPromise = connection.start({});

		transport.setConnectionState({ state: McpConnectionState.Kind.Running });

		const state = await startPromise;
		assert.strictEqual(state.state, McpConnectionState.Kind.Running);

		transport.simulateInitialized();
		assert.ok(await waitForHandler(connection));
	});

	test('should handle errors during start', async () => {
		delegate.setCanStart(false);

		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			serverDefinition,
			delegate,
			serverDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const state = await connection.start({});

		assert.strictEqual(state.state, McpConnectionState.Kind.Error);
		assert.ok(state.message);
	});

	test('should handle transport errors', async () => {
		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			serverDefinition,
			delegate,
			serverDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const startPromise = connection.start({});

		transport.setConnectionState({
			state: McpConnectionState.Kind.Error,
			message: 'Test error message'
		});

		const state = await startPromise;
		assert.strictEqual(state.state, McpConnectionState.Kind.Error);
		assert.strictEqual(state.message, 'Test error message');
	});

	test('should stop and set state to Stopped', async () => {
		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			serverDefinition,
			delegate,
			serverDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const startPromise = connection.start({});
		transport.setConnectionState({ state: McpConnectionState.Kind.Running });
		await startPromise;

		const stopPromise = connection.stop();
		await stopPromise;

		assert.strictEqual(connection.state.get().state, McpConnectionState.Kind.Stopped);
	});

	test('should not restart if already starting', async () => {
		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			serverDefinition,
			delegate,
			serverDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const startPromise1 = connection.start({});

		const startPromise2 = connection.start({});

		transport.setConnectionState({ state: McpConnectionState.Kind.Running });

		const state1 = await startPromise1;
		const state2 = await startPromise2;

		assert.strictEqual(state1.state, McpConnectionState.Kind.Running);
		assert.strictEqual(state2.state, McpConnectionState.Kind.Running);

		transport.simulateInitialized();
		assert.ok(await waitForHandler(connection));

		connection.dispose();
	});

	test('should clean up when disposed', async () => {
		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			serverDefinition,
			delegate,
			serverDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);

		const startPromise = connection.start({});
		transport.setConnectionState({ state: McpConnectionState.Kind.Running });
		await startPromise;

		connection.dispose();

		assert.strictEqual(connection.state.get().state, McpConnectionState.Kind.Stopped);
	});

	test('should log transport messages', async () => {
		const loggedMessages: string[] = [];

		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			serverDefinition,
			delegate,
			serverDefinition.launch,
			{
				onDidChangeLogLevel: Event.None,
				getLevel: () => LogLevel.Debug,
				info: (message: string) => {
					loggedMessages.push(message);
				},
				error: () => { },
				dispose: () => { }
			} as Partial<ILogger> as ILogger,
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const startPromise = connection.start({});

		transport.simulateLog('Test log message');

		transport.setConnectionState({ state: McpConnectionState.Kind.Running });
		await startPromise;

		assert.ok(loggedMessages.some(msg => msg === 'Test log message'));

		connection.dispose();
		await timeout(10);
	});

	test('should emit a sandbox filesystem block for read-only errors with backtick paths', async () => {
		const sandboxedDefinition: McpServerDefinition = {
			...serverDefinition,
			sandboxEnabled: true,
		};

		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			sandboxedDefinition,
			delegate,
			sandboxedDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const message = 'error: failed to open file `/test-for-sandbox/.git`: Read-only file system (os error 30)';
		const sandboxBlock = Event.toPromise(connection.onPotentialSandboxBlock);
		const startPromise = connection.start({});

		transport.simulateLog(message);
		transport.setConnectionState({ state: McpConnectionState.Kind.Running });

		assert.deepStrictEqual(await sandboxBlock, {
			kind: 'filesystem',
			message,
			path: '/test-for-sandbox/.git',
		});

		await startPromise;

		connection.dispose();
		await timeout(10);
	});

	test('should emit a sandbox filesystem block for read-only errors with double-quoted paths', async () => {
		const sandboxedDefinition: McpServerDefinition = {
			...serverDefinition,
			sandboxEnabled: true,
		};

		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			sandboxedDefinition,
			delegate,
			sandboxedDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const message = 'error: failed to open file `/test-for-sandbox/.testfile`: Read-only file system (os error 30)';
		const sandboxBlock = Event.toPromise(connection.onPotentialSandboxBlock);
		const startPromise = connection.start({});

		transport.simulateLog(message);
		transport.setConnectionState({ state: McpConnectionState.Kind.Running });

		assert.deepStrictEqual(await sandboxBlock, {
			kind: 'filesystem',
			message,
			path: '/test-for-sandbox/.testfile',
		});

		await startPromise;

		connection.dispose();
		await timeout(10);
	});

	test('should emit a sandbox filesystem block for read-only at-path errors with double-quoted paths', async () => {
		const sandboxedDefinition: McpServerDefinition = {
			...serverDefinition,
			sandboxEnabled: true,
		};

		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			sandboxedDefinition,
			delegate,
			sandboxedDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const message = 'error: Read-only file system (os error 30) at path "/test-for-sandbox/.testfile"';
		const sandboxBlock = Event.toPromise(connection.onPotentialSandboxBlock);
		const startPromise = connection.start({});

		transport.simulateLog(message);
		transport.setConnectionState({ state: McpConnectionState.Kind.Running });

		assert.deepStrictEqual(await sandboxBlock, {
			kind: 'filesystem',
			message,
			path: '/test-for-sandbox/.testfile',
		});

		await startPromise;

		connection.dispose();
		await timeout(10);
	});

	test('should emit a sandbox network block with the denied host', async () => {
		const sandboxedDefinition: McpServerDefinition = {
			...serverDefinition,
			sandboxEnabled: true,
		};

		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			sandboxedDefinition,
			delegate,
			sandboxedDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const sandboxBlock = Event.toPromise(connection.onPotentialSandboxBlock);
		const startPromise = connection.start({});

		transport.simulateLog('No matching config rule, denying: api.example.com:443.');
		transport.setConnectionState({ state: McpConnectionState.Kind.Running });

		assert.deepStrictEqual(await sandboxBlock, {
			kind: 'network',
			message: 'No matching config rule, denying: api.example.com:443.',
			host: 'api.example.com',
		});

		await startPromise;

		connection.dispose();
		await timeout(10);
	});

	test('should correctly handle transitions to and from error state', async () => {
		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			serverDefinition,
			delegate,
			serverDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		const startPromise = connection.start({});

		const errorState: McpConnectionState = {
			state: McpConnectionState.Kind.Error,
			message: 'Temporary error'
		};
		transport.setConnectionState(errorState);

		let state = await startPromise;
		assert.equal(state, errorState);


		transport.setConnectionState({ state: McpConnectionState.Kind.Stopped });

		const startPromise2 = connection.start({});
		transport.setConnectionState({ state: McpConnectionState.Kind.Running });
		state = await startPromise2;
		assert.deepStrictEqual(state, { state: McpConnectionState.Kind.Running });

		connection.dispose();
		await timeout(10);
	});

	test('should handle multiple start/stop cycles', async () => {
		const connection = instantiationService.createInstance(
			McpServerConnection,
			collection,
			serverDefinition,
			delegate,
			serverDefinition.launch,
			new NullLogger(),
			false,
			store.add(new McpTaskManager()),
		);
		store.add(connection);

		let startPromise = connection.start({});
		transport.setConnectionState({ state: McpConnectionState.Kind.Running });
		await startPromise;

		await connection.stop();
		assert.deepStrictEqual(connection.state.get(), { state: McpConnectionState.Kind.Stopped });

		startPromise = connection.start({});
		transport.setConnectionState({ state: McpConnectionState.Kind.Running });
		await startPromise;

		assert.deepStrictEqual(connection.state.get(), { state: McpConnectionState.Kind.Running });

		await connection.stop();

		assert.deepStrictEqual(connection.state.get(), { state: McpConnectionState.Kind.Stopped });

		connection.dispose();
		await timeout(10);
	});
});
