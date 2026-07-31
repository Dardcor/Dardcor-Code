import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerRemoteViewEntry {
	readonly id: string;
	readonly name: string;
	readonly type: 'ssh' | 'wsl' | 'devContainer' | 'tunnel';
	readonly isConnected: boolean;
}

export interface IServerRemoteViewService {
	readonly onDidChangeRemotes: Event<void>;
	readonly onDidChangeConnection: Event<{ id: string; isConnected: boolean }>;
	getRemotes(): IServerRemoteViewEntry[];
	addRemote(entry: IServerRemoteViewEntry): void;
	removeRemote(id: string): void;
	connectRemote(id: string): Promise<void>;
	disconnectRemote(id: string): Promise<void>;
}

export class ServerRemoteViewCommon implements IServerRemoteViewService {
	private readonly _remotes = new Map<string, IServerRemoteViewEntry>();

	private readonly _onDidChangeRemotes = new Emitter<void>();
	readonly onDidChangeRemotes = this._onDidChangeRemotes.event;

	private readonly _onDidChangeConnection = new Emitter<{ id: string; isConnected: boolean }>();
	readonly onDidChangeConnection = this._onDidChangeConnection.event;

	getRemotes(): IServerRemoteViewEntry[] {
		return Array.from(this._remotes.values());
	}

	addRemote(entry: IServerRemoteViewEntry): void {
		this._remotes.set(entry.id, entry);
		this._onDidChangeRemotes.fire();
	}

	removeRemote(id: string): void {
		this._remotes.delete(id);
		this._onDidChangeRemotes.fire();
	}

	async connectRemote(id: string): Promise<void> {
		const remote = this._remotes.get(id);
		if (remote && !remote.isConnected) {
			(remote as any).isConnected = true;
			this._onDidChangeConnection.fire({ id, isConnected: true });
		}
	}

	async disconnectRemote(id: string): Promise<void> {
		const remote = this._remotes.get(id);
		if (remote && remote.isConnected) {
			(remote as any).isConnected = false;
			this._onDidChangeConnection.fire({ id, isConnected: false });
		}
	}
}
