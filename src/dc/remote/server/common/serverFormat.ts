import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerFormattingEdit {
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly text: string;
}

export interface IServerFormattingOptions {
	readonly tabSize: number;
	readonly insertSpaces: boolean;
}

export interface IServerDocumentFormattingProvider {
	readonly id: string;
	provideDocumentFormattingEdits(uri: string, options: IServerFormattingOptions): Promise<IServerFormattingEdit[]>;
}

export interface IServerDocumentRangeFormattingProvider {
	readonly id: string;
	provideDocumentRangeFormattingEdits(uri: string, range: any, options: IServerFormattingOptions): Promise<IServerFormattingEdit[]>;
}

export interface IServerFormatService {
	readonly onDidRegisterDocumentFormattingProvider: Event<IServerDocumentFormattingProvider>;
	readonly onDidRegisterDocumentRangeFormattingProvider: Event<IServerDocumentRangeFormattingProvider>;
	registerDocumentFormattingProvider(provider: IServerDocumentFormattingProvider): IDisposable;
	registerDocumentRangeFormattingProvider(provider: IServerDocumentRangeFormattingProvider): IDisposable;
	formatDocument(uri: string, options: IServerFormattingOptions): Promise<IServerFormattingEdit[]>;
	formatDocumentRange(uri: string, range: any, options: IServerFormattingOptions): Promise<IServerFormattingEdit[]>;
}

export class ServerFormatCommon implements IServerFormatService {
	private readonly _docProviders = new Map<string, IServerDocumentFormattingProvider>();
	private readonly _rangeProviders = new Map<string, IServerDocumentRangeFormattingProvider>();

	private readonly _onDidRegisterDocumentFormattingProvider = new Emitter<IServerDocumentFormattingProvider>();
	readonly onDidRegisterDocumentFormattingProvider = this._onDidRegisterDocumentFormattingProvider.event;

	private readonly _onDidRegisterDocumentRangeFormattingProvider = new Emitter<IServerDocumentRangeFormattingProvider>();
	readonly onDidRegisterDocumentRangeFormattingProvider = this._onDidRegisterDocumentRangeFormattingProvider.event;

	registerDocumentFormattingProvider(provider: IServerDocumentFormattingProvider): IDisposable {
		this._docProviders.set(provider.id, provider);
		this._onDidRegisterDocumentFormattingProvider.fire(provider);
		return { dispose: () => { this._docProviders.delete(provider.id); } };
	}

	registerDocumentRangeFormattingProvider(provider: IServerDocumentRangeFormattingProvider): IDisposable {
		this._rangeProviders.set(provider.id, provider);
		this._onDidRegisterDocumentRangeFormattingProvider.fire(provider);
		return { dispose: () => { this._rangeProviders.delete(provider.id); } };
	}

	async formatDocument(uri: string, options: IServerFormattingOptions): Promise<IServerFormattingEdit[]> {
		for (const provider of this._docProviders.values()) {
			const edits = await provider.provideDocumentFormattingEdits(uri, options);
			if (edits && edits.length > 0) {
				return edits;
			}
		}
		return [];
	}

	async formatDocumentRange(uri: string, range: any, options: IServerFormattingOptions): Promise<IServerFormattingEdit[]> {
		for (const provider of this._rangeProviders.values()) {
			const edits = await provider.provideDocumentRangeFormattingEdits(uri, range, options);
			if (edits && edits.length > 0) {
				return edits;
			}
		}
		return [];
	}
}
