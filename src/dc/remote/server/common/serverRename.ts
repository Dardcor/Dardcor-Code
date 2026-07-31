import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerRenameLocation {
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly text: string;
}

export interface IServerWorkspaceEdit {
	readonly edits: { resource: string; textEdit: { range: any; text: string } }[];
}

export interface IServerRenameProvider {
	readonly id: string;
	provideRenameEdits(uri: string, position: { line: number; column: number }, newName: string): Promise<IServerWorkspaceEdit | undefined>;
	resolveRenameLocation?(uri: string, position: { line: number; column: number }): Promise<IServerRenameLocation | undefined>;
}

export interface IServerRenameService {
	readonly onDidRegisterProvider: Event<IServerRenameProvider>;
	registerRenameProvider(provider: IServerRenameProvider): IDisposable;
	provideRenameEdits(uri: string, position: { line: number; column: number }, newName: string): Promise<IServerWorkspaceEdit | undefined>;
	resolveRenameLocation(uri: string, position: { line: number; column: number }): Promise<IServerRenameLocation | undefined>;
}

export class ServerRenameCommon implements IServerRenameService {
	private readonly _providers = new Map<string, IServerRenameProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerRenameProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerRenameProvider(provider: IServerRenameProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideRenameEdits(uri: string, position: { line: number; column: number }, newName: string): Promise<IServerWorkspaceEdit | undefined> {
		for (const provider of this._providers.values()) {
			const result = await provider.provideRenameEdits(uri, position, newName);
			if (result) {
				return result;
			}
		}
		return undefined;
	}

	async resolveRenameLocation(uri: string, position: { line: number; column: number }): Promise<IServerRenameLocation | undefined> {
		for (const provider of this._providers.values()) {
			if (provider.resolveRenameLocation) {
				const result = await provider.resolveRenameLocation(uri, position);
				if (result) {
					return result;
				}
			}
		}
		return undefined;
	}
}
