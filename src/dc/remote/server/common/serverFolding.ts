import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerFoldingRange {
	readonly startLine: number;
	readonly endLine: number;
	readonly type?: 'comment' | 'imports' | 'region';
	readonly isCollapsed?: boolean;
}

export interface IServerFoldingProvider {
	readonly id: string;
	provideFoldingRanges(uri: string): Promise<IServerFoldingRange[]>;
}

export interface IServerFoldingService {
	readonly onDidChangeFoldingRanges: Event<{ uri: string; ranges: IServerFoldingRange[] }>;
	registerFoldingProvider(provider: IServerFoldingProvider): IDisposable;
	getFoldingRanges(uri: string): Promise<IServerFoldingRange[]>;
	setCollapsedState(uri: string, ranges: IServerFoldingRange[]): void;
}

export class ServerFoldingCommon implements IServerFoldingService {
	private readonly _providers = new Map<string, IServerFoldingProvider>();
	private readonly _states = new Map<string, IServerFoldingRange[]>();

	private readonly _onDidChangeFoldingRanges = new Emitter<{ uri: string; ranges: IServerFoldingRange[] }>();
	readonly onDidChangeFoldingRanges = this._onDidChangeFoldingRanges.event;

	registerFoldingProvider(provider: IServerFoldingProvider): IDisposable {
		this._providers.set(provider.id, provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async getFoldingRanges(uri: string): Promise<IServerFoldingRange[]> {
		const ranges: IServerFoldingRange[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideFoldingRanges(uri);
			if (result) {
				ranges.push(...result);
			}
		}
		
		const state = this._states.get(uri);
		if (state) {
			return ranges.map(r => {
				const existing = state.find(s => s.startLine === r.startLine && s.endLine === r.endLine);
				return existing ? { ...r, isCollapsed: existing.isCollapsed } : r;
			});
		}
		return ranges;
	}

	setCollapsedState(uri: string, ranges: IServerFoldingRange[]): void {
		this._states.set(uri, ranges);
		this._onDidChangeFoldingRanges.fire({ uri, ranges });
	}
}
