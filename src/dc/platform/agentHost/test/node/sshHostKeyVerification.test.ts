/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { ConnectConfig } from 'ssh2';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { NullLogService } from '../../../log/common/log.js';
import { IProductService } from '../../../product/common/productService.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { isSSHHostKeyDeniedError, SSHAuthMethod, type ISSHAgentHostConfig, type ISSHHostKeyVerificationRequest } from '../../common/sshRemoteAgentHost.js';
import { SSHRemoteAgentHostMainService, type SSHAuthAttempt } from '../../node/sshRemoteAgentHostService.js';
import { computeHostKeyFingerprint, parseKnownHosts, type IKnownHostsEntry } from '../../node/sshKnownHosts.js';

function makeKeyBlob(keyType: string, material: Buffer): Buffer {
	const type = Buffer.from(keyType, 'ascii');
	const header = Buffer.alloc(4);
	header.writeUInt32BE(type.length, 0);
	const body = Buffer.alloc(4);
	body.writeUInt32BE(material.length, 0);
	return Buffer.concat([header, type, body, material]);
}

const HOST_KEY = makeKeyBlob('ssh-ed25519', Buffer.alloc(32, 0xaa));

class HostKeyMockSSHClient {
	ended = false;
	verdict: boolean | undefined;
	verdictCount = 0;
	readyTimeout: number | undefined;
	deferVerification = false;

	readonly verifierEntered: Promise<void>;
	private _verifierEntered!: () => void;

	private readonly _errorListeners: Array<(err: Error) => void> = [];
	private readonly _readyListeners: Array<() => void> = [];
	private readonly _hostKeysListeners: Array<(keys: readonly { getPublicSSH(): Buffer; type: string }[]) => void> = [];

	constructor() {
		this.verifierEntered = new Promise<void>(resolve => { this._verifierEntered = resolve; });
	}

	on(event: string, listener: (...args: never[]) => void): this {
		if (event === 'error') {
			this._errorListeners.push(listener as (err: Error) => void);
		} else if (event === 'ready') {
			this._readyListeners.push(listener as () => void);
		} else if (event === 'hostkeys') {
			this._hostKeysListeners.push(listener as (keys: readonly { getPublicSSH(): Buffer; type: string }[]) => void);
		}
		return this;
	}

	removeListener(_event: string, _listener: (...args: never[]) => void): this {
		return this;
	}

	authHandler: ((methodsLeft: string[] | null, partialSuccess: boolean, cb: (next: unknown) => void) => void) | undefined;

	connect(config: ConnectConfig): void {
		this.readyTimeout = config.readyTimeout;
		this.authHandler = config.authHandler as unknown as typeof this.authHandler;
		const hostVerifier = config.hostVerifier as ((key: Buffer, verify: (permitted: boolean) => void) => void) | undefined;
		assert.ok(hostVerifier, 'hostVerifier must be installed — without it ssh2 accepts any host key');
		this._verifierEntered();
		hostVerifier(HOST_KEY, permitted => {
			this.verdictCount++;
			this.verdict = permitted;
			if (this.deferVerification) {
				return;
			}
			if (permitted) {
				this._readyListeners.forEach(l => l());
			} else {
				this.fireError(new Error('Host denied (verification failed)'));
			}
		});
	}

	announceHostKeys(keys: readonly { getPublicSSH(): Buffer; type: string }[]): void {
		this._hostKeysListeners.forEach(l => l(keys));
	}

	fireError(err: Error): void {
		this._errorListeners.forEach(l => l(err));
	}

	end(): void {
		this.ended = true;
	}
}

class HostKeyTestService extends SSHRemoteAgentHostMainService {
	readonly client = new HostKeyMockSSHClient();
	knownHostsContents = '';
	knownHostsError: Error | undefined;
	knownHostsGate: Promise<void> | undefined;

	protected override async _createSSHClient() {
		return this.client as never;
	}

	authAttempts: SSHAuthAttempt[] = [];

	protected override async _buildAuthAttempts(_config: ISSHAgentHostConfig): Promise<SSHAuthAttempt[]> {
		return this.authAttempts;
	}

	protected override async _readKnownHostsEntries(_host: string): Promise<{ entries: IKnownHostsEntry[]; strictHostKeyChecking: undefined }> {
		if (this.knownHostsGate) {
			await this.knownHostsGate;
		}
		if (this.knownHostsError) {
			throw this.knownHostsError;
		}
		return { entries: parseKnownHosts(this.knownHostsContents), strictHostKeyChecking: undefined };
	}

	get pendingHostKeyRequestCount(): number {
		return this['_pendingHostKeyRequests'].size;
	}

	readonly deadlineHistory: number[] = [];
	currentDeadlineMs: number | undefined;

	protected override _armHandshakeDeadline(ms: number, onExpired: () => void): ReturnType<typeof setTimeout> {
		this.deadlineHistory.push(ms);
		this.currentDeadlineMs = ms;
		return super._armHandshakeDeadline(ms, onExpired);
	}

