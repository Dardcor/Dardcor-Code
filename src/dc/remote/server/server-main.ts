/**
 * Dardcor Code - Standalone Headless Remote Server Process Daemon (Task 801)
 */

import http from 'node:http';
import { resolve, sep } from 'node:path';
import { stat, readdir, readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import type { Stats, BigIntStats } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { URI } from '../../core/types/uri.js';
import { IFileStat } from '../../services/files/file-service.js';
import {
	ServerCliOptions,
	parseServerCliArgs,
	printServerHelp,
	ServerCliLogLevel
} from './server-cli-parser.js';
import { ServerEnvironment } from './server-environment.js';
import { ServerLog } from './server-log.js';
import { WebSocketServer, WebSocketConnection } from '../transport/websocket-server.js';
import { ConnectionMultiplexer, IRemoteChannelServer, IMessageConnection } from '../transport/connection-multiplexer.js';
import { TokenValidator } from '../auth/token-validator.js';
import { CorsMiddleware } from '../auth/cors-middleware.js';
import { HeartbeatMonitor } from '../session/heartbeat-monitor.js';
import { encodeHeartbeatPing, encodeHeartbeatPong, decodeHeartbeat } from '../transport/heartbeat-protocol.js';
import { RemoteFileWatcher, RemoteFileWatcherServerChannel } from '../files/remote-file-watcher.js';
import { RemoteFileStreamServerChannel } from '../files/remote-file-stream.js';
import { RemoteFileSearchServer } from '../files/remote-file-search-provider.js';
import { RemotePtyService, RemotePtyChannel } from '../terminal/remote-pty-service.js';
import { fromBase64, toBase64 } from '../files/remote-file-provider.js';
import { RemoteWorkspaceState } from '../session/remote-workspace-state.js';

export interface IRemoteServerConfig {
	readonly port: number;
	readonly host: string;
	readonly token?: string;
	readonly workspaceRoot: string;
	readonly logLevel: ServerCliLogLevel;
	readonly allowedOrigins?: string[];
	readonly logFilePath?: string;
}

export class ServerRemoteFileChannel implements IRemoteChannelServer {
	constructor(private readonly _root: string) {}

	private _resolveSafe(relativePath: string): string {
		const normalized = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
		const target = resolve(this._root, `.${normalized}`);
		const rootWithSep = this._root.endsWith(sep) || this._root.endsWith('/') ? this._root : this._root + sep;
		if (target !== this._root && !target.startsWith(rootWithSep)) {
			throw new Error(`Path escapes workspace root: ${relativePath}`);
		}
		return target;
	}

	async call(payload: any): Promise<any> {
		if (!payload || typeof payload.op !== 'string') {
			throw new Error('Invalid file operation request');
		}
		const targetPath = this._resolveSafe(payload.resource);
		switch (payload.op) {
			case 'stat': {
				const stats = await stat(targetPath);
				return toRemoteStat(stats, payload.resource);
			}
			case 'readdir': {
				const entries = await readdir(targetPath, { withFileTypes: true });
				const result: { name: string; stat: IFileStat }[] = [];
				for (const entry of entries) {
					try {
						const stats = await stat(resolve(targetPath, entry.name));
						result.push({
							name: entry.name,
							stat: toRemoteStat(stats, `/${entry.name}`)
						});
					} catch {
						// Ignore entries that disappear between readdir and stat.
					}
				}
				return result;
			}
			case 'readFile': {
				const bytes = await readFile(targetPath);
				return { content: toBase64(new Uint8Array(bytes)) };
			}
			case 'writeFile': {
				const options = payload.options ?? { create: true, overwrite: true };
				const parent = resolve(targetPath, '..');
				await mkdir(parent, { recursive: true });
				await writeFile(targetPath, Buffer.from(fromBase64(payload.content)), {
					flag: options.create && !options.overwrite ? 'wx' : 'w'
				});
				return { ok: true };
			}
			case 'delete':
				await rm(targetPath, { recursive: !!payload.options?.recursive, force: false });
				return { ok: true };
			case 'mkdir':
				await mkdir(targetPath, { recursive: false });
				return { ok: true };
			case 'rename': {
				const source = this._resolveSafe(payload.source);
				const target = this._resolveSafe(payload.target);
				await rename(source, target);
				return { ok: true };
			}
			default:
				throw new Error(`Unknown file op '${payload.op}'`);
		}
	}
}

function toRemoteStat(stats: Stats | BigIntStats, path: string): IFileStat {
	const name = path.split('/').filter(Boolean).at(-1) ?? '';
	return {
		resource: URI.file(path),
		name,
		isDirectory: stats.isDirectory(),
		isFile: stats.isFile(),
		size: Number(stats.size),
		mtime: Number(stats.mtimeMs)
	};
}

export class RemoteServerMain extends Disposable {
	private readonly _config: IRemoteServerConfig;
	private readonly _log: ServerLog;
	private readonly _environment: ServerEnvironment;
	private readonly _tokenValidator: TokenValidator;
	private readonly _cors: CorsMiddleware;

	private _httpServer: http.Server | null = null;
	private _wsServer: WebSocketServer | null = null;
	private _ptyService: RemotePtyService | null = null;
	private _fileWatcher: RemoteFileWatcher | null = null;
	private _searchServer: RemoteFileSearchServer | null = null;
	private _fileStreamServer: RemoteFileStreamServerChannel | null = null;

	private readonly _connections = new Set<{ connection: WebSocketConnection; multiplexer: ConnectionMultiplexer }>();
	private _listening = false;

	constructor(config: IRemoteServerConfig) {
		super();
		this._config = config;
		this._log = this._register(new ServerLog({
			level: config.logLevel,
			filePath: config.logFilePath
		}));
		this._environment = new ServerEnvironment(config.workspaceRoot);
		this._tokenValidator = new TokenValidator({ tokens: config.token ? [config.token] : [] });
		this._cors = new CorsMiddleware({ allowedOrigins: config.allowedOrigins, credentials: true });
	}

	get log(): ServerLog {
		return this._log;
	}

	get environment(): ServerEnvironment {
		return this._environment;
	}

	get isListening(): boolean {
		return this._listening;
	}

	get connectionCount(): number {
		return this._connections.size;
	}

	async start(): Promise<void> {
		const info = this._environment.getInfo();
		this._log.info(`Starting Dardcor remote server on ${this._config.host}:${this._config.port}`);
		this._log.info(`Workspace root: ${info.workspaceRoot} (${info.platform} ${info.arch}, node ${info.nodeVersion})`);

		const httpServer = http.createServer((req, res) => this._handleHttpRequest(req, res));
		this._httpServer = httpServer;
		this._wsServer = new WebSocketServer(httpServer, { path: '/dc-remote' });

		this._ptyService = this._register(new RemotePtyService());
		this._fileWatcher = this._register(new RemoteFileWatcher(this._config.workspaceRoot));
		this._searchServer = new RemoteFileSearchServer(this._config.workspaceRoot);
		this._fileStreamServer = new RemoteFileStreamServerChannel(this._config.workspaceRoot);

		this._register(this._wsServer.onConnection(connection => this._handleConnection(connection)));
		this._register(this._wsServer.onUpgradeRejected(({ request, reason }) => {
			this._log.warn(`Upgrade rejected: ${reason}`);
		}));
		this._register(this._wsServer.onError(error => {
			this._log.error(error);
		}));

		await new Promise<void>((resolvePromise, reject) => {
			httpServer.once('error', reject);
			httpServer.listen(this._config.port, this._config.host, () => {
				this._listening = true;
				resolvePromise();
			});
		});

		const address = httpServer.address();
		const port = typeof address === 'object' && address ? address.port : this._config.port;
		this._log.info(`Remote server listening on ws://${this._config.host}:${port}/dc-remote`);
		this._log.info(this._config.token
			? 'Authentication: bearer token required'
			: 'WARNING: no --token configured, server accepts unauthenticated connections');
	}

	async stop(): Promise<void> {
		for (const entry of [...this._connections]) {
			try {
				entry.connection.close(1001, 'server shutting down');
			} catch {
				// ignore
			}
			entry.multiplexer.dispose();
		}
		this._connections.clear();
		this._fileStreamServer?.disposeSessions();
		if (this._wsServer) {
			this._wsServer.dispose();
			this._wsServer = null;
		}
		if (this._httpServer) {
			await new Promise<void>(resolvePromise => {
				this._httpServer!.close(() => resolvePromise());
				setTimeout(resolvePromise, 2000);
			});
			this._httpServer = null;
		}
		this._listening = false;
		this._log.info('Remote server stopped');
	}

	private _handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		if (this._cors.handle(req, res)) {
			return;
		}
		if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
			const info = this._environment.getInfo();
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				service: 'dc-remote-server',
				status: 'ok',
				uptimeSeconds: info.uptimeSeconds,
				workspaceRoot: info.workspaceRoot,
				version: typeof process !== 'undefined' ? process.versions?.node : 'unknown'
			}, null, 2));
			return;
		}
		res.writeHead(404, { 'Content-Type': 'text/plain' });
		res.end('Not Found. Use the WebSocket endpoint at /dc-remote');
	}

	private _handleConnection(connection: WebSocketConnection): void {
		this._log.info(`Client connected (${this._connections.size + 1} total)`);

		const multiplexer = new ConnectionMultiplexer({
			onMessage: connection.onMessage,
			send: data => connection.send(data),
			close: () => connection.close()
		} satisfies IMessageConnection);

		const filesClientChannel = multiplexer.getChannel('files');
		multiplexer.registerChannel('files', new ServerRemoteFileChannel(this._config.workspaceRoot));

		const watcherChannel = new RemoteFileWatcherServerChannel(this._fileWatcher!);
		watcherChannel.setEventSink(payload => filesClientChannel.fire({ type: 'change', events: payload.changes }));
		multiplexer.registerChannel('watcher', watcherChannel);
		this._fileWatcher!.watchAll();

		const streamClientChannel = multiplexer.getChannel('fileStream');
		multiplexer.registerChannel('fileStream', this._fileStreamServer!);
		void streamClientChannel;

		this._searchServer!.setEventSink(payload => {
			const searchClientChannel = multiplexer.getChannel('search');
			searchClientChannel.fire(payload);
		});
		multiplexer.registerChannel('search', this._searchServer!);

		const ptyChannel = new RemotePtyChannel(this._ptyService!);
		ptyChannel.setEventSink(payload => {
			const ptyClientChannel = multiplexer.getChannel('pty');
			ptyClientChannel.fire(payload);
		});
		multiplexer.registerChannel('pty', ptyChannel);

		const workspaceState = this._register(new RemoteWorkspaceState());
		workspaceState.bindChannel(multiplexer.getChannel('workspaceState'));
		multiplexer.registerChannel('workspaceState', {
			call: async (payload: any) => {
				if (payload && payload.op === 'get') {
					return JSON.parse(workspaceState.toJson());
				}
				return { ok: false };
			}
		});

		const heartbeat = new HeartbeatMonitor({
			sendPing: payload => connection.ping(new TextEncoder().encode(encodeHeartbeatPing(payload.seq))),
			sendPong: payload => connection.ping(new TextEncoder().encode(encodeHeartbeatPong(payload.seq)))
		}, { intervalMs: 30000, timeoutMs: 10000, autoStart: false });
		this._register(connection.onMessage(data => {
			const text = new TextDecoder().decode(data);
			const heartbeatPayload = decodeHeartbeat(text);
			if (heartbeatPayload) {
				heartbeat.handleIncomingMessage(text);
			}
		}));
		this._register(connection.onPong(data => {
			const text = new TextDecoder().decode(data);
			const heartbeatPayload = decodeHeartbeat(text);
			if (heartbeatPayload) {
				heartbeat.handleIncomingMessage(text);
			}
		}));
		heartbeat.start();
		this._register(heartbeat.onTimeout(() => {
			this._log.warn('Heartbeat timeout - closing connection');
			connection.close(1000, 'heartbeat timeout');
		}));

		const entry = { connection, multiplexer };
		this._connections.add(entry);

		this._register(connection.onClose(info => {
			this._log.info(`Client disconnected (${info.code}${info.reason ? ` - ${info.reason}` : ''})`);
			multiplexer.dispose();
			heartbeat.dispose();
			this._connections.delete(entry);
		}));
	}

	override dispose(): void {
		void this.stop();
		super.dispose();
	}
}

