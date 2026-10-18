/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type WebSocket from 'ws';
import type { AnyAuthMethod, AuthenticationType, ConnectConfig } from 'ssh2';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { dirname, join, isAbsolute, basename } from '../../../base/common/path.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableMap, toDisposable } from '../../../base/common/lifecycle.js';
import { raceTimeout } from '../../../base/common/async.js';
import { CancellationError } from '../../../base/common/errors.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { ITelemetryService, TelemetryConfiguration } from '../../telemetry/common/telemetry.js';
import {
	ISSHRemoteAgentHostMainService,
	SSHAuthMethod,
	computeSSHConnectionKey,
	type ISSHAgentHostConfig,
	type ISSHAgentHostConfigSanitized,
	type ISSHConnectProgress,
	type ISSHConnectResult,
	type ISSHEndpointCandidate,
	type ISSHEndpointSelection,
	type ISSHEndpointSelectionRequest,
	type ISSHHostKeyVerificationRequest,
	type ISSHHostKeysAnnouncement,
	type ISSHKeyboardInteractivePrompt,
	type ISSHKeyboardInteractiveRequest,
	type ISSHResolvedConfig,
	type SSHAgentHostLifecycle,
	type SSHStrictHostKeyChecking,
	SSHHostKeyDeniedError,
} from '../common/sshRemoteAgentHost.js';
import {
	computeHostKeyFingerprint,
	matchKnownHosts,
	parseKnownHosts,
	readHostKeyType,
	type IKnownHostsEntry,
} from './sshKnownHosts.js';
import type { RemoteAgentHostLocationPreference } from '../common/remoteAgentHostLocationPreference.js';
import type { IRelayMessage } from '../common/relayTransport.js';
import { AgentHostTelemetryLevelEnvKey } from '../common/agentHostTelemetryEnv.js';
import { telemetryLevelToAgentHostValue } from '../common/agentHostTelemetry.js';
import {
	type AgentHostEndpointAddress,
	type AgentHostServerType,
	type IAgentHostEndpointMetadata,
	isSameAgentHostEndpointIdentity,
} from '../common/agentHostEndpointRegistry.js';
import {
	buildAgentHostBaseCommand,
	buildAgentHostSpawnCommand,
	buildAgentRelayCommand,
	extractAgentHostWebSocketURL,
	filterLiveAgentHostEndpoints,
	getNewAgentHostRegistrationTimeoutMs,
	getRemoteCLIDataDir,
	redactToken,
	resolveRemotePlatform,
	runAgentEndpoints,
	shellEscape,
	validateAgentHostTelemetryLevel,
	waitForNewStandaloneEndpoint,
} from './sshRemoteAgentHostHelpers.js';
import { ensureRemoteAgentHostCliInstalled, type IRemoteAgentHostCliInstallResult } from './remoteAgentHostCliInstaller.js';
import { parseSSHConfigHostEntries, parseSSHGOutput, stripSSHComment } from '../common/sshConfigParsing.js';
import { removeAnsiEscapeCodes } from '../../../base/common/strings.js';

interface SSHChannel extends NodeJS.ReadWriteStream {
	on(event: 'data', listener: (data: Buffer) => void): this;
	on(event: 'close', listener: (code: number) => void): this;
	on(event: 'error', listener: (err: Error) => void): this;
	on(event: string, listener: (...args: unknown[]) => void): this;
	stderr: { on(event: 'data', listener: (data: Buffer) => void): void };
	close(): void;
}

interface SSHClient {
	on(event: 'ready', listener: () => void): SSHClient;
	on(event: 'error', listener: (err: Error) => void): SSHClient;
	on(event: 'close', listener: () => void): SSHClient;
	on(event: 'hostkeys', listener: (keys: readonly { getPublicSSH(): Buffer; type: string }[]) => void): SSHClient;
	removeListener(event: 'close', listener: () => void): SSHClient;
	removeListener(event: 'error', listener: (err: Error) => void): SSHClient;
	connect(config: ConnectConfig): void;
	exec(command: string, callback: (err: Error | undefined, stream: SSHChannel) => void): SSHClient;
	forwardOut(srcIP: string, srcPort: number, dstIP: string, dstPort: number, callback: (err: Error | undefined, channel: SSHChannel) => void): SSHClient;
	end(): void;
}

const LOG_PREFIX = '[SSHRemoteAgentHost]';

const RECONNECT_RELAY_TIMEOUT_MS = 60_000;

type IHandshakeDeadlineHandle = ReturnType<typeof setTimeout>;

const HANDSHAKE_TIMEOUT_MS = 30_000;

const INTERACTIVE_TIMEOUT_MS = 300_000;

export type SSHAuthAttempt =
	| { readonly type: 'publickey'; readonly username: string; readonly key: Buffer; readonly keyPath: string; readonly encrypted?: boolean }
	| { readonly type: 'agent'; readonly username: string; readonly agent: string }
	| { readonly type: 'password'; readonly username: string; readonly password: string }
	| { readonly type: 'keyboard-interactive'; readonly username: string };

function describeAuthAttempt(attempt: SSHAuthAttempt): string {
	switch (attempt.type) {
		case 'publickey': return `publickey ${attempt.keyPath}`;
		case 'agent': return 'agent';
		case 'password': return 'password';
		case 'keyboard-interactive': return 'keyboard-interactive';
	}
}

export type SSHKeyboardInteractivePromptHandler = (
	name: string,
	instructions: string,
	prompts: readonly ISSHKeyboardInteractivePrompt[],
	finish: (responses: readonly string[]) => void,
) => void;

export type SSHKeyPassphrasePromptHandler = (
	keyPath: string,
	finish: (passphrase: string | undefined) => void,
) => void;

function toAuthMethod(
	attempt: SSHAuthAttempt,
	kbiHandler: SSHKeyboardInteractivePromptHandler | undefined,
	keyPassphraseHandler: SSHKeyPassphrasePromptHandler | undefined,
	callback: (next: AnyAuthMethod | false) => void,
): AnyAuthMethod | undefined {
	switch (attempt.type) {
		case 'publickey': {
			const { keyPath: _kp, encrypted: _encrypted, ...payload } = attempt;
			if (attempt.encrypted) {
				if (!keyPassphraseHandler) {
					return undefined;
				}
				keyPassphraseHandler(attempt.keyPath, passphrase => {
					if (passphrase === undefined) {
						callback(false);
						return;
					}
					callback({ ...payload, passphrase });
				});
				return undefined;
			}
			return payload;
		}
		case 'agent':
		case 'password':
			return attempt;
		case 'keyboard-interactive': {
			if (!kbiHandler) {
				return undefined;
			}
			return {
				type: 'keyboard-interactive',
				username: attempt.username,
				prompt: (name, instructions, _lang, prompts, finish) => {
					const normalized = prompts.map(p => ({ prompt: p.prompt, echo: p.echo ?? true }));
					kbiHandler(name, instructions, normalized, responses => finish([...responses]));
				},
			};
		}
	}
}

function isMethodAllowedByServer(attempt: SSHAuthAttempt, methodsLeft: AuthenticationType[] | null): boolean {
	if (!methodsLeft) {
		return true;
	}
	const protocolMethod: AuthenticationType = attempt.type === 'agent' ? 'publickey' : attempt.type;
	return methodsLeft.includes(protocolMethod);
}

