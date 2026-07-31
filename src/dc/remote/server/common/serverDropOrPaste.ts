import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerDropOrPasteProvider {
	readonly id: string;
	readonly dropMimeTypes: string[];
	readonly pasteMimeTypes: string[];
	provideDocumentDropEdits(uri: string, position: { line: number; column: number }, dataTransfer: any): Promise<any>;
	provideDocumentPasteEdits(uri: string, ranges: { startLine: number; startColumn: number; endLine: number; endColumn: number }[], dataTransfer: any): Promise<any>;
}

export interface IServerDropOrPasteService {
	readonly onDidRegisterProvider: Event<IServerDropOrPasteProvider>;
	registerProvider(provider: IServerDropOrPasteProvider): IDisposable;
	getProviders(): IServerDropOrPasteProvider[];
	getDropProviders(mimeType: string): IServerDropOrPasteProvider[];
	getPasteProviders(mimeType: string): IServerDropOrPasteProvider[];
}

export class ServerDropOrPasteCommon implements IServerDropOrPasteService {
	private readonly _providers = new Map<string, IServerDropOrPasteProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerDropOrPasteProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerProvider(provider: IServerDropOrPasteProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	getProviders(): IServerDropOrPasteProvider[] {
		return Array.from(this._providers.values());
	}

	getDropProviders(mimeType: string): IServerDropOrPasteProvider[] {
		return this.getProviders().filter(p => p.dropMimeTypes.includes(mimeType) || p.dropMimeTypes.includes('*/*'));
	}

	getPasteProviders(mimeType: string): IServerDropOrPasteProvider[] {
		return this.getProviders().filter(p => p.pasteMimeTypes.includes(mimeType) || p.pasteMimeTypes.includes('*/*'));
	}
}
