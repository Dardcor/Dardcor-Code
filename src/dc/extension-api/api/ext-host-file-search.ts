import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { URI } from '../../core/types/uri';
import { CancellationToken } from '../../core/async/cancellation';

export interface IFileSearchOptions {
	maxResults?: number;
	folderUri?: URI;
	excludePattern?: string;
}

export interface IFileSearchProvider {
	provideFileSearchResults(query: string, options: IFileSearchOptions, token: CancellationToken): URI[] | Promise<URI[]> | undefined;
}

export interface IFileSearchMatch {
	readonly uri: URI;
	readonly providerId: number;
}

export class ExtHostFileSearch extends Disposable {
	private readonly _providers: Array<{ id: number; provider: IFileSearchProvider }> = [];
	private _nextProviderId = 1;

	public registerFileSearchProvider(provider: IFileSearchProvider): IDisposable {
		const id = this._nextProviderId++;
		this._providers.push({ id, provider });
		return toDisposable(() => {
			const index = this._providers.findIndex(entry => entry.id === id);
			if (index !== -1) {
				this._providers.splice(index, 1);
			}
		});
	}

	public async search(query: string, options: IFileSearchOptions = {}, token: CancellationToken = CancellationToken.None): Promise<URI[]> {
		const results: URI[] = [];
		for (const entry of this._providers) {
			if (token.isCancellationRequested) {
				break;
			}
			const found = await entry.provider.provideFileSearchResults(query, options, token);
			if (found) {
				results.push(...found);
				if (options.maxResults !== undefined && results.length >= options.maxResults) {
					break;
				}
			}
		}
		return results;
	}

	public async searchWithMeta(query: string, options: IFileSearchOptions = {}, token: CancellationToken = CancellationToken.None): Promise<IFileSearchMatch[]> {
		const results: IFileSearchMatch[] = [];
		for (const entry of this._providers) {
			if (token.isCancellationRequested) {
				break;
			}
			const found = await entry.provider.provideFileSearchResults(query, options, token);
			if (found) {
				for (const uri of found) {
					results.push({ uri, providerId: entry.id });
				}
				if (options.maxResults !== undefined && results.length >= options.maxResults) {
					break;
				}
			}
		}
		return results;
	}

	public getProviders(): IFileSearchProvider[] {
		return this._providers.map(entry => entry.provider);
	}

	public getProviderCount(): number {
		return this._providers.length;
	}
}
