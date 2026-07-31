import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerWorkspaceIdentifier {
	readonly id: string;
	readonly configPath: string;
}

export interface IServerWorkspacesService {
	readonly onDidChangeRecentlyOpened: Event<void>;
	createUntitledWorkspace(folders?: { uri: string; name?: string }[], remoteAuthority?: string): Promise<IServerWorkspaceIdentifier>;
	deleteUntitledWorkspace(workspace: IServerWorkspaceIdentifier): Promise<void>;
	getUntitledWorkspaces(): Promise<IServerWorkspaceIdentifier[]>;
	getRecentlyOpened(): Promise<{ workspaces: IServerWorkspaceIdentifier[]; files: string[] }>;
	addRecentlyOpened(workspaces: IServerWorkspaceIdentifier[], files: string[]): Promise<void>;
	removeRecentlyOpened(workspaces: IServerWorkspaceIdentifier[], files: string[]): Promise<void>;
	clearRecentlyOpened(): Promise<void>;
}

export class ServerWorkspacesCommon implements IServerWorkspacesService {
	private readonly _untitledWorkspaces: IServerWorkspaceIdentifier[] = [];
	private readonly _recentWorkspaces: IServerWorkspaceIdentifier[] = [];
	private readonly _recentFiles: string[] = [];
	private _nextId = 1;

	private readonly _onDidChangeRecentlyOpened = new Emitter<void>();
	readonly onDidChangeRecentlyOpened = this._onDidChangeRecentlyOpened.event;

	async createUntitledWorkspace(_folders?: { uri: string; name?: string }[], _remoteAuthority?: string): Promise<IServerWorkspaceIdentifier> {
		const id = `untitled-${this._nextId++}`;
		const workspace: IServerWorkspaceIdentifier = { id, configPath: `untitled:${id}.code-workspace` };
		this._untitledWorkspaces.push(workspace);
		return workspace;
	}

	async deleteUntitledWorkspace(workspace: IServerWorkspaceIdentifier): Promise<void> {
		const idx = this._untitledWorkspaces.findIndex(w => w.id === workspace.id);
		if (idx >= 0) {
			this._untitledWorkspaces.splice(idx, 1);
		}
	}

	async getUntitledWorkspaces(): Promise<IServerWorkspaceIdentifier[]> {
		return [...this._untitledWorkspaces];
	}

	async getRecentlyOpened(): Promise<{ workspaces: IServerWorkspaceIdentifier[]; files: string[] }> {
		return {
			workspaces: [...this._recentWorkspaces],
			files: [...this._recentFiles]
		};
	}

	async addRecentlyOpened(workspaces: IServerWorkspaceIdentifier[], files: string[]): Promise<void> {
		let changed = false;
		for (const w of workspaces) {
			if (!this._recentWorkspaces.some(rw => rw.id === w.id)) {
				this._recentWorkspaces.unshift(w);
				changed = true;
			}
		}
		for (const f of files) {
			if (!this._recentFiles.includes(f)) {
				this._recentFiles.unshift(f);
				changed = true;
			}
		}
		if (changed) {
			this._onDidChangeRecentlyOpened.fire();
		}
	}

	async removeRecentlyOpened(workspaces: IServerWorkspaceIdentifier[], files: string[]): Promise<void> {
		let changed = false;
		for (const w of workspaces) {
			const idx = this._recentWorkspaces.findIndex(rw => rw.id === w.id);
			if (idx >= 0) {
				this._recentWorkspaces.splice(idx, 1);
				changed = true;
			}
		}
		for (const f of files) {
			const idx = this._recentFiles.indexOf(f);
			if (idx >= 0) {
				this._recentFiles.splice(idx, 1);
				changed = true;
			}
		}
		if (changed) {
			this._onDidChangeRecentlyOpened.fire();
		}
	}

	async clearRecentlyOpened(): Promise<void> {
		this._recentWorkspaces.length = 0;
		this._recentFiles.length = 0;
		this._onDidChangeRecentlyOpened.fire();
	}
}
