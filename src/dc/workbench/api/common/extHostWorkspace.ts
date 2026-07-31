import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostWorkspace {
	private _workspaceFolders: any[] | undefined;

	private readonly _onDidChangeWorkspaceFolders = new Emitter<any>();
	readonly onDidChangeWorkspaceFolders = this._onDidChangeWorkspaceFolders.event;

	get workspaceFolders(): any[] | undefined {
		return this._workspaceFolders;
	}

	getWorkspaceFolder(uri: any): any | undefined {
		if (!this._workspaceFolders) {
			return undefined;
		}
		// Simplified matching
		return this._workspaceFolders[0];
	}

	$acceptWorkspaceData(data: any): void {
		this._workspaceFolders = data;
		this._onDidChangeWorkspaceFolders.fire(data);
	}
}
