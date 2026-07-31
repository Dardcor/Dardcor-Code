import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { URI } from '../../core/types/uri.js';

export interface IFileDecoration {
	color?: string;
	badge?: string;
	tooltip?: string;
	propagate?: boolean;
}

export interface IFileDecorationProvider {
	provideFileDecoration(uri: URI): IFileDecoration | Promise<IFileDecoration | undefined> | undefined;
}

export class ExtHostDecorations extends Disposable {
	private readonly _providers: IFileDecorationProvider[] = [];

	public registerFileDecorationProvider(provider: IFileDecorationProvider): IDisposable {
		this._providers.push(provider);
		return toDisposable(() => {
			const index = this._providers.indexOf(provider);
			if (index !== -1) {
				this._providers.splice(index, 1);
			}
		});
	}

	public async provideFileDecoration(uri: URI): Promise<IFileDecoration | undefined> {
		for (const provider of this._providers) {
			const decoration = await provider.provideFileDecoration(uri);
			if (decoration) {
				return decoration;
			}
		}
		return undefined;
	}

	public async provideDecorations(uris: URI[]): Promise<Map<string, IFileDecoration>> {
		const result = new Map<string, IFileDecoration>();
		for (const uri of uris) {
			const decoration = await this.provideFileDecoration(uri);
			if (decoration) {
				result.set(uri.toString(), decoration);
			}
		}
		return result;
	}

	public getProviders(): IFileDecorationProvider[] {
		return this._providers.slice();
	}

	public getProviderCount(): number {
		return this._providers.length;
	}
}
