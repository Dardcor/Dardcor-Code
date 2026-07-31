import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerStickyScrollLine {
	readonly text: string;
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	readonly isFolded?: boolean;
}

export interface IServerStickyScrollProvider {
	readonly id: string;
	provideStickyScroll(uri: string, visibleRange: { startLine: number; endLine: number }): Promise<IServerStickyScrollLine[]>;
}

export interface IServerStickyScrollService {
	readonly onDidRegisterProvider: Event<IServerStickyScrollProvider>;
	registerProvider(provider: IServerStickyScrollProvider): IDisposable;
	provideStickyScroll(uri: string, visibleRange: { startLine: number; endLine: number }): Promise<IServerStickyScrollLine[]>;
}

export class ServerStickyScrollCommon implements IServerStickyScrollService {
	private readonly _providers = new Map<string, IServerStickyScrollProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerStickyScrollProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerProvider(provider: IServerStickyScrollProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideStickyScroll(uri: string, visibleRange: { startLine: number; endLine: number }): Promise<IServerStickyScrollLine[]> {
		const lines: IServerStickyScrollLine[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideStickyScroll(uri, visibleRange);
			if (result) {
				lines.push(...result);
			}
		}
		return lines.sort((a, b) => a.startLineNumber - b.startLineNumber);
	}
}
