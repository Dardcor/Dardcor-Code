import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerHover {
	readonly contents: string[];
	readonly range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

export interface IServerHoverProvider {
	readonly id: string;
	provideHover(uri: string, position: { line: number; column: number }): Promise<IServerHover | undefined>;
}

export interface IServerHoverService {
	readonly onDidRegisterProvider: Event<IServerHoverProvider>;
	registerHoverProvider(provider: IServerHoverProvider): IDisposable;
	provideHover(uri: string, position: { line: number; column: number }): Promise<IServerHover[]>;
}

export class ServerHoverCommon implements IServerHoverService {
	private readonly _providers = new Map<string, IServerHoverProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerHoverProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerHoverProvider(provider: IServerHoverProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideHover(uri: string, position: { line: number; column: number }): Promise<IServerHover[]> {
		const hovers: IServerHover[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideHover(uri, position);
			if (result) {
				hovers.push(result);
			}
		}
		return hovers;
	}
}
