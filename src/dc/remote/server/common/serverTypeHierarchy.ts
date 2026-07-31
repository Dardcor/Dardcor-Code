import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';
import { IServerLocation } from './serverReferenceSearch.js';

export interface IServerTypeHierarchyItem {
	readonly name: string;
	readonly kind: number;
	readonly tags?: number[];
	readonly detail?: string;
	readonly uri: string;
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly selectionRange: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

export interface IServerTypeHierarchyProvider {
	readonly id: string;
	prepareTypeHierarchy(uri: string, position: { line: number; column: number }): Promise<IServerTypeHierarchyItem | IServerTypeHierarchyItem[] | undefined>;
	provideSupertypes(item: IServerTypeHierarchyItem): Promise<IServerTypeHierarchyItem[] | undefined>;
	provideSubtypes(item: IServerTypeHierarchyItem): Promise<IServerTypeHierarchyItem[] | undefined>;
}

export interface IServerTypeHierarchyService {
	readonly onDidRegisterProvider: Event<IServerTypeHierarchyProvider>;
	registerTypeHierarchyProvider(provider: IServerTypeHierarchyProvider): IDisposable;
	prepareTypeHierarchy(uri: string, position: { line: number; column: number }): Promise<IServerTypeHierarchyItem[]>;
	provideSupertypes(item: IServerTypeHierarchyItem): Promise<IServerTypeHierarchyItem[]>;
	provideSubtypes(item: IServerTypeHierarchyItem): Promise<IServerTypeHierarchyItem[]>;
}

export class ServerTypeHierarchyCommon implements IServerTypeHierarchyService {
	private readonly _providers = new Map<string, IServerTypeHierarchyProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerTypeHierarchyProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerTypeHierarchyProvider(provider: IServerTypeHierarchyProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async prepareTypeHierarchy(uri: string, position: { line: number; column: number }): Promise<IServerTypeHierarchyItem[]> {
		const items: IServerTypeHierarchyItem[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.prepareTypeHierarchy(uri, position);
			if (result) {
				if (Array.isArray(result)) {
					items.push(...result);
				} else {
					items.push(result);
				}
			}
		}
		return items;
	}

	async provideSupertypes(item: IServerTypeHierarchyItem): Promise<IServerTypeHierarchyItem[]> {
		const result: IServerTypeHierarchyItem[] = [];
		for (const provider of this._providers.values()) {
			const supers = await provider.provideSupertypes(item);
			if (supers) {
				result.push(...supers);
			}
		}
		return result;
	}

	async provideSubtypes(item: IServerTypeHierarchyItem): Promise<IServerTypeHierarchyItem[]> {
		const result: IServerTypeHierarchyItem[] = [];
		for (const provider of this._providers.values()) {
			const subs = await provider.provideSubtypes(item);
			if (subs) {
				result.push(...subs);
			}
		}
		return result;
	}
}
