import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerTimelineItem {
	readonly id: string;
	readonly timestamp: number;
	readonly label: string;
	readonly description?: string;
	readonly detail?: string;
	readonly iconUrl?: string;
	readonly command?: { id: string; title: string; arguments?: any[] };
	readonly contextValue?: string;
}

export interface IServerTimelineProvider {
	readonly id: string;
	readonly label: string;
	readonly onDidChange: Event<string | undefined>;
	provideTimeline(uri: string, cursor?: string): Promise<{ items: IServerTimelineItem[]; cursor?: string }>;
}

export interface IServerTimelineService {
	readonly onDidChangeProviders: Event<void>;
	readonly onDidChangeTimeline: Event<{ uri: string; providerId?: string }>;
	registerTimelineProvider(provider: IServerTimelineProvider): IDisposable;
	unregisterTimelineProvider(id: string): void;
	getTimeline(uri: string, providerId?: string): Promise<IServerTimelineItem[]>;
	getProviders(): IServerTimelineProvider[];
}

export class ServerTimelineCommon implements IServerTimelineService {
	private readonly _providers = new Map<string, IServerTimelineProvider>();

	private readonly _onDidChangeProviders = new Emitter<void>();
	readonly onDidChangeProviders: Event<void> = this._onDidChangeProviders.event;

	private readonly _onDidChangeTimeline = new Emitter<{ uri: string; providerId?: string }>();
	readonly onDidChangeTimeline: Event<{ uri: string; providerId?: string }> = this._onDidChangeTimeline.event;

	registerTimelineProvider(provider: IServerTimelineProvider): IDisposable {
		this._providers.set(provider.id, provider);
		const sub = provider.onDidChange(uri => this._onDidChangeTimeline.fire({ uri: uri || '', providerId: provider.id }));
		this._onDidChangeProviders.fire();
		return {
			dispose: () => {
				sub.dispose();
				this._providers.delete(provider.id);
				this._onDidChangeProviders.fire();
			}
		};
	}

	unregisterTimelineProvider(id: string): void {
		this._providers.delete(id);
		this._onDidChangeProviders.fire();
	}

	async getTimeline(uri: string, providerId?: string): Promise<IServerTimelineItem[]> {
		const providers = providerId ? [this._providers.get(providerId)].filter(Boolean) : Array.from(this._providers.values());
		const results: IServerTimelineItem[] = [];
		for (const provider of providers) {
			if (provider) {
				const timeline = await provider.provideTimeline(uri);
				results.push(...timeline.items);
			}
		}
		return results.sort((a, b) => b.timestamp - a.timestamp);
	}

	getProviders(): IServerTimelineProvider[] {
		return Array.from(this._providers.values());
	}
}
