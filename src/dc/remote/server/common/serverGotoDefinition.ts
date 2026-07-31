import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';
import { IServerLocation } from './serverReferenceSearch';

export interface IServerDefinitionProvider {
	readonly id: string;
	provideDefinition(uri: string, position: { line: number; column: number }): Promise<IServerLocation | IServerLocation[] | undefined>;
}

export interface IServerGotoDefinitionService {
	readonly onDidRegisterProvider: Event<IServerDefinitionProvider>;
	registerDefinitionProvider(provider: IServerDefinitionProvider): IDisposable;
	provideDefinition(uri: string, position: { line: number; column: number }): Promise<IServerLocation[]>;
}

export class ServerGotoDefinitionCommon implements IServerGotoDefinitionService {
	private readonly _providers = new Map<string, IServerDefinitionProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerDefinitionProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerDefinitionProvider(provider: IServerDefinitionProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideDefinition(uri: string, position: { line: number; column: number }): Promise<IServerLocation[]> {
		const locations: IServerLocation[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideDefinition(uri, position);
			if (result) {
				if (Array.isArray(result)) {
					locations.push(...result);
				} else {
					locations.push(result);
				}
			}
		}
		return locations;
	}
}
