import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerLocation {
	readonly uri: string;
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

export interface IServerReferenceProvider {
	readonly id: string;
	provideReferences(uri: string, position: { line: number; column: number }, context: { includeDeclaration: boolean }): Promise<IServerLocation[] | undefined>;
}

export interface IServerReferenceSearchService {
	readonly onDidRegisterProvider: Event<IServerReferenceProvider>;
	registerReferenceProvider(provider: IServerReferenceProvider): IDisposable;
	provideReferences(uri: string, position: { line: number; column: number }, context: { includeDeclaration: boolean }): Promise<IServerLocation[]>;
}

export class ServerReferenceSearchCommon implements IServerReferenceSearchService {
	private readonly _providers = new Map<string, IServerReferenceProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerReferenceProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerReferenceProvider(provider: IServerReferenceProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideReferences(uri: string, position: { line: number; column: number }, context: { includeDeclaration: boolean }): Promise<IServerLocation[]> {
		const locations: IServerLocation[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideReferences(uri, position, context);
			if (result) {
				locations.push(...result);
			}
		}
		return locations;
	}
}
