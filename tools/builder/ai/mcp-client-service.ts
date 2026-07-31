/**
 * Dardcor Code - Model Context Protocol (MCP) Server Connector Client (Task 915)
 *
 * JSON-RPC 2.0 MCP client supporting both transports:
 *   - stdio: spawns the MCP server as a child node process, line-delimited JSON
 *   - http:  JSON-RPC over HTTP POST (streamable HTTP subset)
 * Implements initialize handshake, tools/list, tools/call, and generic
 * request/response correlation via incrementing ids.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

export interface McpTool {
	readonly name: string;
	readonly description?: string;
	readonly inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
	readonly isError?: boolean;
	readonly content: ReadonlyArray<{ type: string; text?: string; [key: string]: unknown }>;
}

export interface McpTransportOptions {
	readonly command: string;
	readonly args?: readonly string[];
	readonly cwd?: string;
	readonly env?: Record<string, string>;
	readonly baseUrl?: string;
}

export interface McpClientEvents {
	onLog?: (message: string) => void;
	onNotification?: (method: string, params: unknown) => void;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
}

const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

export class McpClientService {
	private readonly _transport: McpTransportOptions;
	private readonly _emitter = new EventEmitter();
	private _child: ChildProcess | null = null;
	private _readline: ReturnType<typeof createInterface> | null = null;
	private _nextId = 1;
	private readonly _pending = new Map<number, PendingRequest>();
	private _initialized = false;
	private _closeRequested = false;

	constructor(transport: McpTransportOptions) {
		this._transport = transport;
	}

	get initialized(): boolean {
		return this._initialized;
	}

	private _onLog(message: string): void {
		this._emitter.emit('log', message);
	}

	private _onNotification(method: string, params: unknown): void {
		this._emitter.emit('notification', method, params);
	}

	on(event: 'log', listener: (message: string) => void): void;
	on(event: 'notification', listener: (method: string, params: unknown) => void): void;
	on(event: string, listener: (...args: any[]) => void): void {
		this._emitter.on(event, listener);
	}

	async connect(options: McpClientEvents = {}): Promise<void> {
		if (options.onLog) this.on('log', options.onLog);
		if (options.onNotification) this.on('notification', options.onNotification);
		this._closeRequested = false;

		if (this._transport.baseUrl) {
			await this._connectHttp();
		} else {
			await this._connectStdio();
		}
		await this.initialize();
	}

	private _connectStdio(): Promise<void> {
		return new Promise((resolve, reject) => {
			const { command, args, cwd, env } = this._transport;
			const child = spawn(command, args ?? [], {
				cwd: cwd ?? process.cwd(),
				env: { ...process.env, ...(env ?? {}) } as Record<string, string>,
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			this._child = child;

			const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
			this._readline = lines;
			lines.on('line', line => this._handleLine(line));
			child.stderr?.on('data', chunk => {
				this._onLog(`[mcp:stderr] ${chunk.toString().trimEnd()}`);
			});
			child.on('error', reject);
			child.on('close', code => {
				if (!this._closeRequested) {
					this._onLog(`[mcp] server exited with code ${code}`);
					this._rejectAll(new Error(`MCP server exited unexpectedly (code ${code})`));
				}
			});
			child.on('spawn', () => resolve());
		});
	}

	private async _connectHttp(): Promise<void> {
		const url = `${this._transport.baseUrl!.replace(/\/+$/, '')}/mcp`;
		// Probe the endpoint so connection failures surface early.
		const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
		if (!response.ok && response.status !== 404) {
			throw new Error(`MCP HTTP endpoint unreachable (${response.status})`);
		}
		this._onLog(`[mcp] connected to HTTP endpoint ${url}`);
	}

	private _handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		let message: any;
		try {
			message = JSON.parse(trimmed);
		} catch {
			this._onLog(`[mcp] non-JSON line ignored: ${trimmed.slice(0, 120)}`);
			return;
		}
		if (message.id !== undefined && message.id !== null) {
			const pending = this._pending.get(message.id);
			if (pending) {
				this._pending.delete(message.id);
				if (message.error) {
					const detail = message.error.message ?? String(message.error);
					pending.reject(new Error(`MCP error ${message.error.code ?? ''}: ${detail}`));
				} else {
					pending.resolve(message.result);
				}
			}
			return;
		}
		// server -> client notification
		this._onNotification(String(message.method ?? 'notification'), message.params);
	}

	private _rejectAll(error: Error): void {
		for (const pending of this._pending.values()) {
			pending.reject(error);
		}
		this._pending.clear();
	}

	private _send(message: Record<string, unknown>): void {
		if (this._child && this._child.stdin) {
			this._child.stdin.write(JSON.stringify(message) + '\n');
		}
	}

	async initialize(protocolVersion: string = DEFAULT_PROTOCOL_VERSION): Promise<unknown> {
		const result = await this._request('initialize', {
			protocolVersion,
			capabilities: {},
			clientInfo: { name: 'dardcor-code', version: '1.0.0' },
		});
		const negotiated = (result as any)?.protocolVersion ?? protocolVersion;
		this._request('notifications/initialized', {}).catch(() => { /* notification, fire and forget */ });
		this._initialized = true;
		this._onLog(`[mcp] initialized (protocol ${negotiated})`);
		return result;
	}

	async listTools(): Promise<McpTool[]> {
		const result = await this._request('tools/list', {});
		return ((result as any)?.tools ?? []) as McpTool[];
	}

	async callTool(name: string, arguments_: Record<string, unknown>): Promise<McpCallResult> {
		const result = await this._request('tools/call', { name, arguments: arguments_ });
		return (result ?? { content: [] }) as McpCallResult;
	}

	async ping(): Promise<unknown> {
		return this._request('ping', {});
	}

	private async _request(method: string, params: unknown): Promise<unknown> {
		const id = this._nextId++;
		const message: Record<string, unknown> = { jsonrpc: '2.0', id, method, params };

		if (this._transport.baseUrl) {
			return this._httpRequest(message);
		}
		if (!this._child) {
			throw new Error('MCP client not connected');
		}
		return new Promise((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			this._send(message);
		});
	}

	private async _httpRequest(message: Record<string, unknown>): Promise<unknown> {
		const url = `${this._transport.baseUrl!.replace(/\/+$/, '')}/mcp`;
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
			body: JSON.stringify(message),
		});
		if (!response.ok) {
			throw new Error(`MCP HTTP request failed (${response.status})`);
		}
		const text = await response.text();
		if (!text.trim()) return undefined;
		// HTTP transport may return JSON-RPC directly or SSE-wrapped.
		if (text.startsWith('{')) return JSON.parse(text)?.result;
		if (text.startsWith('event:')) {
			for (const line of text.split('\n')) {
				if (line.startsWith('data:')) {
					const json = JSON.parse(line.slice(5).trim());
					if (json.result !== undefined) return json.result;
					if (json.error) throw new Error(String(json.error.message ?? json.error));
				}
			}
		}
		return undefined;
	}

	close(): void {
		this._closeRequested = true;
		this._initialized = false;
		this._rejectAll(new Error('MCP client closed'));
		if (this._readline) {
			this._readline.close();
			this._readline = null;
		}
		if (this._child) {
			this._child.kill();
			this._child = null;
		}
	}
}

export async function createMcpClient(transport: McpTransportOptions, options?: McpClientEvents): Promise<McpClientService> {
	const client = new McpClientService(transport);
	await client.connect(options);
	return client;
}
