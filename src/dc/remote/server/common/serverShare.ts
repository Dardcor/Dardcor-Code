import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerShareProvider {
	readonly id: string;
	readonly label: string;
	readonly priority: number;
	provideShare(resourceUri: string): Promise<string | undefined>;
}

export interface IServerShareService {
	readonly onDidRegisterShareProvider: Event<IServerShareProvider>;
	readonly onDidUnregisterShareProvider: Event<string>;
	registerShareProvider(provider: IServerShareProvider): IDisposable;
	getShareProviders(): IServerShareProvider[];
	share(resourceUri: string, providerId?: string): Promise<string | undefined>;
}

export class ServerShareCommon implements IServerShareService {
	private readonly _providers = new Map<string, IServerShareProvider>();

	private readonly _onDidRegisterShareProvider = new Emitter<IServerShareProvider>();
	readonly onDidRegisterShareProvider = this._onDidRegisterShareProvider.event;

	private readonly _onDidUnregisterShareProvider = new Emitter<string>();
	readonly onDidUnregisterShareProvider = this._onDidUnregisterShareProvider.event;

	registerShareProvider(provider: IServerShareProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterShareProvider.fire(provider);
		return {
			dispose: () => {
				this._providers.delete(provider.id);
				this._onDidUnregisterShareProvider.fire(provider.id);
			}
		};
	}

	getShareProviders(): IServerShareProvider[] {
		return Array.from(this._providers.values()).sort((a, b) => b.priority - a.priority);
	}

	async share(resourceUri: string, providerId?: string): Promise<string | undefined> {
		const providers = providerId ? [this._providers.get(providerId)].filter(Boolean) : this.getShareProviders();
		for (const provider of providers) {
			if (provider) {
				const result = await provider.provideShare(resourceUri);
				if (result) return result;
			}
		}
		return undefined;
	}
}
