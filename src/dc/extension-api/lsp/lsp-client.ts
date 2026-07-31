/**
 * Dardcor Code - Language Server Protocol (LSP 3.17) Client Transport (Task 614)
 * Mirrors: vs/workbench/api/common/languageClient (JSON-RPC over stdio)
 */

import * as cp from 'node:child_process';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface ILspLaunchOptions {
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	rootUri?: string;
	workspaceFolders?: string[];
	clientCapabilities?: Record<string, any>;
	initializationOptions?: any;
	trace?: 'off' | 'messages' | 'verbose';
}

export interface ILspInitializeResult {
	capabilities: Record<string, any>;
	serverInfo?: { name: string; version?: string };
}

export interface ILspMessage {
	jsonrpc: '2.0';
	id?: number | string;
	method?: string;
	params?: any;
	result?: any;
	error?: { code: number; message: string; data?: any };
}

export interface ILspRequestHandler {
	(params: any): any | Promise<any>;
}

const JSONRPC = '2.0';

/**
 * LSP 3.17 client. Speaks Content-Length framed JSON-RPC over a child
 * process stdio channel, with a pending-request map for responses,
 * notification handlers, and server-to-client request handlers.
 */
export class LspClient extends Disposable {
	private readonly _onDidNotification = this._register(new Emitter<{ method: string; params: any }>());
	readonly onDidNotification: Event<{ method: string; params: any }> = this._onDidNotification.event;

