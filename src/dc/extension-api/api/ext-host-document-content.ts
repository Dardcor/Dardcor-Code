import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { CancellationToken } from '../../core/async/cancellation.js';

export interface ITextDocumentContentProvider {
	provideTextDocumentContent(uri: URI, token: CancellationToken): string | Promise<string | undefined> | undefined;
}

export class ExtHostDocumentContent extends Disposable {
	private readonly _providers = new Map<string, ITextDocumentContentProvider>();
	private readonly _cache = new Map<string, string>();

	private readonly _onDidChangeContent = this._register(new Emitter<URI>());
	readonly onDidChangeContent: Event<URI> = this._onDidChangeContent.event;

	public registerTextDocumentContentProvider(scheme: string, provider: ITextDocumentContentProvider): IDisposable {
		if (this._providers.has(scheme)) {
			throw new Error(`Text document content provider '${scheme}' sudah terdaftar`);
		}
		this._providers.set(scheme, provider);
		return toDisposable(() => {
			this._providers.delete(scheme);
			this._evictByScheme(scheme);
		});
	}

	public async provideTextDocumentContent(uri: URI, token: CancellationToken = CancellationToken.None): Promise<string | undefined> {
		const key = uri.toString();
		const provider = this._providers.get(uri.scheme);
		if (!provider) {
			return this._cache.get(key);
		}
		const content = await provider.provideTextDocumentContent(uri, token);
		if (content !== undefined) {
			this._cache.set(key, content);
		}
		return content;
	}

	public getCachedContent(uri: URI): string | undefined {
		return this._cache.get(uri.toString());
	}

	public hasProvider(scheme: string): boolean {
		return this._providers.has(scheme);
	}

	public getSchemes(): string[] {
		return [...this._providers.keys()];
	}

	public evict(uri: URI): void {
		this._cache.delete(uri.toString());
	}

	public evictByScheme(scheme: string): void {
		this._evictByScheme(scheme);
	}

	public fireDidChange(uri: URI): void {
		this._cache.delete(uri.toString());
		this._onDidChangeContent.fire(uri);
	}

	public clearCache(): void {
		this._cache.clear();
	}

	public getCacheSize(): number {
		return this._cache.size;
	}

	public override dispose(): void {
		this._providers.clear();
		this._cache.clear();
		super.dispose();
	}

	private _evictByScheme(scheme: string): void {
		for (const key of [...this._cache.keys()]) {
			if (key.startsWith(`${scheme}://`)) {
				this._cache.delete(key);
			}
		}
	}
}
