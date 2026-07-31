/**
 * Dardcor Code - Multi-Root Workspace Folder Aggregator (Task 194)
 * Mirrors: vs/platform/workspaces/common/workspaces.ts multi-root workspace
 */

import { URI } from '../../core/types/uri';
import { IWorkspaceFolder } from './workspace-service';
import { WorkspaceFolder } from './workspace-folder';

export class MultiRootWorkspace {
	private readonly _folders: IWorkspaceFolder[] = [];

	constructor(readonly id: string, folders: Array<{ uri: URI; name?: string }> = []) {
		this._folders = folders.map((f, index) => new WorkspaceFolder({ uri: f.uri, name: f.name, index }));
	}

	get folders(): IWorkspaceFolder[] {
		return [...this._folders];
	}

	addFolder(uri: URI, name?: string): IWorkspaceFolder {
		const folder = new WorkspaceFolder({ uri, name, index: this._folders.length });
		this._folders.push(folder);
		return folder;
	}

	removeFolder(uri: URI): boolean {
		const idx = this._folders.findIndex(f => f.uri.toString() === uri.toString());
		if (idx >= 0) {
			this._folders.splice(idx, 1);
			return true;
		}
		return false;
	}
}