export function makeAuthHandler(
	attempts: readonly SSHAuthAttempt[],
	logService: ILogService,
	kbiHandler?: SSHKeyboardInteractivePromptHandler,
	keyPassphraseHandler?: SSHKeyPassphrasePromptHandler,
): (methodsLeft: AuthenticationType[] | null, partialSuccess: boolean, callback: (next: AnyAuthMethod | false) => void) => void {
	let index = 0;
	return (methodsLeft, _partialSuccess, callback) => {
		while (index < attempts.length) {
			const attempt = attempts[index++];
			if (!isMethodAllowedByServer(attempt, methodsLeft)) {
				logService.info(`${LOG_PREFIX} Skipping ${describeAuthAttempt(attempt)} — server only allows ${methodsLeft!.join(', ')}`);
				continue;
			}
			const method = toAuthMethod(attempt, kbiHandler, keyPassphraseHandler, callback);
			if (!method) {
				if (attempt.type === 'publickey' && attempt.encrypted && keyPassphraseHandler) {
					logService.info(`${LOG_PREFIX} Trying auth: ${describeAuthAttempt(attempt)}`);
					return;
				}
				logService.warn(`${LOG_PREFIX} ${describeAuthAttempt(attempt)} skipped: no prompt handler available`);
				continue;
			}
			logService.info(`${LOG_PREFIX} Trying auth: ${describeAuthAttempt(attempt)}`);
			callback(method);
			return;
		}
		logService.info(`${LOG_PREFIX} No more auth methods to try; giving up`);
		callback(false);
	};
}

function readSSHString(buffer: Buffer, offset: number): { value: string; offset: number } | undefined {
	if (offset + 4 > buffer.length) {
		return undefined;
	}
	const length = buffer.readUInt32BE(offset);
	const valueOffset = offset + 4;
	const nextOffset = valueOffset + length;
	if (nextOffset > buffer.length) {
		return undefined;
	}
	return { value: buffer.toString('utf8', valueOffset, nextOffset), offset: nextOffset };
}

function isEncryptedPrivateKey(key: Buffer): boolean {
	const text = key.toString('utf8');
	if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(text) || /Proc-Type:\s*4,ENCRYPTED/i.test(text)) {
		return true;
	}
	const openSSHKey = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]+?)-----END OPENSSH PRIVATE KEY-----/.exec(text);
	if (!openSSHKey) {
		return false;
	}
	const data = Buffer.from(openSSHKey[1].replace(/\s+/g, ''), 'base64');
	const magic = Buffer.from('openssh-key-v1\0', 'utf8');
	if (data.length < magic.length || !data.subarray(0, magic.length).equals(magic)) {
		return false;
	}
	const cipher = readSSHString(data, magic.length);
	return !!cipher && cipher.value !== 'none';
}

function sshExec(client: SSHClient, command: string, opts?: { ignoreExitCode?: boolean }): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
		client.exec(command, (err: Error | undefined, stream: SSHChannel) => {
			if (err) {
				reject(err);
				return;
			}

			let stdout = '';
			let stderr = '';
			let settled = false;

			const finish = (error: Error | undefined, code: number | undefined) => {
				if (settled) {
					return;
				}
				settled = true;
				if (error) {
					reject(error);
					return;
				}
				if (code !== 0 && !opts?.ignoreExitCode) {
					reject(new Error(`SSH command failed (exit ${code}): ${command}\nstderr: ${stderr}`));
				} else {
					resolve({ stdout, stderr, code: code ?? 0 });
				}
			};

			stream.on('data', (data: Buffer) => { stdout += data.toString(); });
			stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
			stream.on('error', (streamErr: Error) => finish(streamErr, undefined));
			stream.on('close', (code: number) => finish(undefined, code));
		});
	});
}

function bindSshExec(client: SSHClient): (command: string, opts?: { ignoreExitCode?: boolean }) => Promise<{ stdout: string; stderr: string; code: number }> {
	return (command, opts) => sshExec(client, command, opts);
}

function startRemoteAgentHost(
	client: SSHClient,
	logService: ILogService,
	cliBin: string | undefined,
	cliDataDir: string | undefined,
	commandOverride?: string,
	telemetryLevel = TelemetryConfiguration.OFF,
): Promise<{ port: number; connectionToken: string | undefined; pid: number | undefined; stream: SSHChannel }> {
	return new Promise((resolve, reject) => {
		if (!commandOverride && (!cliBin || !cliDataDir)) {
			reject(new Error(`${LOG_PREFIX} startRemoteAgentHost requires either a cliBin+cliDataDir pair or a commandOverride`));
			return;
		}
		const validatedTelemetryLevel = validateAgentHostTelemetryLevel(telemetryLevel);
		const baseCmd = commandOverride ?? buildAgentHostBaseCommand(cliBin!, cliDataDir!, validatedTelemetryLevel);
		const cmd = `bash -l -c ${shellEscape(`echo VSCODE_PID=$$ && export ${AgentHostTelemetryLevelEnvKey}=${validatedTelemetryLevel} && exec ${baseCmd}`)}`;
		logService.info(`${LOG_PREFIX} Starting remote agent host: ${cmd}`);

		client.exec(cmd, (err: Error | undefined, stream: SSHChannel) => {
			if (err) {
				reject(err);
				return;
			}

			let resolved = false;
			let outputBuf = '';
			let pid: number | undefined;

			const timeout = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					reject(new Error(`${LOG_PREFIX} Timed out waiting for agent host to start.\noutput so far: ${redactToken(outputBuf)}`));
				}
			}, 60_000);

			const checkForOutput = () => {
				const clean = removeAnsiEscapeCodes(outputBuf);
				if (pid === undefined) {
					const pidMatch = clean.match(/VSCODE_PID=(\d+)/);
					if (pidMatch) {
						pid = parseInt(pidMatch[1], 10);
						logService.info(`${LOG_PREFIX} Remote agent host PID: ${pid}`);
					}
				}

				if (!resolved) {
					const match = extractAgentHostWebSocketURL(clean);
					if (match) {
						resolved = true;
						clearTimeout(timeout);
						logService.info(`${LOG_PREFIX} Remote agent host listening on port ${match.port}`);
						resolve({ port: match.port, connectionToken: match.token, pid, stream });
					}
				}
			};

			stream.stderr.on('data', (data: Buffer) => {
				const text = data.toString();
				outputBuf += text;
				logService.trace(`${LOG_PREFIX} remote stderr: ${redactToken(text.trimEnd())}`);
				checkForOutput();
			});

			stream.on('data', (data: Buffer) => {
				const text = data.toString();
				outputBuf += text;
				logService.trace(`${LOG_PREFIX} remote stdout: ${redactToken(text.trimEnd())}`);
				checkForOutput();
			});

			stream.on('error', (streamErr: Error) => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timeout);
					reject(streamErr);
				}
			});

			stream.on('close', (code: number) => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timeout);
					reject(new Error(`${LOG_PREFIX} Agent host process exited with code ${code} before becoming ready.\noutput: ${redactToken(outputBuf)}`));
				}
			});
		});
	});
}

function openForwardOutChannel(client: SSHClient, dstHost: string, dstPort: number): Promise<SSHChannel> {
	return new Promise((resolve, reject) => {
		client.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err: Error | undefined, channel: SSHChannel) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(channel);
		});
	});
}

function openRelayExecChannel(client: SSHClient, command: string, logService: ILogService): Promise<SSHChannel> {
	return new Promise((resolve, reject) => {
		client.exec(command, (err: Error | undefined, stream: SSHChannel) => {
			if (err) {
				reject(err);
				return;
			}
			stream.stderr.on('data', (data: Buffer) => {
				logService.trace(`${LOG_PREFIX} agent relay stderr: ${redactToken(data.toString().trimEnd())}`);
			});
			resolve(stream);
		});
	});
}

function createWebSocketOverChannel(
	nativeRequire: NodeJS.Require,
	channel: SSHChannel,
	urlHost: string,
	urlPort: number,
	connectionToken: string | undefined,
	logService: ILogService,
	onMessage: (data: string) => void,
	onClose: () => void,
): Promise<{ send: (data: string) => void; close: () => void }> {
	return new Promise((resolve, reject) => {
		const WS = nativeRequire('ws') as typeof WebSocket;
		let url = `ws://${urlHost}:${urlPort}`;
		if (connectionToken) {
			url += `?tkn=${encodeURIComponent(connectionToken)}`;
		}

		const ws = new WS(url, { createConnection: (() => channel) as unknown as WebSocket.ClientOptions['createConnection'] });

		ws.on('open', () => {
			logService.info(`${LOG_PREFIX} WebSocket relay connected to remote agent host`);
			resolve({
				send: (data: string) => {
					if (ws.readyState === ws.OPEN) {
						ws.send(data);
					}
				},
				close: () => ws.close(),
			});
		});

		ws.on('message', (data: WebSocket.RawData) => {
			if (Array.isArray(data)) {
				onMessage(Buffer.concat(data).toString());
			} else if (data instanceof ArrayBuffer) {
				onMessage(Buffer.from(new Uint8Array(data)).toString());
			} else {
				onMessage(data.toString());
			}
		});

		ws.on('close', onClose);

		ws.on('error', (wsErr: unknown) => {
			logService.warn(`${LOG_PREFIX} WebSocket relay error: ${wsErr instanceof Error ? wsErr.message : String(wsErr)}`);
			reject(wsErr);
		});
	});
}

