import * as path from 'path';
import { fileURLToPath } from 'url';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter } from '../../core/events/emitter';
import { SharedProcessClient } from './shared-process-client';
import { getSharedProcessEntryPath } from './shared-process-channel';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SharedProcessLaunchResult {
	pid: number | null;
	success: boolean;
	error?: string;
}

export class SharedProcessLauncher extends Disposable {
	private _child: any = null;
	private _port: any = null;
	private _client: SharedProcessClient | null = null;
	private _electron: typeof import('electron') | null = null;
	private readonly _entryPath: string;

	constructor(entryPath?: string) {
		super();
		this._entryPath = entryPath ?? getSharedProcessEntryPath();
	}

	public async launch(args: string[] = []): Promise<SharedProcessLaunchResult> {
		if (this._child) {
			return { pid: this._child.pid, success: true };
		}
		try {
			this._electron = await import('electron');
			const utilityProcess = (this._electron as any).utilityProcess;
			const { MessageChannelMain } = this._electron as any;
			if (!utilityProcess || !MessageChannelMain) {
				return { pid: null, success: false, error: 'utilityProcess unavailable' };
			}
			const child = utilityProcess.fork(this._entryPath, args, {
				serviceName: 'shared-process',
				stdout: 'pipe',
				stderr: 'pipe'
			});
			this._child = child;
			this._register(toDisposable(() => this.terminate()));

			const { port1, port2 } = new MessageChannelMain();
			child.postMessage({ __dcChannelInit: true }, [port2]);
			port1.start();
			this._port = port1;
			this._client = new SharedProcessClient();
			this._client.connect(port1);
			this._register(this._client);

			(child.stdout as any)?.on?.('data', (data: Buffer) => {
				process.stdout.write(`[shared-process] ${data.toString()}`);
			});
			(child.stderr as any)?.on?.('data', (data: Buffer) => {
				process.stderr.write(`[shared-process] ${data.toString()}`);
			});
			child.on('exit', () => {
				this._child = null;
				this._port = null;
				this._client = null;
			});
			return { pid: child.pid, success: true };
		} catch (err) {
			return { pid: null, success: false, error: String(err) };
		}
	}

	public getClient(): SharedProcessClient | null {
		return this._client;
	}

	public getPort(): unknown {
		return this._port;
	}

	public isRunning(): boolean {
		return this._child !== null;
	}

	public getPid(): number | null {
		return this._child ? this._child.pid : null;
	}

	public terminate(): boolean {
		if (!this._child) {
			return false;
		}
		try {
			this._child.kill();
			return true;
		} catch {
			return false;
		}
	}

	public async restart(args: string[] = []): Promise<SharedProcessLaunchResult> {
		this.terminate();
		this._child = null;
		this._port = null;
		this._client = null;
		return this.launch(args);
	}

	public override dispose(): void {
		this.terminate();
		super.dispose();
	}
}

export function createSharedProcessLauncher(entryPath?: string): SharedProcessLauncher {
	return new SharedProcessLauncher(entryPath);
}

export function getSharedProcessPath(): string {
	return getSharedProcessEntryPath();
}

export function getSharedProcessBundledPath(): string {
	const appPath = process.env.DC_APP_PATH ?? path.resolve(__dirname, '../../../../');
	return path.join(appPath, 'dist', 'dc', 'launcher', 'main', 'shared-process-channel');
}
