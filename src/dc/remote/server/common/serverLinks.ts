import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerLink {
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly url?: string;
	readonly tooltip?: string;
}

export interface IServerLinkProvider {
	readonly id: string;
	provideLinks(uri: string): Promise<IServerLink[] | undefined>;
	resolveLink?(link: IServerLink): Promise<IServerLink>;
}

export interface IServerLinksService {
	readonly onDidRegisterProvider: Event<IServerLinkProvider>;
	registerLinkProvider(provider: IServerLinkProvider): IDisposable;
	provideLinks(uri: string): Promise<IServerLink[]>;
	resolveLink(link: IServerLink): Promise<IServerLink>;
}

export class ServerLinksCommon implements IServerLinksService {
	private readonly _providers = new Map<string, IServerLinkProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerLinkProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerLinkProvider(provider: IServerLinkProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideLinks(uri: string): Promise<IServerLink[]> {
		const links: IServerLink[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideLinks(uri);
			if (result) {
				links.push(...result);
			}
		}
		return links;
	}

	async resolveLink(link: IServerLink): Promise<IServerLink> {
		for (const provider of this._providers.values()) {
			if (provider.resolveLink) {
				try {
					const resolved = await provider.resolveLink(link);
					if (resolved) return resolved;
				} catch {
					// Ignore errors
				}
			}
		}
		return link;
	}
}