async function createWebSocketRelayForEndpoint(
	nativeRequire: NodeJS.Require,
	client: SSHClient,
	endpoint: AgentHostEndpointAddress,
	relayCliBin: string,
	relayCliDataDir: string,
	relayInstanceId: string,
	relayUserDataPath: string,
	connectionToken: string | undefined,
	logService: ILogService,
	onMessage: (data: string) => void,
	onClose: () => void,
): Promise<{ send: (data: string) => void; close: () => void }> {
	let channel: SSHChannel;
	let urlHost: string;
	let urlPort: number;
	if (endpoint.type === 'tcp') {
		channel = await openForwardOutChannel(client, endpoint.host, endpoint.port);
		urlHost = endpoint.host;
		urlPort = endpoint.port;
	} else {
		const command = buildAgentRelayCommand(relayCliBin, relayCliDataDir, relayInstanceId, relayUserDataPath);
		logService.info(`${LOG_PREFIX} Opening agent relay channel: ${command}`);
		channel = await openRelayExecChannel(client, command, logService);
		urlHost = '127.0.0.1';
		urlPort = 1;
	}
	return createWebSocketOverChannel(nativeRequire, channel, urlHost, urlPort, connectionToken, logService, onMessage, onClose);
}

function sanitizeConfig(config: ISSHAgentHostConfig): ISSHAgentHostConfigSanitized {
	const { password: _p, privateKeyPath: _k, ...sanitized } = config;
	return sanitized;
}

class SSHConnection extends Disposable {
	private readonly _onDidClose = new Emitter<void>();
	readonly onDidClose = this._onDidClose.event;

	readonly config: ISSHAgentHostConfigSanitized;
	private _closed = false;
	private _sshClientDetached = false;
	private readonly _sshCloseListener = () => {
		this._logService.info(`${LOG_PREFIX} SSH client closed for connection ${this.connectionId} (address ${this.address}); disposing connection`);
		this.dispose();
	};
	private readonly _sshErrorListener = (err?: Error) => {
		this._logService.info(`${LOG_PREFIX} SSH client error for connection ${this.connectionId} (address ${this.address}): ${err instanceof Error ? err.message : String(err)}; disposing connection`);
		this.dispose();
	};

	constructor(
		fullConfig: ISSHAgentHostConfig,
		readonly connectionId: string,
		readonly address: string,
		readonly name: string,
		readonly connectionToken: string | undefined,
		readonly endpoint: AgentHostEndpointAddress,
		readonly serverType: AgentHostServerType | undefined,
		readonly instanceId: string,
		readonly lifecycle: SSHAgentHostLifecycle,
		readonly cliBin: string,
		readonly cliDataDir: string,
		readonly userDataPath: string,
		readonly sshClient: SSHClient,
		private readonly _relay: { send: (data: string) => void; close: () => void },
		private readonly _remoteStream: SSHChannel | undefined,
		private readonly _logService: ILogService,
	) {
		super();

		this.config = sanitizeConfig(fullConfig);

		this._register(toDisposable(() => {
			if (this._closed) {
				return;
			}
			this._closed = true;
			this._relay.close();
			if (!this._sshClientDetached) {
				this._remoteStream?.close();
				sshClient.end();
			}
			this._onDidClose.fire();
		}));

		this._register(this._onDidClose);

		sshClient.on('close', this._sshCloseListener);
		sshClient.on('error', this._sshErrorListener);
	}

	detachSshClient(): void {
		this._sshClientDetached = true;
		this.sshClient.removeListener('close', this._sshCloseListener);
		this.sshClient.removeListener('error', this._sshErrorListener);
	}

	relaySend(data: string): void {
		this._relay.send(data);
	}
}

