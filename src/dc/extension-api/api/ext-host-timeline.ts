import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';

export interface ITimelineItem {
	readonly id: string;
	readonly label: string;
	readonly timestamp: number;
	description?: string;
	detail?: string;
	tooltip?: string;
}

export interface ITimelineOptions {
	cursor?: string;
	limit?: number;
}

export interface ITimelineResult {
	items: ITimelineItem[];
	cursor?: string;
}

export interface ITimelineProvider {
	provideTimeline(uri: URI, options: ITimelineOptions): ITimelineResult | Promise<ITimelineResult | undefined> | undefined;
}

export class ExtHostTimeline extends Disposable {
	private readonly _providers: ITimelineProvider[] = [];
	private readonly _items = new Map<string, ITimelineItem[]>();

	private readonly _onDidChangeTimeline = this._register(new Emitter<URI>());
	readonly onDidChangeTimeline: Event<URI> = this._onDidChangeTimeline.event;

	public registerTimelineProvider(provider: ITimelineProvider): IDisposable {
		this._providers.push(provider);
		return toDisposable(() => {
			const index = this._providers.indexOf(provider);
			if (index !== -1) {
				this._providers.splice(index, 1);
			}
		});
	}

	public async provideTimeline(uri: URI, options: ITimelineOptions = {}): Promise<ITimelineResult> {
		const merged: ITimelineItem[] = [];
		let cursor: string | undefined;
		for (const provider of this._providers) {
			const result = await provider.provideTimeline(uri, options);
			if (result) {
				merged.push(...result.items);
				cursor = result.cursor ?? cursor;
			}
		}
		merged.sort((a, b) => b.timestamp - a.timestamp);
		const limit = options.limit ?? merged.length;
		const items = merged.slice(0, limit);
		this._items.set(uri.toString(), items);
		return { items, cursor };
	}

	public getItems(uri: URI): ITimelineItem[] {
		return [...(this._items.get(uri.toString()) ?? [])];
	}

	public getItem(uri: URI, itemId: string): ITimelineItem | undefined {
		return this.getItems(uri).find(item => item.id === itemId);
	}

	public hasProviders(): boolean {
		return this._providers.length > 0;
	}

	public getProviderCount(): number {
		return this._providers.length;
	}
}