	protected override _clearHandshakeDeadline(timer: ReturnType<typeof setTimeout> | undefined): void {
		this.currentDeadlineMs = undefined;
		super._clearHandshakeDeadline(timer);
	}

	connectSSHForTest(config: ISSHAgentHostConfig) {
		return this._connectSSH(config, 'ssh:test-host');
	}
}

function makeConfig(overrides?: Partial<ISSHAgentHostConfig>): ISSHAgentHostConfig {
	return {
		host: 'test.example.com',
		username: 'testuser',
		authMethod: SSHAuthMethod.Agent,
		name: 'Test Host',
		sshConfigHost: 'test-host',
		...overrides,
	};
}

suite('SSHRemoteAgentHostMainService - host key verification', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(): HostKeyTestService {
		const productService: Pick<IProductService, '_serviceBrand' | 'quality' | 'dataFolderName'> = {
			_serviceBrand: undefined,
			quality: 'stable',
			dataFolderName: '.vscode-oss',
		};
		return disposables.add(new HostKeyTestService(new NullLogService(), productService as IProductService, NullTelemetryService));
	}

	async function connectAnswering(service: HostKeyTestService, trusted: boolean, config = makeConfig()) {
		const requests: ISSHHostKeyVerificationRequest[] = [];
		const store = new DisposableStore();
		store.add(service.onDidRequestHostKeyVerification(request => {
			requests.push(request);
			void service.respondHostKeyVerification(request.requestId, trusted);
		}));
		try {
			let error: unknown;
			const result = await service.connectSSHForTest(config).then(() => 'resolved', err => {
				error = err;
				return `rejected: ${err.message}`;
			});
			return { requests, result, error };
		} finally {
			store.dispose();
		}
	}

	test('installs hostVerifier and reports the key to the renderer', async () => {
		const service = createService();
		const { requests, result } = await connectAnswering(service, true);

		assert.deepStrictEqual(
			{
				requestCount: requests.length,
				keyType: requests[0]?.keyType,
				fingerprint: requests[0]?.fingerprint,
				host: requests[0]?.host,
				port: requests[0]?.port,
				knownHostsMatch: requests[0]?.knownHostsMatch,
				userInitiated: requests[0]?.userInitiated,
				verdict: service.client.verdict,
				result,
			},
			{
				requestCount: 1,
				keyType: 'ssh-ed25519',
				fingerprint: computeHostKeyFingerprint(HOST_KEY),
				host: 'test.example.com',
				port: 22,
				knownHostsMatch: 'unknown',
				userInitiated: true,
				verdict: true,
				result: 'resolved',
			});
	});

	test('declining fails the connection with a clean host key error', async () => {
		const service = createService();
		const { result, error } = await connectAnswering(service, false);

		assert.deepStrictEqual(
			{
				verdict: service.client.verdict,
				result,
				denied: isSSHHostKeyDeniedError(error),
			},
			{
				verdict: false,
				result: 'rejected: Host key verification failed for test-host',
				denied: true,
			});
	});

	test('reports the known_hosts verdict for a matching entry', async () => {
		const service = createService();
		service.knownHostsContents = `test.example.com ssh-ed25519 ${HOST_KEY.toString('base64')}`;
		const { requests } = await connectAnswering(service, true);
		assert.strictEqual(requests[0]?.knownHostsMatch, 'match');
	});

	test('reports a mismatch when known_hosts holds a different key', async () => {
		const service = createService();
		const other = makeKeyBlob('ssh-ed25519', Buffer.alloc(32, 0xbb));
		service.knownHostsContents = `test.example.com ssh-ed25519 ${other.toString('base64')}`;
		const { requests } = await connectAnswering(service, false);
		assert.strictEqual(requests[0]?.knownHostsMatch, 'mismatch');
	});

	test('forwards userInitiated so background reconnects can be declined', async () => {
		const service = createService();
		const { requests } = await connectAnswering(service, false, makeConfig({ userInitiated: false }));
		assert.strictEqual(requests[0]?.userInitiated, false);
	});

	test('bounds the handshake, and only widens it while a prompt is outstanding', async () => {
		const service = createService();
		const observed: number[] = [];
		const store = new DisposableStore();
		store.add(service.onDidRequestHostKeyVerification(request => {
			observed.push(service.currentDeadlineMs!);
			void service.respondHostKeyVerification(request.requestId, true);
		}));
		await service.connectSSHForTest(makeConfig());
		store.dispose();

		assert.deepStrictEqual(
			{
				ssh2TimerDisabled: service.client.readyTimeout,
				armedBeforeConnect: service.deadlineHistory[0],
				whilePrompting: observed[0],
				afterSettle: service.currentDeadlineMs,
			},
			{ ssh2TimerDisabled: 0, armedBeforeConnect: 30_000, whilePrompting: 300_000, afterSettle: undefined });
	});

	test('widens the deadline for the password prompt too, not just the host key dialog', async () => {
		const service = createService();
		service.authAttempts = [{ type: 'keyboard-interactive', username: 'test' }];
		service.client.deferVerification = true;

		const store = new DisposableStore();
		store.add(service.onDidRequestHostKeyVerification(request => {
			void service.respondHostKeyVerification(request.requestId, true);
		}));

		let whilePrompting: number | undefined;
		const prompted = new Promise<void>(resolve => {
			store.add(service.onDidRequestKeyboardInteractive(request => {
				whilePrompting = service.currentDeadlineMs;
				void service.respondKeyboardInteractive(request.requestId, ['hunter2']);
				resolve();
			}));
		});

		const connectPromise = service.connectSSHForTest(makeConfig());
		await service.client.verifierEntered;
		service.client.authHandler?.(['keyboard-interactive'], false, next => {
			const method = next as { prompt: (name: string, instructions: string, lang: string, prompts: readonly { prompt: string; echo?: boolean }[], finish: (responses: string[]) => void) => void };
			method.prompt('', '', '', [{ prompt: 'Password:', echo: false }], () => { });
		});
		await prompted;
		const afterAnswering = service.currentDeadlineMs;

		service.client.fireError(new Error('Connection lost'));
		await connectPromise.catch(() => undefined);
		store.dispose();

		assert.deepStrictEqual(
			{ whilePrompting, afterAnswering },
			{ whilePrompting: 300_000, afterAnswering: 30_000 });
	});

	test('a connection that dies during evidence gathering leaves nothing pending', async () => {
		const service = createService();
		let openGate = () => { };
		service.knownHostsGate = new Promise<void>(resolve => { openGate = resolve; });

		const requests: ISSHHostKeyVerificationRequest[] = [];
		const store = new DisposableStore();
		store.add(service.onDidRequestHostKeyVerification(request => requests.push(request)));

		const connectPromise = service.connectSSHForTest(makeConfig());
		await service.client.verifierEntered;
		service.client.fireError(new Error('Connection lost'));
		const result = await connectPromise.then(() => 'resolved', err => `rejected: ${err.message}`);

		openGate();
		await new Promise(resolve => setTimeout(resolve, 10));
		store.dispose();

		assert.deepStrictEqual(
			{
				result,
				requestCount: requests.length,
				pending: service.pendingHostKeyRequestCount,
				verdict: service.client.verdict,
			},
			{ result: 'rejected: Connection lost', requestCount: 0, pending: 0, verdict: false });
	});

	test('fails closed when gathering evidence throws', async () => {
		const service = createService();
		service.knownHostsError = new Error('boom');
		const requests: ISSHHostKeyVerificationRequest[] = [];
		const store = new DisposableStore();
		store.add(service.onDidRequestHostKeyVerification(request => requests.push(request)));
		const result = await service.connectSSHForTest(makeConfig()).then(() => 'resolved', err => `rejected: ${err.message}`);
		store.dispose();

		assert.deepStrictEqual(
			{ requestCount: requests.length, verdict: service.client.verdict, result },
			{ requestCount: 0, verdict: false, result: 'rejected: Host denied (verification failed)' });
	});

	test('cancelling an in-flight verification denies rather than hanging', async () => {
		const service = createService();
		service.client.deferVerification = true;

		const cancelled: string[] = [];
		const requests: ISSHHostKeyVerificationRequest[] = [];
		const store = new DisposableStore();
		store.add(service.onDidCancelHostKeyVerification(requestId => cancelled.push(requestId)));
		store.add(service.onDidRequestHostKeyVerification(request => {
			requests.push(request);
			service.client.fireError(new Error('Connection lost'));
		}));

		const result = await service.connectSSHForTest(makeConfig()).then(() => 'resolved', err => `rejected: ${err.message}`);
		store.dispose();

		assert.deepStrictEqual(
			{
				result,
				cancelled: cancelled.length === 1 && cancelled[0] === requests[0]?.requestId,
				verdict: service.client.verdict,
				verdictCount: service.client.verdictCount,
			},
			{ result: 'rejected: Connection lost', cancelled: true, verdict: false, verdictCount: 1 });
	});

	test('surfaces proven announced host keys', async () => {
		const service = createService();
		const announcements: { host: string; keys: readonly { keyType: string; fingerprint: string }[] }[] = [];
		const store = new DisposableStore();
		store.add(service.onDidAnnounceHostKeys(a => announcements.push({ host: a.host, keys: a.keys })));
		await connectAnswering(service, true);

		const rotated = makeKeyBlob('ssh-ed25519', Buffer.alloc(32, 0xcc));
		service.client.announceHostKeys([
			{ getPublicSSH: () => rotated, type: 'ssh-ed25519' },
			{ getPublicSSH: () => makeKeyBlob('ssh-ed25519', Buffer.alloc(32, 0xdd)), type: 'ssh-ed25519-cert-v01@openssh.com' },
		]);
		store.dispose();

		assert.deepStrictEqual(announcements, [{
			host: 'test.example.com',
			keys: [{ keyType: 'ssh-ed25519', fingerprint: computeHostKeyFingerprint(rotated) }],
		}]);
	});
});
