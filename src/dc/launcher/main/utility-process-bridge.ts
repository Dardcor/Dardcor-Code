import { ipcMain, WebContents } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';
import { UtilityProcessRpc, RpcPort } from './utility-process-rpc';

export interface BridgeOptions {
	onEvent?: (serviceName: string, event: string, data: unknown) => void;
}

export class UtilityProcessBridge extends Disposable {
	private readonly _rpc = new UtilityProcessRpc();
	private readonly _proxies = new Map<string, RpcPort>();
	private readonly _options: BridgeOptions;

	constructor(options: BridgeOptions = {}) {
		super();
		this._options = options;
		this._register(toDisposable(() => {
			for (const serviceName of this._proxies.keys()) {
				ipcMain.removeHandler(`utility:call:${serviceName}`);
			}
			ipcMain.removeHandler('utility:list');
			this._proxies.clear();
		}));
	}

	public registerProxy(serviceName: string, port: RpcPort): void {
		this._proxies.set(serviceName, port);
		ipcMain.removeHandler(`utility:call:${serviceName}`);
		ipcMain.handle(`utility:call:${serviceName}`, async (_event: any, method: string, args: unknown[]) => {
			try {
				const result = await this._rpc.call(port, method, args ?? []);
				return { ok: true, result };
			} catch (err) {
				return { ok: false, error: String(err) };
			}
		});
		ipcMain.removeHandler('utility:list');
		ipcMain.handle('utility:list', () => [...this._proxies.keys()]);
	}

	public unregisterProxy(serviceName: string): void {
		this._proxies.delete(serviceName);
		ipcMain.removeHandler(`utility:call:${serviceName}`);
	}

	public hasProxy(serviceName: string): boolean {
		return this._proxies.has(serviceName);
	}

	public getServiceNames(): string[] {
		return [...this._proxies.keys()];
	}

	public sendEvent(serviceName: string, event: string, data: unknown): void {
		this._options.onEvent?.(serviceName, event, data);
	}

	public broadcastEvent(event: string, data: unknown): void {
		for (const serviceName of this._proxies.keys()) {
			this.sendEvent(serviceName, event, data);
		}
	}

	public sendEventToWebContents(webContents: WebContents, serviceName: string, event: string, data: unknown): void {
		if (webContents.isDestroyed()) {
			return;
		}
		webContents.send('utility:event', { serviceName, event, data });
	}

	public override dispose(): void {
		this._rpc.dispose();
		super.dispose();
	}
}

export function createUtilityProcessBridge(options?: BridgeOptions): UtilityProcessBridge {
	return new UtilityProcessBridge(options);
}
