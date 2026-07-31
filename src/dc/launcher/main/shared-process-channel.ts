import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type SharedRequestHandler = (method: string, args: unknown[]) => unknown | Promise<unknown>;

export interface SharedRequest {
	__dcId: number;
	method: string;
	args: unknown[];
}

export interface SharedResponse {
	__dcId: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

export class SharedProcessChannel {
	private _handler: SharedRequestHandler | null = null;
	private _port: { postMessage(message: unknown): void; on(event: 'message', listener: (message: any) => void): unknown } | null = null;
	private _ipc: typeof import('electron') | null = null;
	private _ipcMode = false;

	public async init(): Promise<void> {
		const parentPort = (process as any).parentPort;
		if (parentPort) {
			this._port = parentPort;
			this._port.on('message', (message: unknown) => this._handleMessage(message));
			return;
		}
		try {
			const electron = await import('electron');
			this._ipc = electron;
			this._ipcMode = true;
			electron.ipcMain.on('shared-process:request', (_event: any, request: SharedRequest) => {
				const response = this._handleMessage(request);
				if (response) {
					(_event.sender as any).send('shared-process:response', response);
				}
			});
		} catch {
			console.warn('[shared-process-channel] no message channel available');
		}
	}

	public registerHandler(handler: SharedRequestHandler): void {
		this._handler = handler;
	}

	public handleRequest(method: string, args: unknown[]): unknown | Promise<unknown> {
		if (!this._handler) {
			return { error: 'No handler registered' };
		}
		return this._handler(method, args);
	}

	private _handleMessage(message: unknown): SharedResponse | null {
		if (!message || typeof message !== 'object' || !('__dcId' in (message as any))) {
			return null;
		}
		const request = message as SharedRequest;
		if (!this._handler) {
			return { __dcId: request.__dcId, ok: false, error: 'No handler registered' };
		}
		try {
			const result = this._handler(request.method, request.args ?? []);
			if (result instanceof Promise) {
				result
					.then((value) => this._sendResponse({ __dcId: request.__dcId, ok: true, result: value }))
					.catch((err: unknown) => {
						this._sendResponse({ __dcId: request.__dcId, ok: false, error: String(err) });
					});
				return null;
			}
			return { __dcId: request.__dcId, ok: true, result };
		} catch (err) {
			return { __dcId: request.__dcId, ok: false, error: String(err) };
		}
	}

	private _sendResponse(response: SharedResponse): void {
		if (this._port) {
			this._port.postMessage(response);
		} else if (this._ipcMode) {
			console.log('[shared-process-channel] response delivered via port handshake');
		}
	}
}

const channel = new SharedProcessChannel();

export function registerDefaultHandlers(): void {
	channel.registerHandler((method, args) => {
		switch (method) {
			case 'storage:get': {
				const key = String(args[0] ?? '');
				return readStorage().then((store) => store[key] ?? null);
			}
			case 'storage:set': {
				const key = String(args[0] ?? '');
				const value = args[1];
				return readStorage().then((store) => {
					store[key] = value;
					return writeStorage(store).then(() => ({ success: true }));
				});
			}
			case 'storage:delete': {
				const key = String(args[0] ?? '');
				return readStorage().then((store) => {
					const existed = key in store;
					delete store[key];
					return writeStorage(store).then(() => ({ success: true, existed }));
				});
			}
			case 'storage:all':
				return readStorage();
			case 'process:info':
				return {
					pid: process.pid,
					title: process.title,
					memory: process.memoryUsage(),
					uptime: process.uptime(),
					platform: process.platform,
					versions: {
						node: process.versions.node,
						v8: process.versions.v8
					}
				};
			case 'ping':
				return 'pong';
			default:
				return { error: `Unknown shared process method: ${method}` };
		}
	});
}

function getStorageFile(): string {
	return path.join(process.env.DC_USER_DATA ?? process.cwd(), 'shared-process-storage.json');
}

async function readStorage(): Promise<Record<string, unknown>> {
	const file = getStorageFile();
	try {
		const raw = await fs.promises.readFile(file, 'utf-8');
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

async function writeStorage(store: Record<string, unknown>): Promise<void> {
	const file = getStorageFile();
	await fs.promises.mkdir(path.dirname(file), { recursive: true });
	await fs.promises.writeFile(file, JSON.stringify(store, null, 2), 'utf-8');
}

export async function startSharedProcess(): Promise<SharedProcessChannel> {
	registerDefaultHandlers();
	await channel.init();
	return channel;
}

export function getSharedProcessChannel(): SharedProcessChannel {
	return channel;
}

export function getSharedProcessEntryPath(): string {
	return path.join(__dirname, 'shared-process-channel');
}
