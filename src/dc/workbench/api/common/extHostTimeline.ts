import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTimeline {
	private readonly _providers = new Map<string, any>();
	
	private readonly _onDidChangeTimeline = new Emitter<any>();
	readonly onDidChangeTimeline = this._onDidChangeTimeline.event;

	registerTimelineProvider(provider: any): IDisposable {
		this._providers.set(provider.id, provider);
		
		if (provider.onDidChange) {
			provider.onDidChange((e: any) => this._onDidChangeTimeline.fire(e));
		}

		return {
			dispose: () => {
				this._providers.delete(provider.id);
			}
		};
	}

	async provideTimeline(uri: any, options: any): Promise<any> {
		// Mock implementation
		return undefined;
	}
}
