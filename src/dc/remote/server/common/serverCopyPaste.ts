import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerCopyPasteProvider {
	readonly id: string;
	provideDocumentPasteEdits(uri: string, ranges: any[], dataTransfer: any): Promise<any>;
}

export interface IServerCopyPasteService {
	readonly onDidRegisterProvider: Event<IServerCopyPasteProvider>;
	registerProvider(provider: IServerCopyPasteProvider): IDisposable;
	getProviders(): IServerCopyPasteProvider[];
	executePaste(uri: string, ranges: any[], dataTransfer: any): Promise<void>;
}

export class ServerCopyPasteCommon implements IServerCopyPasteService {
	private readonly _providers = new Map<string, IServerCopyPasteProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerCopyPasteProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerProvider(provider: IServerCopyPasteProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	getProviders(): IServerCopyPasteProvider[] {
		return Array.from(this._providers.values());
	}

	async executePaste(uri: string, ranges: any[], dataTransfer: any): Promise<void> {
		for (const provider of this._providers.values()) {
			const edits = await provider.provideDocumentPasteEdits(uri, ranges, dataTransfer);
			if (edits) {
				return;
			}
		}
	}
}
