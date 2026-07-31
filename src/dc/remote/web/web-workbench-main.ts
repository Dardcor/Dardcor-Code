/**
 * Dardcor Code - Browser-Only Web Application Entry Point (Vite Target) (Task 807)
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { $, clearNode } from '../../core/dom/element';
import { WorkbenchLayout } from '../../app-shell/layout/workbench-layout';
import { WebSocketClientBridge } from '../transport/web-socket-client';
import { ConnectionMultiplexer, IRemoteChannelClient } from '../transport/connection-multiplexer';
import { RemoteFileProvider } from '../files/remote-file-provider';
import { RemoteWorkspaceState } from '../session/remote-workspace-state';
import { HeartbeatMonitor, HeartbeatState } from '../session/heartbeat-monitor';
import { encodeHeartbeatPing, encodeHeartbeatPong, decodeHeartbeat } from '../transport/heartbeat-protocol';
import { RemotePtyClient } from '../terminal/remote-pty-service';
import { URI } from '../../core/types/uri';
import { IFileStat } from '../../services/files/file-service';

export interface IWebWorkbenchConfig {
	readonly serverUrl: string;
	readonly token?: string;
	readonly workspacePath?: string;
}

export class WebWorkbenchHost extends Disposable {
	private readonly _layout: WorkbenchLayout;
	private readonly _statusText: HTMLElement;
	private readonly _fileList: HTMLElement;
	private readonly _editor: HTMLTextAreaElement;
	private readonly _infoBar: HTMLElement;

	private _bridge: WebSocketClientBridge | null = null;
	private _multiplexer: ConnectionMultiplexer | null = null;
	private _fileProvider: RemoteFileProvider | null = null;
	private _workspaceState: RemoteWorkspaceState | null = null;
	private _heartbeat: HeartbeatMonitor | null = null;
	private _ptyClient: RemotePtyClient | null = null;
	private _connected = false;
	private _selectedFile: string | null = null;

	private readonly _channels = new Map<string, IRemoteChannelClient>();

	constructor(
		private readonly _root: HTMLElement,
		private readonly _config: IWebWorkbenchConfig
	) {
		super();
		if (typeof document === 'undefined') {
			throw new Error('WebWorkbenchHost only runs in a browser');
		}
		this._layout = this._register(new WorkbenchLayout(_root));
		this._layout.titleBarDom.textContent = 'Dardcor Code - Remote Workbench';
		this._statusText = $<HTMLElement>('span', 'dc-web-status');
		this._layout.statusBarDom.appendChild(this._statusText);
		this._infoBar = $<HTMLElement>('div', 'dc-web-infobar');
		this._infoBar.style.cssText = 'font-size:12px;color:#9d9d9d;padding:8px 12px;';
		this._fileList = $<HTMLElement>('div', 'dc-web-files');
		this._fileList.style.cssText = 'flex:1;overflow:auto;padding:4px 0;';
		this._layout.sideBarDom.appendChild(this._fileList);
		this._layout.editorPartDom.appendChild(this._infoBar);
		this._editor = $<HTMLTextAreaElement>('textarea', 'dc-web-editor');
		this._editor.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;resize:none;border:none;outline:none;background:#1e1e1e;color:#d4d4d4;font-family:Consolas, monospace;font-size:13px;padding:12px;box-sizing:border-box;white-space:pre;';
		this._editor.spellcheck = false;
		this._layout.editorPartDom.appendChild(this._editor);
		this._setStatus('Disconnected');

		this._editor.addEventListener('input', () => {
			if (this._selectedFile) {
				this._workspaceState?.setDirty(this._selectedFile, true);
			}
		});
	}

	get isConnected(): boolean {
		return this._connected;
	}

	get channelCount(): number {
		return this._channels.size;
	}

	async connect(): Promise<void> {
		if (this._connected) {
			return;
		}
		this._setStatus('Connecting...');
		const bridge = new WebSocketClientBridge(this._config.serverUrl);
		this._bridge = this._register(bridge);

		await new Promise<void>((resolvePromise, reject) => {
			const timeout = setTimeout(() => reject(new Error('Connection timed out')), 10000);
			bridge.onOpen(() => {
				clearTimeout(timeout);
				resolvePromise();
			});
			bridge.onError(error => reject(error));
			bridge.connect();
		});

		const multiplexer = new ConnectionMultiplexer({
			onMessage: bridge.onMessage,
			send: data => bridge.send(data),
			close: () => bridge.close()
		});
		this._multiplexer = this._register(multiplexer);
		this._register(multiplexer.onError(error => this._setStatus(`Channel error: ${error.message}`)));

		const filesChannel = multiplexer.getChannel('files');
		this._fileProvider = this._register(new RemoteFileProvider(filesChannel, 'remote'));
		this._channels.set('files', filesChannel);

		const stateChannel = multiplexer.getChannel('workspaceState');
		this._workspaceState = this._register(new RemoteWorkspaceState());
		this._workspaceState.bindChannel(stateChannel);
		this._channels.set('workspaceState', stateChannel);

		const ptyChannel = multiplexer.getChannel('pty');
		this._ptyClient = this._register(new RemotePtyClient(ptyChannel));
		this._channels.set('pty', ptyChannel);

		const send = (data: string): void => { void bridge.send(data); };
		this._heartbeat = this._register(new HeartbeatMonitor({
			sendPing: payload => send(encodeHeartbeatPing(payload.seq)),
			sendPong: payload => send(encodeHeartbeatPong(payload.seq))
		}, { intervalMs: 5000, timeoutMs: 8000 }));
		this._register(bridge.onMessage(data => {
			const text = new TextDecoder().decode(data);
			const heartbeat = decodeHeartbeat(text);
			if (heartbeat) {
				this._heartbeat?.handleIncomingMessage(text);
			}
		}));
		this._register(this._heartbeat.onLatency(latency => {
			this._infoBar.textContent = `Latency: ${latency}ms`;
		}));
		this._register(this._heartbeat.onStateChange(state => {
			if (state === HeartbeatState.Unreachable) {
				this._setStatus('Connection lost - waiting for heartbeat');
			}
		}));

		this._connected = true;
		this._setStatus('Connected');
		this._register(this._fileProvider.onDidChangeFile(() => {
			this._refreshFileList();
		}));
		await this._refreshFileList();
	}

	async openFile(path: string): Promise<void> {
		if (!this._fileProvider) {
			return;
		}
		try {
			const resource = URI.from({ scheme: 'remote', path });
			const content = await this._fileProvider.readFile(resource);
			this._editor.value = new TextDecoder().decode(content);
			this._selectedFile = path;
			this._workspaceState?.openFile(path);
			this._infoBar.textContent = path;
		} catch (error) {
			this._infoBar.textContent = `Failed to open: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	async saveFile(): Promise<void> {
		if (!this._fileProvider || !this._selectedFile) {
			return;
		}
		try {
			const resource = URI.from({ scheme: 'remote', path: this._selectedFile });
			await this._fileProvider.writeFile(resource, new TextEncoder().encode(this._editor.value), { create: true, overwrite: true });
			this._workspaceState?.setDirty(this._selectedFile, false);
			this._infoBar.textContent = `Saved ${this._selectedFile}`;
		} catch (error) {
			this._infoBar.textContent = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	async createTerminal(): Promise<string | undefined> {
		if (!this._ptyClient) {
			return undefined;
		}
		return this._ptyClient.createPty({ cols: 80, rows: 24 });
	}

	disconnect(): void {
		if (this._heartbeat) {
			this._heartbeat.stop();
		}
		this._connected = false;
		this._setStatus('Disconnected');
	}

	private async _refreshFileList(): Promise<void> {
		if (!this._fileProvider) {
			return;
		}
		clearNode(this._fileList);
		const rootPath = this._config.workspacePath ?? '/';
		let entries: [string, IFileStat][];
		try {
			entries = await this._fileProvider.readdir(URI.from({ scheme: 'remote', path: rootPath }));
		} catch {
			entries = [];
		}
		for (const [name, stat] of entries) {
			const item = $<HTMLElement>('div', 'dc-web-file');
			item.textContent = stat.isDirectory ? `[${name}]` : name;
			item.style.cssText = 'padding:3px 10px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
			item.addEventListener('click', () => {
				if (!stat.isDirectory) {
					void this.openFile(`${rootPath === '/' ? '' : rootPath}/${name}`);
				}
			});
			this._fileList.appendChild(item);
		}
	}

	private _setStatus(text: string): void {
		this._statusText.textContent = text;
	}

	override dispose(): void {
		this.disconnect();
		this._channels.clear();
		super.dispose();
	}
}

export async function webWorkbenchMain(root: HTMLElement, config: IWebWorkbenchConfig): Promise<WebWorkbenchHost> {
	const host = new WebWorkbenchHost(root, config);
	await host.connect();
	return host;
}