export class SSHRemoteAgentHostMainService extends Disposable implements ISSHRemoteAgentHostMainService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConnections = this._register(new Emitter<void>());
	readonly onDidChangeConnections: Event<void> = this._onDidChangeConnections.event;

	private readonly _onDidCloseConnection = this._register(new Emitter<string>());
	readonly onDidCloseConnection: Event<string> = this._onDidCloseConnection.event;

	private readonly _onDidReportConnectProgress = this._register(new Emitter<ISSHConnectProgress>());
	readonly onDidReportConnectProgress: Event<ISSHConnectProgress> = this._onDidReportConnectProgress.event;

	private readonly _onDidRelayMessage = this._register(new Emitter<IRelayMessage>());
	readonly onDidRelayMessage: Event<IRelayMessage> = this._onDidRelayMessage.event;

	private readonly _onDidRelayClose = this._register(new Emitter<string>());
	readonly onDidRelayClose: Event<string> = this._onDidRelayClose.event;

	private readonly _onDidRequestKeyboardInteractive = this._register(new Emitter<ISSHKeyboardInteractiveRequest>());
	readonly onDidRequestKeyboardInteractive: Event<ISSHKeyboardInteractiveRequest> = this._onDidRequestKeyboardInteractive.event;

	private readonly _onDidCancelKeyboardInteractive = this._register(new Emitter<string>());
	readonly onDidCancelKeyboardInteractive: Event<string> = this._onDidCancelKeyboardInteractive.event;

	private readonly _onDidRequestEndpointSelection = this._register(new Emitter<ISSHEndpointSelectionRequest>());
	readonly onDidRequestEndpointSelection: Event<ISSHEndpointSelectionRequest> = this._onDidRequestEndpointSelection.event;

	private readonly _onDidCancelEndpointSelection = this._register(new Emitter<string>());
	readonly onDidCancelEndpointSelection: Event<string> = this._onDidCancelEndpointSelection.event;

	private readonly _onDidRequestHostKeyVerification = this._register(new Emitter<ISSHHostKeyVerificationRequest>());
	readonly onDidRequestHostKeyVerification: Event<ISSHHostKeyVerificationRequest> = this._onDidRequestHostKeyVerification.event;

	private readonly _onDidCancelHostKeyVerification = this._register(new Emitter<string>());
	readonly onDidCancelHostKeyVerification: Event<string> = this._onDidCancelHostKeyVerification.event;

	private readonly _onDidAnnounceHostKeys = this._register(new Emitter<ISSHHostKeysAnnouncement>());
	readonly onDidAnnounceHostKeys: Event<ISSHHostKeysAnnouncement> = this._onDidAnnounceHostKeys.event;

	private readonly _pendingKbiRequests = new Map<string, { finish: (responses: readonly string[]) => void; cancelConnect: () => void }>();
	private _kbiRequestCounter = 0;

	private readonly _pendingEndpointSelections = new Map<string, (selection: ISSHEndpointSelection | undefined) => void>();
	private _endpointSelectionCounter = 0;

	private readonly _pendingHostKeyRequests = new Map<string, { verify: (trusted: boolean) => void; onUserDenied?: () => void }>();
	private _hostKeyRequestCounter = 0;

	private readonly _connections = this._register(new DisposableMap<string, SSHConnection>());

	private _nativeRequire: NodeJS.Require | undefined;

	protected relayCreationTimeoutMs: number = RECONNECT_RELAY_TIMEOUT_MS;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IProductService private readonly _productService: IProductService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();
	}

	private async _getNativeRequire(): Promise<NodeJS.Require> {
		if (!this._nativeRequire) {
			const nodeModule = await import('node:module');
			this._nativeRequire = nodeModule.createRequire(import.meta.url);
		}
		return this._nativeRequire;
	}

	async connect(config: ISSHAgentHostConfig, replaceRelay?: boolean): Promise<ISSHConnectResult> {
		const connectionKey = computeSSHConnectionKey(config);

		const existing = this._connections.get(connectionKey);
		if (existing) {
			if (replaceRelay) {
				this._logService.info(`${LOG_PREFIX} Reconnecting relay for existing SSH tunnel ${connectionKey}`);
				const { sshClient, endpoint, connectionToken, serverType, instanceId, lifecycle, cliBin, cliDataDir, userDataPath } = existing;

				this._connections.deleteAndLeak(connectionKey);
				existing.detachSshClient();
				existing.dispose();

				const connectionId = connectionKey;
				try {
					let conn: SSHConnection | undefined; // eslint-disable-line prefer-const
					const timeoutMs = this.relayCreationTimeoutMs;
					const relay = await raceTimeout(
						this._createWebSocketRelay(
							sshClient, endpoint, cliBin, cliDataDir, instanceId, userDataPath, connectionToken,
							(data: string) => this._onDidRelayMessage.fire({ connectionId, data }),
							() => { conn?.dispose(); },
						),
						timeoutMs,
					);
					if (!relay) {
						throw new Error(`SSH relay creation timed out after ${timeoutMs}ms (SSH client appears unresponsive)`);
					}

					conn = new SSHConnection(
						config, connectionId, connectionKey, config.name,
						connectionToken, endpoint, serverType, instanceId, lifecycle, cliBin, cliDataDir, userDataPath,
						sshClient, relay, undefined,
						this._logService,
					);

					Event.once(conn.onDidClose)(() => {
						if (this._connections.get(connectionKey) === conn) {
							this._connections.deleteAndDispose(connectionKey);
							this._onDidRelayClose.fire(connectionId);
							this._onDidCloseConnection.fire(connectionId);
							this._onDidChangeConnections.fire();
						}
					});

					this._connections.set(connectionKey, conn);

					return {
						connectionId: conn.connectionId,
						address: conn.address,
						name: conn.name,
						connectionToken: conn.connectionToken,
						config: conn.config,
						sshConfigHost: config.sshConfigHost,
						serverType: conn.serverType,
						instanceId: conn.instanceId,
						primary: true,
						lifecycle: conn.lifecycle,
					};
				} catch (err) {
					sshClient.end();
					this._onDidRelayClose.fire(connectionId);
					this._onDidCloseConnection.fire(connectionId);
					this._onDidChangeConnections.fire();
					throw err;
				}
			}

			return {
				connectionId: existing.connectionId,
				address: existing.address,
				name: existing.name,
				connectionToken: existing.connectionToken,
				config: existing.config,
				sshConfigHost: config.sshConfigHost,
				serverType: existing.serverType,
				instanceId: existing.instanceId,
				primary: true,
				lifecycle: existing.lifecycle,
			};
		}

		this._logService.info(`${LOG_PREFIX} ${replaceRelay ? 'Reconnecting' : 'Connecting'} to ${connectionKey}`);
		const displayHost = config.sshConfigHost ?? `${config.username}@${config.host}`;
		let sshClient: SSHClient | undefined;

		try {
			const reportProgress = (message: string) => {
				this._onDidReportConnectProgress.fire({ connectionKey, message });
			};

			reportProgress(localize('sshProgressConnecting', "Establishing SSH connection..."));
			sshClient = await this._connectSSH(config, connectionKey);

			let endpoint: AgentHostEndpointAddress;
			let connectionToken: string | undefined;
			let serverType: AgentHostServerType | undefined;
			let instanceId: string;
			let lifecycle: SSHAgentHostLifecycle;
			let cliBin = '';
			let cliDataDir = '';
			let userDataPath = '';
			let agentStream: SSHChannel | undefined;

			if (config.remoteAgentHostCommand) {
				this._logService.info(`${LOG_PREFIX} Using custom agent host command: ${config.remoteAgentHostCommand}; skipping endpoint discovery/selection`);
				reportProgress(localize('sshProgressStartingAgent', "Starting remote agent host..."));
				const result = await this._startRemoteAgentHost(sshClient, undefined, undefined, config.remoteAgentHostCommand, this._effectiveTelemetryLevel);
				endpoint = { type: 'tcp', host: '127.0.0.1', port: result.port };
				connectionToken = result.connectionToken;
				agentStream = result.stream;
				serverType = undefined;
				instanceId = 'override';
				lifecycle = 'managed';
			} else {
				const { stdout: unameS } = await sshExec(sshClient, 'uname -s');
				const { stdout: unameM } = await sshExec(sshClient, 'uname -m');
				const platform = resolveRemotePlatform(unameS, unameM);
				if (!platform) {
					throw new Error(`${LOG_PREFIX} Unsupported remote platform: ${unameS.trim()} ${unameM.trim()}`);
				}
				this._logService.info(`${LOG_PREFIX} Remote platform: ${platform.os}-${platform.arch}`);
				reportProgress(localize('sshProgressInstallingCLI', "Checking remote CLI installation..."));
				const cliInstallation = await this._ensureCLIInstalled(sshClient, platform, reportProgress);
				cliBin = cliInstallation.cliBin;
				cliDataDir = getRemoteCLIDataDir(this._serverDataFolderName);

				reportProgress(localize('sshProgressCheckingAgent', "Checking for existing agent hosts..."));
				const exec = bindSshExec(sshClient);
				const initial = await runAgentEndpoints(exec, cliBin, cliDataDir);
				userDataPath = initial.userDataPath;
				const live = await filterLiveAgentHostEndpoints(exec, initial.endpoints);
				const editors = live.filter(e => e.type === 'editor');
				const standalones = live.filter(e => e.type === 'standalone');

				const spawnDedicated = async (): Promise<IAgentHostEndpointMetadata> => {
					const spawnCommand = buildAgentHostSpawnCommand(cliBin, cliDataDir, userDataPath, this._effectiveTelemetryLevel);
					reportProgress(localize('sshProgressStartingAgent', "Starting remote agent host..."));
					this._logService.info(`${LOG_PREFIX} Spawning dedicated standalone agent host: ${spawnCommand}`);
					exec(spawnCommand, { ignoreExitCode: true }).catch(err => {
						this._logService.warn(`${LOG_PREFIX} Spawn command for dedicated agent host reported an error: ${err instanceof Error ? err.message : String(err)}`);
					});
					reportProgress(localize('sshProgressAwaitingAgent', "Waiting for the new agent host to register..."));
					return waitForNewStandaloneEndpoint(exec, cliBin, cliDataDir, userDataPath, live, {
						timeoutMs: getNewAgentHostRegistrationTimeoutMs(cliInstallation.installed),
						progress: elapsedMs => reportProgress(localize('sshProgressStillAwaitingAgent', "Waiting for the new agent host to register... ({0} seconds elapsed)", Math.floor(elapsedMs / 1000))),
					});
				};

				const selectDedicated = async (): Promise<{ chosen: IAgentHostEndpointMetadata; lifecycle: SSHAgentHostLifecycle }> => {
					if (standalones.length === 0) {
						return { chosen: await spawnDedicated(), lifecycle: 'managed' };
					}
					const [deterministic] = [...standalones].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
					return { chosen: deterministic, lifecycle: 'external' };
				};

				const selectEndpoint = async (): Promise<{ chosen: IAgentHostEndpointMetadata; lifecycle: SSHAgentHostLifecycle }> => {
					if (config.preferredAgentLocation === 'editor') {
						if (editors.length > 0) {
							const [deterministic] = [...editors].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
							return { chosen: deterministic, lifecycle: 'external' };
						}
						return selectDedicated();
					}
					if (config.preferredAgentLocation === 'dedicated') {
						return selectDedicated();
					}
					if (config.userInitiated === false) {
						return selectDedicated();
					}
					if (editors.length === 0) {
						if (standalones.length === 0) {
							return { chosen: await spawnDedicated(), lifecycle: 'managed' };
						}
						if (standalones.length === 1) {
							return { chosen: standalones[0], lifecycle: 'external' };
						}
						reportProgress(localize('sshProgressAwaitingSelection', "Waiting for endpoint selection..."));
						const selection = await this._requestEndpointSelection(sshClient!, connectionKey, displayHost, standalones);
						if (selection.kind === 'spawn') {
							return { chosen: await spawnDedicated(), lifecycle: 'managed' };
						}
						const found = standalones.find(e => isSameAgentHostEndpointIdentity(e, selection));
						if (!found) {
							throw new Error(`${LOG_PREFIX} Selected agent host endpoint is no longer available`);
						}
						return { chosen: found, lifecycle: 'external' };
					}
					reportProgress(localize('sshProgressAwaitingSelection', "Waiting for endpoint selection..."));
					const selection = await this._requestEndpointSelection(sshClient!, connectionKey, displayHost, live);
					if (selection.kind === 'spawn') {
						return { chosen: await spawnDedicated(), lifecycle: 'managed' };
					}
					const found = live.find(e => isSameAgentHostEndpointIdentity(e, selection));
					if (!found) {
						throw new Error(`${LOG_PREFIX} Selected agent host endpoint is no longer available`);
					}
					return { chosen: found, lifecycle: 'external' };
				};

				const selected = await selectEndpoint();
				endpoint = selected.chosen.endpoint;
				connectionToken = selected.chosen.connectionToken;
				serverType = selected.chosen.type;
				instanceId = selected.chosen.instanceId;
				lifecycle = selected.lifecycle;
			}

			reportProgress(localize('sshProgressForwarding', "Connecting to remote agent host..."));
			const connectionId = connectionKey;
			let conn: SSHConnection | undefined; // eslint-disable-line prefer-const
			let relay: { send: (data: string) => void; close: () => void };
			try {
				relay = await this._createWebSocketRelay(
					sshClient, endpoint, cliBin, cliDataDir, instanceId, userDataPath, connectionToken,
					(data: string) => this._onDidRelayMessage.fire({ connectionId, data }),
					() => { conn?.dispose(); },
				);
			} catch (relayErr) {
				const relayErrorMessage = relayErr instanceof Error ? relayErr.message : String(relayErr);
				this._logService.warn(`${LOG_PREFIX} Failed to connect to selected agent host endpoint: ${relayErrorMessage}`);
				if (!config.remoteAgentHostCommand && cliBin && cliDataDir) {
					try {
						await runAgentEndpoints(bindSshExec(sshClient), cliBin, cliDataDir, userDataPath);
					} catch (rereadErr) {
						this._logService.warn(`${LOG_PREFIX} Failed to reread agent host endpoints after relay failure: ${rereadErr instanceof Error ? rereadErr.message : String(rereadErr)}`);
					}
				}
				throw new Error(`${LOG_PREFIX} Failed to connect to the selected remote agent host: ${relayErrorMessage}. Please retry connecting.`);
			}

			const address = connectionKey;
			conn = new SSHConnection(
				config,
				connectionId,
				address,
				config.name,
				connectionToken,
				endpoint,
				serverType,
				instanceId,
				lifecycle,
				cliBin,
				cliDataDir,
				userDataPath,
				sshClient,
				relay,
				agentStream,
				this._logService,
			);

			Event.once(conn.onDidClose)(() => {
				if (this._connections.get(connectionKey) === conn) {
					this._connections.deleteAndDispose(connectionKey);
					this._onDidRelayClose.fire(connectionId);
					this._onDidCloseConnection.fire(connectionId);
					this._onDidChangeConnections.fire();
				}
			});

			this._connections.set(connectionKey, conn);
			sshClient = undefined;

			this._onDidChangeConnections.fire();

			return {
				connectionId,
				address,
				name: config.name,
				connectionToken,
				config: conn.config,
				sshConfigHost: config.sshConfigHost,
				serverType,
				instanceId,
				primary: true,
				lifecycle,
			};

		} catch (err) {
			sshClient?.end();
			if (!(err instanceof CancellationError)) {
				this._logService.error(`${LOG_PREFIX} Failed to connect to ${displayHost}`, err);
			}
			throw err;
		}
	}


	async disconnect(host: string): Promise<void> {
		for (const [key, conn] of this._connections) {
			if (key === host || conn.connectionId === host) {
				conn.dispose();
				return;
			}
		}
	}

	async relaySend(connectionId: string, message: string): Promise<void> {
		for (const conn of this._connections.values()) {
			if (conn.connectionId === connectionId) {
				conn.relaySend(message);
				return;
			}
		}
	}

	async reconnect(sshConfigHost: string, name: string, remoteAgentHostCommand?: string, agentForward?: boolean, userInitiated?: boolean, preferredAgentLocation?: RemoteAgentHostLocationPreference): Promise<ISSHConnectResult> {
		this._logService.info(`${LOG_PREFIX} Reconnecting via SSH config host: ${sshConfigHost} (userInitiated=${userInitiated ?? true})`);
		const resolved = await this.resolveSSHConfig(sshConfigHost);

		let privateKeyPath: string | undefined;
		if (resolved.identityFile.length > 0 && !SSHRemoteAgentHostMainService._isDefaultKeyPath(resolved.identityFile[0])) {
			privateKeyPath = resolved.identityFile[0];
		}
		this._logService.info(`${LOG_PREFIX} reconnect: identityFiles=${JSON.stringify(resolved.identityFile)}, explicit key=${privateKeyPath ?? '(none)'}`);

		return this.connect({
			host: resolved.hostname,
			port: resolved.port !== 22 ? resolved.port : undefined,
			username: resolved.user ?? sshConfigHost,
			authMethod: SSHAuthMethod.Agent,
			privateKeyPath,
			identityAgent: resolved.identityAgent,
			name,
			sshConfigHost,
			remoteAgentHostCommand,
			agentForward: agentForward && resolved.forwardAgent ? true : undefined,
			userInitiated,
			preferredAgentLocation,
		}, true);
	}

	async listSSHConfigHosts(): Promise<string[]> {
		const configPath = join(os.homedir(), '.ssh', 'config');
		try {
			const content = await fsp.readFile(configPath, 'utf-8');
			return this._parseSSHConfigHosts(content, dirname(configPath));
		} catch {
			this._logService.info(`${LOG_PREFIX} Could not read SSH config at ${configPath}`);
			return [];
		}
	}

	async ensureUserSSHConfig(): Promise<URI> {
		const sshDir = join(os.homedir(), '.ssh');
		const configPath = join(sshDir, 'config');
		const isPosix = process.platform !== 'win32';
		try {
			await fsp.mkdir(sshDir, { recursive: true, mode: isPosix ? 0o700 : undefined });
		} catch (err) {
			this._logService.warn(`${LOG_PREFIX} Failed to ensure ~/.ssh directory: ${err}`);
			throw err;
		}
		try {
			await fsp.access(configPath);
		} catch {
			try {
				const handle = await fsp.open(configPath, 'a', isPosix ? 0o600 : undefined);
				await handle.close();
			} catch (err) {
				this._logService.warn(`${LOG_PREFIX} Failed to create ${configPath}: ${err}`);
				throw err;
			}
		}
		return URI.file(configPath);
	}

	async listSSHConfigFiles(): Promise<URI[]> {
		const isWindows = process.platform === 'win32';
		const userConfigPath = join(os.homedir(), '.ssh', 'config');
		const systemConfigPath = isWindows
			? join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'ssh', 'ssh_config')
			: '/etc/ssh/ssh_config';

		const result: URI[] = [URI.file(userConfigPath)];
		try {
			await fsp.access(systemConfigPath);
			result.push(URI.file(systemConfigPath));
		} catch {
		}
		return result;
	}

	async resolveSSHConfig(host: string): Promise<ISSHResolvedConfig> {
		return new Promise<ISSHResolvedConfig>((resolve, reject) => {
			cp.execFile('ssh', ['-G', host], { timeout: 5000 }, (err, stdout) => {
				if (err) {
					reject(new Error(`${LOG_PREFIX} ssh -G failed for ${host}: ${err.message}`));
					return;
				}
				const config = this._parseSSHGOutput(stdout);
				resolve(config);
			});
		});
	}

	private async _parseSSHConfigHosts(content: string, configDir: string, visited?: Set<string>): Promise<string[]> {
		const seen = visited ?? new Set<string>();
		const hosts: string[] = [];

		hosts.push(...parseSSHConfigHostEntries(content));

		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) {
				continue;
			}
			const includeMatch = trimmed.match(/^Include\s+(.+)$/i);
			if (!includeMatch) {
				continue;
			}

			const rawValue = stripSSHComment(includeMatch[1]);
			const patterns = rawValue.split(/\s+/).filter(Boolean);

			for (const rawPattern of patterns) {
				const pattern = rawPattern.replace(/^~/, os.homedir());
				const resolvedPattern = isAbsolute(pattern) ? pattern : join(configDir, pattern);

				if (seen.has(resolvedPattern)) {
					continue;
				}
				seen.add(resolvedPattern);

				try {
					const stat = await fsp.stat(resolvedPattern);
					if (stat.isDirectory()) {
						const files = await fsp.readdir(resolvedPattern);
						for (const file of files) {
							try {
								const sub = await fsp.readFile(join(resolvedPattern, file), 'utf-8');
								hosts.push(...await this._parseSSHConfigHosts(sub, resolvedPattern, seen));
							} catch { }
						}
					} else {
						const sub = await fsp.readFile(resolvedPattern, 'utf-8');
						hosts.push(...await this._parseSSHConfigHosts(sub, dirname(resolvedPattern), seen));
					}
				} catch {
					const dir = dirname(resolvedPattern);
					const base = basename(resolvedPattern);
					if (base.includes('*')) {
						try {
							const files = await fsp.readdir(dir);
							for (const file of files) {
								const regex = new RegExp('^' + base.replace(/\*/g, '.*') + '$');
								if (regex.test(file)) {
									try {
										const sub = await fsp.readFile(join(dir, file), 'utf-8');
										hosts.push(...await this._parseSSHConfigHosts(sub, dir, seen));
									} catch { }
								}
							}
						} catch { }
					}
				}
			}
		}
		return hosts;
	}

	private _parseSSHGOutput(stdout: string): ISSHResolvedConfig {
		return parseSSHGOutput(stdout);
	}

	protected async _connectSSH(
		config: ISSHAgentHostConfig,
		connectionKey?: string,
	): Promise<SSHClient> {
		const port = config.port ?? 22;
		const connectConfig: ConnectConfig = {
			host: config.host,
			port,
			username: config.username,
			readyTimeout: 0,
			keepaliveInterval: 15_000,
		};

		const attempts = await this._buildAuthAttempts(config);
		this._logService.info(`${LOG_PREFIX} Built ${attempts.length} auth attempt(s): ${attempts.map(a => describeAuthAttempt(a)).join(', ')}`);
		const displayHost = config.sshConfigHost ?? `${config.username}@${config.host}`;
		const liveKbiRequests = new Set<string>();
		let cancelConnectFromKbi: (() => void) | undefined;
		let armDeadline: ((ms: number) => void) | undefined;
		const wrapPromptFinish = <T>(finish: (value: T) => void) => (value: T) => {
			armDeadline?.(HANDSHAKE_TIMEOUT_MS);
			finish(value);
		};
		const kbiHandler: SSHKeyboardInteractivePromptHandler | undefined = attempts.some(a => a.type === 'keyboard-interactive')
			? (name, instructions, prompts, finish) => {
				armDeadline?.(INTERACTIVE_TIMEOUT_MS);
				const requestId = this._handleKeyboardInteractive(connectionKey ?? displayHost, displayHost, config.username, name, instructions, prompts, wrapPromptFinish(finish), () => cancelConnectFromKbi?.());
				liveKbiRequests.add(requestId);
			}
			: undefined;
		const keyPassphraseHandler: SSHKeyPassphrasePromptHandler | undefined = attempts.some(a => a.type === 'publickey' && a.encrypted)
			? (keyPath, finish) => {
				armDeadline?.(INTERACTIVE_TIMEOUT_MS);
				const requestId = this._handleKeyboardInteractive(
					connectionKey ?? displayHost,
					displayHost,
					config.username,
					localize('sshKeyPassphraseName', "SSH Key Passphrase"),
					'',
					[{ prompt: localize('sshKeyPassphrasePrompt', "Enter passphrase for SSH key {0}.", keyPath), echo: false }],
					wrapPromptFinish((responses: readonly string[]) => finish(responses[0])),
					() => cancelConnectFromKbi?.(),
				);
				liveKbiRequests.add(requestId);
			}
			: undefined;
		connectConfig.authHandler = makeAuthHandler(attempts, this._logService, kbiHandler, keyPassphraseHandler) as unknown as ConnectConfig['authHandler'];

		const cancelLiveKbiRequests = () => {
			for (const requestId of liveKbiRequests) {
				const pending = this._pendingKbiRequests.get(requestId);
				this._pendingKbiRequests.delete(requestId);
				this._onDidCancelKeyboardInteractive.fire(requestId);
				pending?.finish([]);
			}
			liveKbiRequests.clear();
		};

		if (config.agentForward) {
			const agentSock = this._getAgentSocket(config);
			if (agentSock) {
				connectConfig.agent = agentSock;
				connectConfig.agentForward = true;
				this._logService.info(`${LOG_PREFIX} SSH agent forwarding enabled`);
			} else {
				this._logService.warn(`${LOG_PREFIX} SSH agent forwarding requested, but no SSH agent endpoint is available; agent forwarding disabled`);
			}
		}

		const liveHostKeyRequests = new Set<string>();
		let hostKeyVerificationAborted = false;
		let hostKeyDenied = false;
		const cancelLiveHostKeyRequests = () => {
			hostKeyVerificationAborted = true;
			for (const requestId of liveHostKeyRequests) {
				const pending = this._pendingHostKeyRequests.get(requestId);
				this._pendingHostKeyRequests.delete(requestId);
				this._onDidCancelHostKeyVerification.fire(requestId);
				pending?.verify(false);
			}
			liveHostKeyRequests.clear();
		};
		connectConfig.hostVerifier = (key: Buffer, verify: (permitted: boolean) => void) => {
			void this._verifyHostKey(
				connectionKey ?? displayHost,
				displayHost,
				config,
				port,
				key,
				verify,
				requestId => {
					liveHostKeyRequests.add(requestId);
					armDeadline?.(INTERACTIVE_TIMEOUT_MS);
					return () => { hostKeyDenied = true; };
				},
				() => hostKeyVerificationAborted,
				() => armDeadline?.(HANDSHAKE_TIMEOUT_MS),
			);
		};

		const client = await this._createSSHClient();
		return new Promise<SSHClient>((resolve, reject) => {
			let settled = false;
			let deadlineTimer: IHandshakeDeadlineHandle | undefined;

			const clearDeadline = () => {
				this._clearHandshakeDeadline(deadlineTimer);
				deadlineTimer = undefined;
			};

			armDeadline = (ms: number) => {
				if (settled) {
					return;
				}
				clearDeadline();
				deadlineTimer = this._armHandshakeDeadline(ms, () => {
					rejectConnect(new Error(`SSH handshake to ${config.host} timed out`), true);
				});
			};

			const resolveConnect = () => {
				if (settled) {
					return;
				}
				settled = true;
				clearDeadline();
				this._logService.info(`${LOG_PREFIX} SSH connection established to ${config.host}`);
				cancelLiveKbiRequests();
				cancelLiveHostKeyRequests();
				resolve(client);
			};

			const rejectConnect = (err: Error, endClient: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				clearDeadline();
				cancelLiveKbiRequests();
				cancelLiveHostKeyRequests();
				if (endClient) {
					client.end();
				}
				reject(err);
			};

			cancelConnectFromKbi = () => {
				this._logService.info(`${LOG_PREFIX} SSH keyboard-interactive prompt cancelled by user for ${displayHost}`);
				rejectConnect(new CancellationError(), true);
			};

			client.on('ready', () => {
				resolveConnect();
			});

			client.on('error', (err: Error) => {
				this._logService.error(`${LOG_PREFIX} SSH connection error: ${err.message}`);
				rejectConnect(hostKeyDenied ? new SSHHostKeyDeniedError(displayHost) : err, false);
			});

			client.on('close', () => {
				rejectConnect(
					hostKeyDenied
						? new SSHHostKeyDeniedError(displayHost)
						: new Error(`SSH connection to ${config.host} closed before the handshake completed`),
					false);
			});

			client.on('hostkeys', (keys: readonly { getPublicSSH(): Buffer; type: string }[]) => {
				this._handleAnnouncedHostKeys(connectionKey ?? displayHost, config.host, port, keys);
			});

			armDeadline(HANDSHAKE_TIMEOUT_MS);
			client.connect(connectConfig);
		});
	}

	protected _armHandshakeDeadline(ms: number, onExpired: () => void): IHandshakeDeadlineHandle {
		return setTimeout(onExpired, ms);
	}

	protected _clearHandshakeDeadline(timer: IHandshakeDeadlineHandle | undefined): void {
		if (timer) {
			clearTimeout(timer);
		}
	}

	protected async _createSSHClient(): Promise<SSHClient> {
		const nativeRequire = await this._getNativeRequire();
		const ssh2Module = nativeRequire('ssh2') as { Client: new () => unknown };
		return new ssh2Module.Client() as SSHClient;
	}

	protected async _buildAuthAttempts(config: ISSHAgentHostConfig): Promise<SSHAuthAttempt[]> {
		const attempts: SSHAuthAttempt[] = [];
		const username = config.username;

		switch (config.authMethod) {
			case SSHAuthMethod.Agent: {
				const agentSock = this._getAgentSocket(config);
				if (agentSock) {
					attempts.push({ type: 'agent', username, agent: agentSock });
				}
				const explicitKeyPath = config.privateKeyPath;
				const explicitIsDefault = explicitKeyPath !== undefined && SSHRemoteAgentHostMainService._isDefaultKeyPath(explicitKeyPath);
				if (explicitKeyPath && !explicitIsDefault) {
					const explicit = await this._readKeyFileIfExists(explicitKeyPath);
					if (explicit) {
						attempts.push({ type: 'publickey', username, key: explicit, keyPath: explicitKeyPath, ...(isEncryptedPrivateKey(explicit) ? { encrypted: true } : undefined) });
					}
				}
				for (const keyPath of SSHRemoteAgentHostMainService._defaultKeyPaths) {
					const contents = await this._readKeyFileIfExists(keyPath);
					if (contents) {
						attempts.push({ type: 'publickey', username, key: contents, keyPath, ...(isEncryptedPrivateKey(contents) ? { encrypted: true } : undefined) });
					}
				}
				attempts.push({ type: 'keyboard-interactive', username });
				break;
			}
			case SSHAuthMethod.KeyFile: {
				if (!config.privateKeyPath) {
					throw new Error(localize('ssh.keyFileAuthRequiresPath', "Key file authentication requires a private key path."));
				}
				const explicit = await this._readKeyFileIfExists(config.privateKeyPath);
				if (!explicit) {
					throw new Error(localize('ssh.failedToReadPrivateKey', "Failed to read private key file: {0}", config.privateKeyPath));
				}
				attempts.push({ type: 'publickey', username, key: explicit, keyPath: config.privateKeyPath, ...(isEncryptedPrivateKey(explicit) ? { encrypted: true } : undefined) });
				break;
			}
			case SSHAuthMethod.Password: {
				if (config.password !== undefined) {
					attempts.push({ type: 'password', username, password: config.password });
				}
				break;
			}
		}

		return attempts;
	}

	private static readonly _defaultKeyPaths = [
		'~/.ssh/id_ed25519',
		'~/.ssh/id_rsa',
		'~/.ssh/id_ecdsa',
		'~/.ssh/id_dsa',
		'~/.ssh/id_xmss',
	];

	private static _normalizeKeyPath(keyPath: string): string {
		return keyPath.replace(/^~/, os.homedir());
	}

	private static _isDefaultKeyPath(keyPath: string): boolean {
		const normalized = SSHRemoteAgentHostMainService._normalizeKeyPath(keyPath);
		return SSHRemoteAgentHostMainService._defaultKeyPaths.some(p => SSHRemoteAgentHostMainService._normalizeKeyPath(p) === normalized);
	}

	protected _isAgentAvailable(): string | undefined {
		return process.env['SSH_AUTH_SOCK'];
	}

	protected _getAgentSocket(config: ISSHAgentHostConfig): string | undefined {
		if (config.identityAgent !== undefined) {
			return this._resolveIdentityAgent(config.identityAgent);
		}
		return this._isAgentAvailable();
	}

	private _resolveIdentityAgent(identityAgent: string): string | undefined {
		const trimmed = identityAgent.trim();
		if (!trimmed || trimmed.toLowerCase() === 'none') {
			return undefined;
		}
		if (trimmed === 'SSH_AUTH_SOCK') {
			return this._isAgentAvailable();
		}
		if (trimmed.startsWith('$')) {
			const envMatch = /^\$\{(?<braced>[A-Za-z_][A-Za-z0-9_]*)\}$|^\$(?<plain>[A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
			return envMatch?.groups ? process.env[envMatch.groups.braced ?? envMatch.groups.plain] || undefined : undefined;
		}
		return trimmed.replace(/^~/, os.homedir());
	}

	protected _handleKeyboardInteractive(
		connectionKey: string,
		displayHost: string,
		username: string,
		name: string,
		instructions: string,
		prompts: readonly ISSHKeyboardInteractivePrompt[],
		finish: (responses: readonly string[]) => void,
		cancelConnect: () => void,
	): string {
		const requestId = `kbi-${++this._kbiRequestCounter}`;
		let settled = false;
		const finishOnce = (responses: readonly string[]) => {
			if (settled) {
				return;
			}
			settled = true;
			this._pendingKbiRequests.delete(requestId);
			finish(responses);
		};
		this._pendingKbiRequests.set(requestId, { finish: finishOnce, cancelConnect });
		this._logService.info(`${LOG_PREFIX} keyboard-interactive challenge from ${displayHost}: ${prompts.length} prompt(s)`);
		this._onDidRequestKeyboardInteractive.fire({
			requestId,
			connectionKey,
			displayHost,
			username,
			name,
			instructions,
			prompts: prompts.map(p => ({ prompt: p.prompt, echo: p.echo })),
		});
		return requestId;
	}

	async respondKeyboardInteractive(requestId: string, responses: readonly string[] | undefined): Promise<void> {
		const pending = this._pendingKbiRequests.get(requestId);
		if (!pending) {
			this._logService.warn(`${LOG_PREFIX} respondKeyboardInteractive: no pending request for ${requestId}`);
			return;
		}
		if (responses === undefined) {
			pending.cancelConnect();
			pending.finish([]);
			return;
		}
		pending.finish(responses);
	}

	protected async _readKnownHostsEntries(host: string): Promise<{ entries: IKnownHostsEntry[]; strictHostKeyChecking: SSHStrictHostKeyChecking | undefined }> {
		let resolved: ISSHResolvedConfig | undefined;
		try {
			resolved = await this.resolveSSHConfig(host);
		} catch (err) {
			this._logService.warn(`${LOG_PREFIX} Could not resolve SSH config for known_hosts lookup of ${host}: ${err}`);
		}

		const paths = [
			...(resolved?.userKnownHostsFiles ?? ['~/.ssh/known_hosts']),
			...(resolved?.globalKnownHostsFiles ?? []),
		];

		const entries: IKnownHostsEntry[] = [];
		for (const path of paths) {
			const expanded = path.replace(/^~/, os.homedir());
			try {
				entries.push(...parseKnownHosts(await fsp.readFile(expanded, 'utf-8')));
			} catch {
				// systems have no known_hosts2 and no global file).
			}
		}
		return { entries, strictHostKeyChecking: resolved?.strictHostKeyChecking };
	}

	private async _verifyHostKey(
		connectionKey: string,
		displayHost: string,
		config: ISSHAgentHostConfig,
		port: number,
		key: Buffer,
		verify: (permitted: boolean) => void,
		onRequest: (requestId: string) => (() => void) | void,
		isAborted: () => boolean,
		onPromptSettled: () => void,
	): Promise<void> {
		let settled = false;
		let prompted = false;
		const verifyOnce = (permitted: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			if (prompted) {
				onPromptSettled();
			}
			verify(permitted);
		};

		try {
			const keyType = readHostKeyType(key);
			if (!keyType) {
				this._logService.error(`${LOG_PREFIX} Rejecting malformed host key from ${displayHost}`);
				verifyOnce(false);
				return;
			}

			const fingerprint = computeHostKeyFingerprint(key);
			const { entries, strictHostKeyChecking } = await this._readKnownHostsEntries(config.sshConfigHost ?? config.host);

			if (isAborted()) {
				this._logService.info(`${LOG_PREFIX} Abandoning host key verification for ${displayHost}: connect attempt already settled`);
				verifyOnce(false);
				return;
			}

			const knownHostsMatch = matchKnownHosts(entries, config.host, port, keyType, key);
			this._logService.info(`${LOG_PREFIX} Host key for ${displayHost}: ${keyType} ${fingerprint} (known_hosts: ${knownHostsMatch})`);

			const requestId = `hostkey-${++this._hostKeyRequestCounter}`;
			prompted = true;
			const onUserDenied = onRequest(requestId) ?? undefined;
			this._pendingHostKeyRequests.set(requestId, { verify: verifyOnce, onUserDenied });
			this._onDidRequestHostKeyVerification.fire({
				requestId,
				connectionKey,
				displayHost,
				host: config.host,
				port,
				keyType,
				fingerprint,
				knownHostsMatch,
				...(strictHostKeyChecking ? { strictHostKeyChecking } : undefined),
				userInitiated: config.userInitiated ?? true,
			});
		} catch (err) {
			this._logService.error(`${LOG_PREFIX} Host key verification failed for ${displayHost}`, err);
			verifyOnce(false);
		}
	}

	async respondHostKeyVerification(requestId: string, trusted: boolean): Promise<void> {
		const pending = this._pendingHostKeyRequests.get(requestId);
		if (!pending) {
			this._logService.warn(`${LOG_PREFIX} respondHostKeyVerification: no pending request for ${requestId}`);
			return;
		}
		this._pendingHostKeyRequests.delete(requestId);
		this._logService.info(`${LOG_PREFIX} Host key ${trusted ? 'accepted' : 'rejected'} for request ${requestId}`);
		if (!trusted) {
			pending.onUserDenied?.();
		}
		pending.verify(trusted);
	}

	private _handleAnnouncedHostKeys(
		connectionKey: string,
		host: string,
		port: number,
		keys: readonly { getPublicSSH(): Buffer; type: string }[],
	): void {
		const announced: { keyType: string; fingerprint: string }[] = [];
		for (const key of keys) {
			try {
				const blob = key.getPublicSSH();
				const keyType = readHostKeyType(blob);
				if (keyType && keyType === key.type) {
					announced.push({ keyType, fingerprint: computeHostKeyFingerprint(blob) });
				}
			} catch (err) {
				this._logService.warn(`${LOG_PREFIX} Skipping unreadable announced host key for ${host}: ${err}`);
			}
		}
		if (!announced.length) {
			return;
		}
		this._logService.info(`${LOG_PREFIX} Server ${host} announced ${announced.length} proven host key(s)`);
		this._onDidAnnounceHostKeys.fire({ connectionKey, host, port, keys: announced });
	}

	private _requestEndpointSelection(
		client: SSHClient,
		connectionKey: string,
		displayHost: string,
		candidates: readonly IAgentHostEndpointMetadata[],
	): Promise<ISSHEndpointSelection> {
		const requestId = `endpoint-${++this._endpointSelectionCounter}`;
		return new Promise<ISSHEndpointSelection>((resolve, reject) => {
			let settled = false;
			const onClientUnavailable = () => {
				if (settled) {
					return;
				}
				settled = true;
				this._pendingEndpointSelections.delete(requestId);
				client.removeListener('close', onClientUnavailable);
				client.removeListener('error', onClientUnavailable);
				this._onDidCancelEndpointSelection.fire(requestId);
				reject(new CancellationError());
			};
			client.on('close', onClientUnavailable);
			client.on('error', onClientUnavailable);

			this._pendingEndpointSelections.set(requestId, selection => {
				if (settled) {
					return;
				}
				settled = true;
				client.removeListener('close', onClientUnavailable);
				client.removeListener('error', onClientUnavailable);
				if (selection === undefined) {
					reject(new CancellationError());
				} else {
					resolve(selection);
				}
			});

			this._logService.info(`${LOG_PREFIX} Requesting endpoint selection for ${displayHost}: ${candidates.length} candidate(s)`);
			this._onDidRequestEndpointSelection.fire({
				requestId,
				connectionKey,
				displayHost,
				candidates: candidates.map((c): ISSHEndpointCandidate => ({ type: c.type, pid: c.pid, instanceId: c.instanceId, quality: c.quality, endpoint: c.endpoint })),
			});
		});
	}

	async respondEndpointSelection(requestId: string, selection: ISSHEndpointSelection | undefined): Promise<void> {
		const pending = this._pendingEndpointSelections.get(requestId);
		if (!pending) {
			this._logService.warn(`${LOG_PREFIX} respondEndpointSelection: no pending request for ${requestId}`);
			return;
		}
		this._pendingEndpointSelections.delete(requestId);
		pending(selection);
	}

	protected async _readKeyFileIfExists(keyPath: string): Promise<Buffer | undefined> {
		const resolved = keyPath.replace(/^~/, os.homedir());
		try {
			return await fsp.readFile(resolved);
		} catch (error) {
			const errorCode = (error as NodeJS.ErrnoException).code;
			if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') {
				return undefined;
			}
			this._logService.warn(`${LOG_PREFIX} Failed to read SSH key file ${resolved}`, error);
			return undefined;
		}
	}

	private get _quality(): string {
		return this._productService.quality || 'insider';
	}

	private get _serverDataFolderName(): string {
		return this._productService.serverDataFolderName ?? '.vscode-server-oss';
	}

	private get _commit(): string | undefined {
		return this._productService.commit;
	}

	private get _effectiveTelemetryLevel(): TelemetryConfiguration {
		return telemetryLevelToAgentHostValue(this._telemetryService.telemetryLevel);
	}

	protected _startRemoteAgentHost(
		client: SSHClient, cliBin: string | undefined, cliDataDir: string | undefined, commandOverride?: string, telemetryLevel?: TelemetryConfiguration,
	): Promise<{ port: number; connectionToken: string | undefined; pid: number | undefined; stream: SSHChannel }> {
		return startRemoteAgentHost(client, this._logService, cliBin, cliDataDir, commandOverride, telemetryLevel);
	}

	protected async _createWebSocketRelay(
		client: SSHClient,
		endpoint: AgentHostEndpointAddress,
		relayCliBin: string,
		relayCliDataDir: string,
		relayInstanceId: string,
		relayUserDataPath: string,
		connectionToken: string | undefined,
		onMessage: (data: string) => void, onClose: () => void,
	): Promise<{ send: (data: string) => void; close: () => void }> {
		const nativeRequire = await this._getNativeRequire();
		return createWebSocketRelayForEndpoint(nativeRequire, client, endpoint, relayCliBin, relayCliDataDir, relayInstanceId, relayUserDataPath, connectionToken, this._logService, onMessage, onClose);
	}


	private async _ensureCLIInstalled(client: SSHClient, platform: { os: string; arch: string }, reportProgress: (message: string) => void): Promise<IRemoteAgentHostCliInstallResult> {
		return ensureRemoteAgentHostCliInstalled(bindSshExec(client), platform, {
			serverDataFolderName: this._serverDataFolderName,
			quality: this._quality,
			commit: this._commit,
			reportInstalling: () => reportProgress(localize('sshProgressDownloadingCLI', "Installing VS Code CLI on remote...")),
			logService: this._logService,
			logPrefix: LOG_PREFIX,
		});
	}
}