	private readonly _onDidExit = this._register(new Emitter<{ code: number | null; signal: string | null }>());
	readonly onDidExit: Event<{ code: number | null; signal: string | null }> = this._onDidExit.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	private _child: cp.ChildProcess | undefined;
	private _seq = 0;
	private _nextHandlerId = 1;
	private readonly _pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void; method: string }>();
	private readonly _notificationHandlers = new Map<string, Set<(params: any) => void>>();
	private readonly _requestHandlers = new Map<string, ILspRequestHandler>();
	private _buffer = '';
	private _initializeResult: ILspInitializeResult | undefined;

	public get isRunning(): boolean {
		return !!this._child && !this._child.killed;
	}

	public get initializeResult(): ILspInitializeResult | undefined {
		return this._initializeResult;
	}

	public async start(options: ILspLaunchOptions): Promise<ILspInitializeResult> {
		if (this._child) {
			throw new Error('LSP client sudah berjalan');
		}
		const child = cp.spawn(options.command, options.args ?? [], {
			cwd: options.cwd,
			env: options.env ? { ...process.env, ...options.env } : process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true
		});
		this._child = child;
		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => this._processChunk(chunk));
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => this._onDidError.fire(chunk));
		child.on('error', (err: Error) => {
			this._onDidError.fire(`Server LSP gagal dijalankan: ${err.message}`);
			this._rejectAll(new Error(err.message));
		});
		child.on('close', (code, signal) => {
			this._child = undefined;
			this._rejectAll(new Error('Server LSP berhenti'));
			this._onDidExit.fire({ code, signal });
		});

		const result = await this.initialize(options);
		this._initializeResult = result;
		this.notify('initialized', {});
		return result;
	}

	public async initialize(options: ILspLaunchOptions): Promise<ILspInitializeResult> {
		const result = await this.request<ILspInitializeResult>('initialize', {
			processId: process.pid,
			rootUri: options.rootUri ?? null,
			workspaceFolders: (options.workspaceFolders ?? []).map(f => ({ uri: f, name: f.split('/').pop() ?? f })),
			capabilities: options.clientCapabilities ?? LspClient.defaultClientCapabilities(),
			initializationOptions: options.initializationOptions,
			trace: options.trace ?? 'off'
		});
		return { capabilities: result.capabilities ?? {}, serverInfo: result.serverInfo };
	}

	public request<T = any>(method: string, params?: any): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			if (!this.isRunning) {
				reject(new Error('Server LSP tidak berjalan'));
				return;
			}
			const id = this._seq++;
			this._pending.set(id, { resolve, reject, method });
			this._send({ jsonrpc: JSONRPC, id, method, params });
		});
	}

	public notify(method: string, params?: any): void {
		if (!this.isRunning) {
			return;
		}
		this._send({ jsonrpc: JSONRPC, method, params });
	}

	public onNotification(method: string, handler: (params: any) => void): IDisposable {
		let set = this._notificationHandlers.get(method);
		if (!set) {
			set = new Set();
			this._notificationHandlers.set(method, set);
		}
		set.add(handler);
		return toDisposable(() => set?.delete(handler));
	}

	public onRequest(method: string, handler: ILspRequestHandler): IDisposable {
		this._requestHandlers.set(method, handler);
		return toDisposable(() => this._requestHandlers.delete(method));
	}

	public async shutdown(): Promise<void> {
		if (!this.isRunning) {
			return;
		}
		try {
			await this.request('shutdown', null);
			this.notify('exit', null);
		} catch {
			// server sudah berhenti
		}
	}

	public stop(): void {
		this._child?.kill();
		this._child = undefined;
		this._rejectAll(new Error('LSP client dihentikan'));
	}

	public didOpen(uri: string, languageId: string, version: number, text: string): void {
		this.notify('textDocument/didOpen', {
			textDocument: { uri, languageId, version, text }
		});
	}

	public didChange(uri: string, version: number, changes: Array<{ range?: any; rangeLength?: number; text: string }>): void {
		this.notify('textDocument/didChange', {
			textDocument: { uri, version },
			contentChanges: changes
		});
	}

	public didClose(uri: string): void {
		this.notify('textDocument/didClose', { textDocument: { uri } });
	}

	public didSave(uri: string, text?: string): void {
		this.notify('textDocument/didSave', {
			textDocument: { uri },
			text
		});
	}

	public static defaultClientCapabilities(): Record<string, any> {
		return {
			workspace: {
				workspaceFolders: true,
				configuration: true,
				applyEdit: true,
				didChangeConfiguration: { dynamicRegistration: true },
				didChangeWatchedFiles: { dynamicRegistration: true },
				symbol: { dynamicRegistration: true }
			},
			textDocument: {
				publishDiagnostics: { relatedInformation: true, codeDescription: true, dataSupport: true },
				synchronization: { dynamicRegistration: true, willSave: true, willSaveWaitUntil: true, didSave: true },
				completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], insertReplaceSupport: true } },
				hover: { contentFormat: ['markdown', 'plaintext'] },
				definition: { linkSupport: true },
				references: {},
				rename: { prepareSupport: true },
				formatting: { dynamicRegistration: true },
				codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
				codeLens: { dynamicRegistration: true },
				inlayHint: { dynamicRegistration: true },
				semanticTokens: { dynamicRegistration: true, tokenTypes: [], tokenModifiers: [] }
			},
			window: { workDoneProgress: true }
		};
	}

	private _send(message: ILspMessage): void {
		const child = this._child;
		if (!child?.stdin) {
			throw new Error('Server LSP tidak berjalan');
		}
		const body = JSON.stringify(message);
		child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
	}

	private _processChunk(chunk: string): void {
		this._buffer += chunk;
		while (true) {
			const headerEnd = this._buffer.indexOf('\r\n\r\n');
			if (headerEnd === -1) {
				if (this._buffer.length > 65536) {
					this._buffer = this._buffer.substring(this._buffer.length - 4096);
				}
				return;
			}
			const headerText = this._buffer.substring(0, headerEnd);
			const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
			if (!lengthMatch) {
				this._buffer = this._buffer.substring(headerEnd + 4);
				continue;
			}
			const contentLength = parseInt(lengthMatch[1], 10);
			if (this._buffer.length < headerEnd + 4 + contentLength) {
				return;
			}
			const body = this._buffer.substring(headerEnd + 4, headerEnd + 4 + contentLength);
			this._buffer = this._buffer.substring(headerEnd + 4 + contentLength);
			this._handleMessage(body);
		}
	}

	private _handleMessage(body: string): void {
		let message: ILspMessage;
		try {
			message = JSON.parse(body);
		} catch {
			this._onDidError.fire('Pesan LSP tidak valid');
			return;
		}
		if (message.id !== undefined && message.method === undefined) {
			const pending = this._pending.get(message.id as number);
			if (pending) {
				this._pending.delete(message.id as number);
				if (message.error) {
					pending.reject(new Error(`LSP ${pending.method}: ${message.error.message}`));
				} else {
					pending.resolve(message.result);
				}
			}
		} else if (message.id !== undefined && message.method) {
			this._handleServerRequest(message);
		} else if (message.method) {
			const handlers = this._notificationHandlers.get(message.method);
			if (handlers) {
				for (const handler of handlers) {
					try {
						handler(message.params);
					} catch (err) {
						console.error(`[lsp-client] Handler '${message.method}' gagal:`, err);
					}
				}
			}
			this._onDidNotification.fire({ method: message.method, params: message.params });
		}
	}

	private _handleServerRequest(message: ILspMessage): void {
		const handler = this._requestHandlers.get(message.method ?? '');
		if (!handler) {
			this._send({ jsonrpc: JSONRPC, id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
			return;
		}
		try {
			const result = handler(message.params);
			if (result && typeof result.then === 'function') {
				result.then(
					(value: any) => this._send({ jsonrpc: JSONRPC, id: message.id, result: value }),
					(err: any) => this._send({ jsonrpc: JSONRPC, id: message.id, error: { code: -32603, message: String(err?.message ?? err) } })
				);
			} else {
				this._send({ jsonrpc: JSONRPC, id: message.id, result });
			}
		} catch (err) {
			this._send({ jsonrpc: JSONRPC, id: message.id, error: { code: -32603, message: String(err instanceof Error ? err.message : err) } });
		}
	}

	private _rejectAll(err: Error): void {
		for (const [, pending] of this._pending) {
			pending.reject(err);
		}
		this._pending.clear();
	}
}
