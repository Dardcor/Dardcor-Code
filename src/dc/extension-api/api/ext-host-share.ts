import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { URI } from '../../core/types/uri.js';

export interface IShareSelector {
	scheme?: string;
	language?: string;
}

export interface IShareProvider {
	provideShare(uri: URI): string | Promise<string | undefined> | undefined;
}

interface IShareProviderRegistration {
	readonly selector: IShareSelector;
	readonly provider: IShareProvider;
}

export class ExtHostShare extends Disposable {
	private readonly _providers: IShareProviderRegistration[] = [];

	public registerShareProvider(selector: IShareSelector, provider: IShareProvider): IDisposable {
		const registration: IShareProviderRegistration = { selector, provider };
		this._providers.push(registration);
		return toDisposable(() => {
			const index = this._providers.indexOf(registration);
			if (index !== -1) {
				this._providers.splice(index, 1);
			}
		});
	}

	public async share(uri: URI, languageId?: string): Promise<string | undefined> {
		for (const registration of this._providers) {
			if (!this._matches(registration.selector, uri, languageId)) {
				continue;
			}
			const result = await registration.provider.provideShare(uri);
			if (result !== undefined) {
				return result;
			}
		}
		return undefined;
	}

	public hasProvider(uri: URI, languageId?: string): boolean {
		return this._providers.some(registration => this._matches(registration.selector, uri, languageId));
	}

	public getProviders(): IShareProviderRegistration[] {
		return this._providers.slice();
	}

	public override dispose(): void {
		this._providers.length = 0;
		super.dispose();
	}

	private _matches(selector: IShareSelector, uri: URI, languageId: string | undefined): boolean {
		if (selector.scheme && selector.scheme !== uri.scheme) {
			return false;
		}
		if (selector.language && selector.language !== languageId) {
			return false;
		}
		return true;
	}
}
