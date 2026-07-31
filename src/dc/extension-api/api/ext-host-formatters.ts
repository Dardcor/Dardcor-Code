import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { DocumentSelector, matchesSelector } from './ext-host-languages.js';
import { TextDocument } from './ext-host-documents.js';
import { TextEdit, Range, Position } from './ext-host-api-impl.js';
import { CancellationToken } from '../../core/async/cancellation.js';

export interface IFormattingOptions {
	tabSize: number;
	insertSpaces: boolean;
}

export interface IDocumentFormattingEditProvider {
	provideDocumentFormattingEdits(document: TextDocument, options: IFormattingOptions, token: CancellationToken): TextEdit[] | Promise<TextEdit[]> | undefined;
}

export interface IDocumentRangeFormattingEditProvider {
	provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: IFormattingOptions, token: CancellationToken): TextEdit[] | Promise<TextEdit[]> | undefined;
}

export interface IOnTypeFormattingEditProvider {
	provideOnTypeFormattingEdits(document: TextDocument, position: Position, ch: string, options: IFormattingOptions, token: CancellationToken): TextEdit[] | Promise<TextEdit[]> | undefined;
}

interface IProviderRegistration<T> {
	readonly selector: DocumentSelector;
	readonly provider: T;
}

export class ExtHostFormatters extends Disposable {
	private readonly _documentProviders: IProviderRegistration<IDocumentFormattingEditProvider>[] = [];
	private readonly _rangeProviders: IProviderRegistration<IDocumentRangeFormattingEditProvider>[] = [];
	private readonly _onTypeProviders: IProviderRegistration<IOnTypeFormattingEditProvider>[] = [];
	private readonly _onTypeTriggerCharacters = new Map<IOnTypeFormattingEditProvider, string[]>();

	public registerDocumentFormattingEditProvider(selector: DocumentSelector, provider: IDocumentFormattingEditProvider): IDisposable {
		return this._registerProvider(this._documentProviders, selector, provider);
	}

	public registerDocumentRangeFormattingEditProvider(selector: DocumentSelector, provider: IDocumentRangeFormattingEditProvider): IDisposable {
		return this._registerProvider(this._rangeProviders, selector, provider);
	}

	public registerOnTypeFormattingEditProvider(selector: DocumentSelector, provider: IOnTypeFormattingEditProvider, triggerCharacters: string[]): IDisposable {
		const disposable = this._registerProvider(this._onTypeProviders, selector, provider);
		this._onTypeTriggerCharacters.set(provider, triggerCharacters);
		return toDisposable(() => {
			disposable.dispose();
			this._onTypeTriggerCharacters.delete(provider);
		});
	}

	public async formatDocument(document: TextDocument, options: IFormattingOptions, token: CancellationToken = CancellationToken.None): Promise<TextEdit[]> {
		const edits: TextEdit[] = [];
		for (const registration of this._documentProviders) {
			if (token.isCancellationRequested) {
				break;
			}
			if (!matchesSelector(registration.selector, document.uri, document.languageId)) {
				continue;
			}
			const provided = await registration.provider.provideDocumentFormattingEdits(document, options, token);
			if (provided) {
				edits.push(...provided);
			}
		}
		return edits;
	}

	public async formatRange(document: TextDocument, range: Range, options: IFormattingOptions, token: CancellationToken = CancellationToken.None): Promise<TextEdit[]> {
		const edits: TextEdit[] = [];
		for (const registration of this._rangeProviders) {
			if (token.isCancellationRequested) {
				break;
			}
			if (!matchesSelector(registration.selector, document.uri, document.languageId)) {
				continue;
			}
			const provided = await registration.provider.provideDocumentRangeFormattingEdits(document, range, options, token);
			if (provided) {
				edits.push(...provided);
			}
		}
		return edits;
	}

	public async formatOnType(document: TextDocument, position: Position, ch: string, options: IFormattingOptions, token: CancellationToken = CancellationToken.None): Promise<TextEdit[]> {
		const edits: TextEdit[] = [];
		for (const registration of this._onTypeProviders) {
			if (token.isCancellationRequested) {
				break;
			}
			if (!matchesSelector(registration.selector, document.uri, document.languageId)) {
				continue;
			}
			const triggers = this._onTypeTriggerCharacters.get(registration.provider) ?? [];
			if (!triggers.includes(ch)) {
				continue;
			}
			const provided = await registration.provider.provideOnTypeFormattingEdits(document, position, ch, options, token);
			if (provided) {
				edits.push(...provided);
			}
		}
		return edits;
	}

	public getProviderCount(): { document: number; range: number; onType: number } {
		return {
			document: this._documentProviders.length,
			range: this._rangeProviders.length,
			onType: this._onTypeProviders.length
		};
	}

	public override dispose(): void {
		this._documentProviders.length = 0;
		this._rangeProviders.length = 0;
		this._onTypeProviders.length = 0;
		this._onTypeTriggerCharacters.clear();
		super.dispose();
	}

	private _registerProvider<T>(registry: IProviderRegistration<T>[], selector: DocumentSelector, provider: T): IDisposable {
		const registration: IProviderRegistration<T> = { selector, provider };
		registry.push(registration);
		return toDisposable(() => {
			const index = registry.indexOf(registration);
			if (index !== -1) {
				registry.splice(index, 1);
			}
		});
	}
}
