import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerBreadcrumbsItem {
	readonly name: string;
	readonly kind: number;
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly children?: IServerBreadcrumbsItem[];
}

export interface IServerBreadcrumbsProvider {
	readonly id: string;
	provideBreadcrumbs(uri: string): Promise<IServerBreadcrumbsItem[] | undefined>;
}

export interface IServerBreadcrumbsService {
	readonly onDidRegisterProvider: Event<IServerBreadcrumbsProvider>;
	registerBreadcrumbsProvider(provider: IServerBreadcrumbsProvider): IDisposable;
	provideBreadcrumbs(uri: string): Promise<IServerBreadcrumbsItem[]>;
}

export class ServerBreadcrumbsCommon implements IServerBreadcrumbsService {
	private readonly _providers = new Map<string, IServerBreadcrumbsProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerBreadcrumbsProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerBreadcrumbsProvider(provider: IServerBreadcrumbsProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideBreadcrumbs(uri: string): Promise<IServerBreadcrumbsItem[]> {
		for (const provider of this._providers.values()) {
			const result = await provider.provideBreadcrumbs(uri);
			if (result) {
				return result; // Usually one provider per file is enough for breadcrumbs
			}
		}
		return [];
	}
}
