import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';
import { IServerLocation } from './serverReferenceSearch';

export interface IServerCallHierarchyItem {
	readonly name: string;
	readonly kind: number;
	readonly tags?: number[];
	readonly detail?: string;
	readonly uri: string;
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly selectionRange: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

export interface IServerCallHierarchyIncomingCall {
	readonly from: IServerCallHierarchyItem;
	readonly fromRanges: { startLine: number; startColumn: number; endLine: number; endColumn: number }[];
}

export interface IServerCallHierarchyOutgoingCall {
	readonly to: IServerCallHierarchyItem;
	readonly fromRanges: { startLine: number; startColumn: number; endLine: number; endColumn: number }[];
}

export interface IServerCallHierarchyProvider {
	readonly id: string;
	prepareCallHierarchy(uri: string, position: { line: number; column: number }): Promise<IServerCallHierarchyItem | IServerCallHierarchyItem[] | undefined>;
	provideCallHierarchyIncomingCalls(item: IServerCallHierarchyItem): Promise<IServerCallHierarchyIncomingCall[] | undefined>;
	provideCallHierarchyOutgoingCalls(item: IServerCallHierarchyItem): Promise<IServerCallHierarchyOutgoingCall[] | undefined>;
}

export interface IServerCallHierarchyService {
	readonly onDidRegisterProvider: Event<IServerCallHierarchyProvider>;
	registerCallHierarchyProvider(provider: IServerCallHierarchyProvider): IDisposable;
	prepareCallHierarchy(uri: string, position: { line: number; column: number }): Promise<IServerCallHierarchyItem[]>;
	provideCallHierarchyIncomingCalls(item: IServerCallHierarchyItem): Promise<IServerCallHierarchyIncomingCall[]>;
	provideCallHierarchyOutgoingCalls(item: IServerCallHierarchyItem): Promise<IServerCallHierarchyOutgoingCall[]>;
}

export class ServerCallHierarchyCommon implements IServerCallHierarchyService {
	private readonly _providers = new Map<string, IServerCallHierarchyProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerCallHierarchyProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerCallHierarchyProvider(provider: IServerCallHierarchyProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async prepareCallHierarchy(uri: string, position: { line: number; column: number }): Promise<IServerCallHierarchyItem[]> {
		const items: IServerCallHierarchyItem[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.prepareCallHierarchy(uri, position);
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

	async provideCallHierarchyIncomingCalls(item: IServerCallHierarchyItem): Promise<IServerCallHierarchyIncomingCall[]> {
		const calls: IServerCallHierarchyIncomingCall[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideCallHierarchyIncomingCalls(item);
			if (result) {
				calls.push(...result);
			}
		}
		return calls;
	}

	async provideCallHierarchyOutgoingCalls(item: IServerCallHierarchyItem): Promise<IServerCallHierarchyOutgoingCall[]> {
		const calls: IServerCallHierarchyOutgoingCall[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideCallHierarchyOutgoingCalls(item);
			if (result) {
				calls.push(...result);
			}
		}
		return calls;
	}
}
