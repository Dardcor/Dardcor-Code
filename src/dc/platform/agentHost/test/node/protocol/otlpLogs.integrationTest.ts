/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { PROTOCOL_VERSION } from '../../../common/state/protocol/version/registry.js';
import { ROOT_STATE_URI } from '../../../common/state/sessionState.js';
import type { InitializeResult } from '../../../common/state/sessionProtocol.js';
import type { TelemetryCapabilities } from '../../../common/state/protocol/channels-otlp/state.js';
import type { OtlpExportLogsParams } from '../../../common/state/protocol/channels-otlp/notifications.js';
import { OTLP_LOGS_CHANNEL_TEMPLATE, iterateOtlpLogRecords } from '../../../common/otlp/otlpLogEmitter.js';
import { getAgentHostE2ETestTimeout, IServerHandle, startServer, stopServer, TestProtocolClient } from '../serverIntegrationTestHelpers.js';

suite('Protocol WebSocket — OTLP logs channel', function () {

	let server: IServerHandle;
	let client: TestProtocolClient;

	suiteSetup(async function () {
		this.timeout(getAgentHostE2ETestTimeout(15_000, 60_000));
		server = await startServer({ quiet: true });
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

	test('initialize advertises the logs channel template', async function () {
		this.timeout(getAgentHostE2ETestTimeout(5_000, 20_000));

		const result = await client.call<InitializeResult & { telemetry?: TelemetryCapabilities }>('initialize', {
			protocolVersions: [PROTOCOL_VERSION],
			clientId: 'test-otlp-handshake',
			initialSubscriptions: [ROOT_STATE_URI],
		});

		assert.deepStrictEqual(result.telemetry, { logs: OTLP_LOGS_CHANNEL_TEMPLATE });
	});

	test('subscribe on the logs channel returns a stateless empty result', async function () {
		this.timeout(getAgentHostE2ETestTimeout(5_000, 20_000));

		await client.call('initialize', {
			protocolVersions: [PROTOCOL_VERSION],
			clientId: 'test-otlp-subscribe',
			initialSubscriptions: [ROOT_STATE_URI],
		});

		const result = await client.call<{ snapshot?: unknown }>('subscribe', {
			channel: 'ahp-otlp://logs/trace',
		});
		assert.deepStrictEqual(result, {});
	});

	test('subscribed clients receive otlp/exportLogs notifications for server log output', async function () {
		this.timeout(10_000);

		await client.call('initialize', {
			protocolVersions: [PROTOCOL_VERSION],
			clientId: 'test-otlp-receive',
			initialSubscriptions: [ROOT_STATE_URI],
		});
		await client.call('subscribe', { channel: 'ahp-otlp://logs/trace' });

		const notificationPromise = client.waitForNotification(
			n => n.method === 'otlp/exportLogs' && (n.params as OtlpExportLogsParams).channel === 'ahp-otlp://logs/trace',
		);
		await client.call('createSession', { channel: 'copilot:///test', provider: 'nonexistent' }).catch(() => undefined);

		const exportNotification = await notificationPromise;
		const params = exportNotification.params as OtlpExportLogsParams;
		const records = [...iterateOtlpLogRecords(params.payload)];
		assert.ok(records.length > 0, 'expected at least one decoded log record');
		assert.ok(records[0].body.length > 0, 'expected the record body to carry a formatted log line');
	});
});