export async function runRemoteServer(argv: string[]): Promise<void> {
	const options = parseServerCliArgs(argv);
	if (options.help) {
		console.log(printServerHelp());
		return;
	}
	if (options.version) {
		console.log(`Dardcor Code Remote Server 1.0.0 (node ${typeof process !== 'undefined' ? process.version : 'unknown'})`);
		return;
	}
	const server = new RemoteServerMain({
		port: options.port,
		host: options.host,
		token: options.token,
		workspaceRoot: resolve(options.workspaceRoot),
		logLevel: options.logLevel,
		logFilePath: ServerLog.resolveDefaultLogPath(resolve(options.workspaceRoot))
	});
	await server.start();

	const shutdown = (signal: string): void => {
		server.log.info(`Received ${signal} - shutting down gracefully`);
		server.stop().then(() => process.exit(0)).catch(() => process.exit(1));
	};
	process.once('SIGINT', () => shutdown('SIGINT'));
	process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (isDirectExecution()) {
	runRemoteServer(process.argv.slice(2)).catch(error => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}

function isDirectExecution(): boolean {
	if (typeof process === 'undefined' || !process.argv?.[1]) {
		return false;
	}
	try {
		return pathToFileURL(process.argv[1]).href === import.meta.url;
	} catch {
		return false;
	}
}
