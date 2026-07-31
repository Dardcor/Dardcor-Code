import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerInlayHint {
	readonly position: { line: number; column: number };
	readonly label: string | { label: string; tooltip?: string }[];
	readonly tooltip?: string;
	readonly kind?: 'type' | 'parameter';
}

export interface IServerInlayHintsProvider {
	readonly id: string;
	provideInlayHints(uri: string, range: any): Promise<IServerInlayHint[]>;
}

export interface IServerInlayHintsService {
	readonly onDidRegisterProvider: Event<IServerInlayHintsProvider>;
	registerProvider(provider: IServerInlayHintsProvider): IDisposable;
	getInlayHints(uri: string, range: any): Promise<IServerInlayHint[]>;
}

export class ServerInlayHintsCommon implements IServerInlayHintsService {
	private readonly _providers = new Map<string, IServerInlayHintsProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerInlayHintsProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerProvider(provider: IServerInlayHintsProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async getInlayHints(uri: string, range: any): Promise<IServerInlayHint[]> {
		const hints: IServerInlayHint[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideInlayHints(uri, range);
			if (result) {
				hints.push(...result);
			}
		}
		return hints;
	}
}
