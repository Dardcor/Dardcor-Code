import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerLinkedEditingRanges {
	readonly ranges: { startLine: number; startColumn: number; endLine: number; endColumn: number }[];
	readonly wordPattern?: RegExp;
}

export interface IServerLinkedEditingRangeProvider {
	readonly id: string;
	provideLinkedEditingRanges(uri: string, position: { line: number; column: number }): Promise<IServerLinkedEditingRanges | undefined>;
}

export interface IServerLinkedEditingService {
	readonly onDidRegisterProvider: Event<IServerLinkedEditingRangeProvider>;
	registerProvider(provider: IServerLinkedEditingRangeProvider): IDisposable;
	provideLinkedEditingRanges(uri: string, position: { line: number; column: number }): Promise<IServerLinkedEditingRanges | undefined>;
}

export class ServerLinkedEditingCommon implements IServerLinkedEditingService {
	private readonly _providers = new Map<string, IServerLinkedEditingRangeProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerLinkedEditingRangeProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerProvider(provider: IServerLinkedEditingRangeProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideLinkedEditingRanges(uri: string, position: { line: number; column: number }): Promise<IServerLinkedEditingRanges | undefined> {
		for (const provider of this._providers.values()) {
			const result = await provider.provideLinkedEditingRanges(uri, position);
			if (result) {
				return result;
			}
		}
		return undefined;
	}
}
