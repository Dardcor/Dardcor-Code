import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerWorkspaceFolder {
	readonly uri: string;
	readonly name: string;
	readonly index: number;
}

export interface IServerWorkspace {
	readonly id: string;
	readonly folders: IServerWorkspaceFolder[];
}

export interface IServerWorkspaceService {
	readonly onDidChangeWorkspaceFolders: Event<{ added: IServerWorkspaceFolder[]; removed: IServerWorkspaceFolder[] }>;
	readonly onDidChangeWorkspaceName: Event<string>;
	getWorkspace(): IServerWorkspace;
	getWorkspaceFolder(uri: string): IServerWorkspaceFolder | undefined;
	addFolders(folders: { uri: string; name?: string }[], index?: number): void;
	removeFolders(uris: string[]): void;
}

export class ServerWorkspaceCommon implements IServerWorkspaceService {
	private _workspace: IServerWorkspace = { id: 'default-workspace', folders: [] };

	private readonly _onDidChangeWorkspaceFolders = new Emitter<{ added: IServerWorkspaceFolder[]; removed: IServerWorkspaceFolder[] }>();
	readonly onDidChangeWorkspaceFolders = this._onDidChangeWorkspaceFolders.event;

	private readonly _onDidChangeWorkspaceName = new Emitter<string>();
	readonly onDidChangeWorkspaceName = this._onDidChangeWorkspaceName.event;

	getWorkspace(): IServerWorkspace {
		return this._workspace;
	}

	getWorkspaceFolder(uri: string): IServerWorkspaceFolder | undefined {
		return this._workspace.folders.find(f => uri.startsWith(f.uri));
	}

	addFolders(folders: { uri: string; name?: string }[], index?: number): void {
		const added: IServerWorkspaceFolder[] = [];
		const insertIndex = index ?? this._workspace.folders.length;

		folders.forEach((f, i) => {
			const folder: IServerWorkspaceFolder = {
				uri: f.uri,
				name: f.name || `Folder ${insertIndex + i}`,
				index: insertIndex + i
			};
			added.push(folder);
		});

		const newFolders = [...this._workspace.folders];
		newFolders.splice(insertIndex, 0, ...added);

		newFolders.forEach((f, i) => { (f as any).index = i; });
		this._workspace = { ...this._workspace, folders: newFolders };

		this._onDidChangeWorkspaceFolders.fire({ added, removed: [] });
	}

	removeFolders(uris: string[]): void {
		const removed: IServerWorkspaceFolder[] = [];
		const newFolders = this._workspace.folders.filter(f => {
			if (uris.includes(f.uri)) {
				removed.push(f);
				return false;
			}
			return true;
		});

		newFolders.forEach((f, i) => { (f as any).index = i; });
		this._workspace = { ...this._workspace, folders: newFolders };

		if (removed.length > 0) {
			this._onDidChangeWorkspaceFolders.fire({ added: [], removed });
		}
	}
}
