/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Color } from '../../../base/common/color.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { Position } from '../../common/core/position.js';
import { Range } from '../../common/core/range.js';
import { MetadataConsts } from '../../common/encodedTokenAttributes.js';
import * as languages from '../../common/languages.js';
import { ILanguageExtensionPoint, ILanguageService } from '../../common/languages/language.js';
import { LanguageConfiguration } from '../../common/languages/languageConfiguration.js';
import { ILanguageConfigurationService } from '../../common/languages/languageConfigurationRegistry.js';
import { ModesRegistry } from '../../common/languages/modesRegistry.js';
import { LanguageSelector } from '../../common/languageSelector.js';
import * as model from '../../common/model.js';
import { ILanguageFeaturesService } from '../../common/services/languageFeatures.js';
import * as standaloneEnums from '../../common/standalone/standaloneEnums.js';
import { StandaloneServices } from './standaloneServices.js';
import { compile } from '../common/monarch/monarchCompile.js';
import { MonarchTokenizer } from '../common/monarch/monarchLexer.js';
import { IMonarchLanguage } from '../common/monarch/monarchTypes.js';
import { IStandaloneThemeService } from '../common/standaloneTheme.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IMarkerData, IMarkerService } from '../../../platform/markers/common/markers.js';
import { EditDeltaInfo } from '../../common/textModelEditSource.js';

export function register(language: ILanguageExtensionPoint): void {
	ModesRegistry.registerLanguage(language);
}

export function getLanguages(): ILanguageExtensionPoint[] {
	let result: ILanguageExtensionPoint[] = [];
	result = result.concat(ModesRegistry.getLanguages());
	return result;
}

export function getEncodedLanguageId(languageId: string): number {
	const languageService = StandaloneServices.get(ILanguageService);
	return languageService.languageIdCodec.encodeLanguageId(languageId);
}

export function onLanguage(languageId: string, callback: () => void): IDisposable {
	return StandaloneServices.withServices(() => {
		const languageService = StandaloneServices.get(ILanguageService);
		const disposable = languageService.onDidRequestRichLanguageFeatures((encounteredLanguageId) => {
			if (encounteredLanguageId === languageId) {
				disposable.dispose();
				callback();
			}
		});
		return disposable;
	});
}

export function onLanguageEncountered(languageId: string, callback: () => void): IDisposable {
	return StandaloneServices.withServices(() => {
		const languageService = StandaloneServices.get(ILanguageService);
		const disposable = languageService.onDidRequestBasicLanguageFeatures((encounteredLanguageId) => {
			if (encounteredLanguageId === languageId) {
				disposable.dispose();
				callback();
			}
		});
		return disposable;
	});
}

export function setLanguageConfiguration(languageId: string, configuration: LanguageConfiguration): IDisposable {
	const languageService = StandaloneServices.get(ILanguageService);
	if (!languageService.isRegisteredLanguageId(languageId)) {
		throw new Error(`Cannot set configuration for unknown language ${languageId}`);
	}
	const languageConfigurationService = StandaloneServices.get(ILanguageConfigurationService);
	return languageConfigurationService.register(languageId, configuration, 100);
}

/**
 * @internal
 */
export class EncodedTokenizationSupportAdapter implements languages.ITokenizationSupport, IDisposable {

	private readonly _languageId: string;
	private readonly _actual: EncodedTokensProvider;

	constructor(languageId: string, actual: EncodedTokensProvider) {
		this._languageId = languageId;
		this._actual = actual;
	}

	dispose(): void {
	}

	public getInitialState(): languages.IState {
		return this._actual.getInitialState();
	}

	public tokenize(line: string, hasEOL: boolean, state: languages.IState): languages.TokenizationResult {
		if (typeof this._actual.tokenize === 'function') {
			return TokenizationSupportAdapter.adaptTokenize(this._languageId, <{ tokenize(line: string, state: languages.IState): ILineTokens }>this._actual, line, state);
		}
		throw new Error('Not supported!');
	}

	public tokenizeEncoded(line: string, hasEOL: boolean, state: languages.IState): languages.EncodedTokenizationResult {
		const result = this._actual.tokenizeEncoded(line, state);
		return new languages.EncodedTokenizationResult(result.tokens, [], result.endState);
	}
}

/**
 * @internal
 */
export class TokenizationSupportAdapter implements languages.ITokenizationSupport, IDisposable {

	constructor(
		private readonly _languageId: string,
		private readonly _actual: TokensProvider,
		private readonly _languageService: ILanguageService,
		private readonly _standaloneThemeService: IStandaloneThemeService,
	) {
	}

	dispose(): void {
	}

	public getInitialState(): languages.IState {
		return this._actual.getInitialState();
	}

	private static _toClassicTokens(tokens: IToken[], language: string): languages.Token[] {
		const result: languages.Token[] = [];
		let previousStartIndex: number = 0;
		for (let i = 0, len = tokens.length; i < len; i++) {
			const t = tokens[i];
			let startIndex = t.startIndex;

			if (i === 0) {
				startIndex = 0;
			} else if (startIndex < previousStartIndex) {
				startIndex = previousStartIndex;
			}

			result[i] = new languages.Token(startIndex, t.scopes, language);

			previousStartIndex = startIndex;
		}
		return result;
	}

	public static adaptTokenize(language: string, actual: { tokenize(line: string, state: languages.IState): ILineTokens }, line: string, state: languages.IState): languages.TokenizationResult {
		const actualResult = actual.tokenize(line, state);
		const tokens = TokenizationSupportAdapter._toClassicTokens(actualResult.tokens, language);

		let endState: languages.IState;
		if (actualResult.endState.equals(state)) {
			endState = state;
		} else {
			endState = actualResult.endState;
		}

		return new languages.TokenizationResult(tokens, endState);
	}

	public tokenize(line: string, hasEOL: boolean, state: languages.IState): languages.TokenizationResult {
		return TokenizationSupportAdapter.adaptTokenize(this._languageId, this._actual, line, state);
	}

	private _toBinaryTokens(languageIdCodec: languages.ILanguageIdCodec, tokens: IToken[]): Uint32Array {
		const languageId = languageIdCodec.encodeLanguageId(this._languageId);
		const tokenTheme = this._standaloneThemeService.getColorTheme().tokenTheme;

		const result: number[] = [];
		let resultLen = 0;
		let previousStartIndex: number = 0;
		for (let i = 0, len = tokens.length; i < len; i++) {
			const t = tokens[i];
			const metadata = tokenTheme.match(languageId, t.scopes) | MetadataConsts.BALANCED_BRACKETS_MASK;
			if (resultLen > 0 && result[resultLen - 1] === metadata) {
				continue;
			}

			let startIndex = t.startIndex;

			if (i === 0) {
				startIndex = 0;
			} else if (startIndex < previousStartIndex) {
				startIndex = previousStartIndex;
			}

			result[resultLen++] = startIndex;
			result[resultLen++] = metadata;

			previousStartIndex = startIndex;
		}

		const actualResult = new Uint32Array(resultLen);
		for (let i = 0; i < resultLen; i++) {
			actualResult[i] = result[i];
		}
		return actualResult;
	}

	public tokenizeEncoded(line: string, hasEOL: boolean, state: languages.IState): languages.EncodedTokenizationResult {
		const actualResult = this._actual.tokenize(line, state);
		const tokens = this._toBinaryTokens(this._languageService.languageIdCodec, actualResult.tokens);

		let endState: languages.IState;
		if (actualResult.endState.equals(state)) {
			endState = state;
		} else {
			endState = actualResult.endState;
		}

		return new languages.EncodedTokenizationResult(tokens, [], endState);
	}
}

export interface IToken {
	startIndex: number;
	scopes: string;
}

export interface ILineTokens {
	tokens: IToken[];
	endState: languages.IState;
}

export interface IEncodedLineTokens {
	tokens: Uint32Array;
	endState: languages.IState;
}

export interface TokensProviderFactory {
	create(): languages.ProviderResult<TokensProvider | EncodedTokensProvider | IMonarchLanguage>;
}

export interface TokensProvider {
	getInitialState(): languages.IState;
	tokenize(line: string, state: languages.IState): ILineTokens;
}

export interface EncodedTokensProvider {
	getInitialState(): languages.IState;
	tokenizeEncoded(line: string, state: languages.IState): IEncodedLineTokens;
	tokenize?(line: string, state: languages.IState): ILineTokens;
}

function isATokensProvider(provider: TokensProvider | EncodedTokensProvider | IMonarchLanguage): provider is TokensProvider | EncodedTokensProvider {
	return (typeof provider.getInitialState === 'function');
}

function isEncodedTokensProvider(provider: TokensProvider | EncodedTokensProvider): provider is EncodedTokensProvider {
	return 'tokenizeEncoded' in provider;
}

function isThenable<T>(obj: any): obj is Thenable<T> {
	return obj && typeof obj.then === 'function';
}

export function setColorMap(colorMap: string[] | null): void {
	const standaloneThemeService = StandaloneServices.get(IStandaloneThemeService);
	if (colorMap) {
		const result: Color[] = [null!];
		for (let i = 1, len = colorMap.length; i < len; i++) {
			result[i] = Color.fromHex(colorMap[i]);
		}
		standaloneThemeService.setColorMapOverride(result);
	} else {
		standaloneThemeService.setColorMapOverride(null);
	}
}

/**
 * @internal
 */
function createTokenizationSupportAdapter(languageId: string, provider: TokensProvider | EncodedTokensProvider) {
	if (isEncodedTokensProvider(provider)) {
		return new EncodedTokenizationSupportAdapter(languageId, provider);
	} else {
		return new TokenizationSupportAdapter(
			languageId,
			provider,
			StandaloneServices.get(ILanguageService),
			StandaloneServices.get(IStandaloneThemeService),
		);
	}
}

export function registerTokensProviderFactory(languageId: string, factory: TokensProviderFactory): IDisposable {
	const adaptedFactory = new languages.LazyTokenizationSupport(async () => {
		const result = await Promise.resolve(factory.create());
		if (!result) {
			return null;
		}
		if (isATokensProvider(result)) {
			return createTokenizationSupportAdapter(languageId, result);
		}
		return new MonarchTokenizer(StandaloneServices.get(ILanguageService), StandaloneServices.get(IStandaloneThemeService), languageId, compile(languageId, result), StandaloneServices.get(IConfigurationService));
	});
	return languages.TokenizationRegistry.registerFactory(languageId, adaptedFactory);
}

export function setTokensProvider(languageId: string, provider: TokensProvider | EncodedTokensProvider | Thenable<TokensProvider | EncodedTokensProvider>): IDisposable {
	const languageService = StandaloneServices.get(ILanguageService);
	if (!languageService.isRegisteredLanguageId(languageId)) {
		throw new Error(`Cannot set tokens provider for unknown language ${languageId}`);
	}
	if (isThenable<TokensProvider | EncodedTokensProvider>(provider)) {
		return registerTokensProviderFactory(languageId, { create: () => provider });
	}
	return languages.TokenizationRegistry.register(languageId, createTokenizationSupportAdapter(languageId, provider));
}

export function setMonarchTokensProvider(languageId: string, languageDef: IMonarchLanguage | Thenable<IMonarchLanguage>): IDisposable {
	const create = (languageDef: IMonarchLanguage) => {
		return new MonarchTokenizer(StandaloneServices.get(ILanguageService), StandaloneServices.get(IStandaloneThemeService), languageId, compile(languageId, languageDef), StandaloneServices.get(IConfigurationService));
	};
	if (isThenable<IMonarchLanguage>(languageDef)) {
		return registerTokensProviderFactory(languageId, { create: () => languageDef });
	}
	return languages.TokenizationRegistry.register(languageId, create(languageDef));
}

export function registerReferenceProvider(languageSelector: LanguageSelector, provider: languages.ReferenceProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.referenceProvider.register(languageSelector, provider);
}

export function registerRenameProvider(languageSelector: LanguageSelector, provider: languages.RenameProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.renameProvider.register(languageSelector, provider);
}

export function registerNewSymbolNameProvider(languageSelector: LanguageSelector, provider: languages.NewSymbolNamesProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.newSymbolNamesProvider.register(languageSelector, provider);
}

export function registerSignatureHelpProvider(languageSelector: LanguageSelector, provider: languages.SignatureHelpProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.signatureHelpProvider.register(languageSelector, provider);
}

export function registerHoverProvider(languageSelector: LanguageSelector, provider: languages.HoverProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.hoverProvider.register(languageSelector, {
		provideHover: async (model: model.ITextModel, position: Position, token: CancellationToken, context?: languages.HoverContext<languages.Hover>): Promise<languages.Hover | undefined> => {
			const word = model.getWordAtPosition(position);

			return Promise.resolve<languages.Hover | null | undefined>(provider.provideHover(model, position, token, context)).then((value): languages.Hover | undefined => {
				if (!value) {
					return undefined;
				}
				if (!value.range && word) {
					value.range = new Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
				}
				if (!value.range) {
					value.range = new Range(position.lineNumber, position.column, position.lineNumber, position.column);
				}
				return value;
			});
		}
	});
}

export function registerDocumentSymbolProvider(languageSelector: LanguageSelector, provider: languages.DocumentSymbolProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.documentSymbolProvider.register(languageSelector, provider);
}

export function registerDocumentHighlightProvider(languageSelector: LanguageSelector, provider: languages.DocumentHighlightProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.documentHighlightProvider.register(languageSelector, provider);
}

export function registerLinkedEditingRangeProvider(languageSelector: LanguageSelector, provider: languages.LinkedEditingRangeProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.linkedEditingRangeProvider.register(languageSelector, provider);
}

export function registerDefinitionProvider(languageSelector: LanguageSelector, provider: languages.DefinitionProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.definitionProvider.register(languageSelector, provider);
}

export function registerImplementationProvider(languageSelector: LanguageSelector, provider: languages.ImplementationProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.implementationProvider.register(languageSelector, provider);
}

export function registerTypeDefinitionProvider(languageSelector: LanguageSelector, provider: languages.TypeDefinitionProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.typeDefinitionProvider.register(languageSelector, provider);
}

export function registerCodeLensProvider(languageSelector: LanguageSelector, provider: languages.CodeLensProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.codeLensProvider.register(languageSelector, provider);
}

export function registerCodeActionProvider(languageSelector: LanguageSelector, provider: CodeActionProvider, metadata?: CodeActionProviderMetadata): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.codeActionProvider.register(languageSelector, {
		providedCodeActionKinds: metadata?.providedCodeActionKinds,
		documentation: metadata?.documentation,
		provideCodeActions: (model: model.ITextModel, range: Range, context: languages.CodeActionContext, token: CancellationToken): languages.ProviderResult<languages.CodeActionList> => {
			const markerService = StandaloneServices.get(IMarkerService);
			const markers = markerService.read({ resource: model.uri }).filter(m => {
				return Range.areIntersectingOrTouching(m, range);
			});
			return provider.provideCodeActions(model, range, { markers, only: context.only, trigger: context.trigger }, token);
		},
		resolveCodeAction: provider.resolveCodeAction
	});
}

export function registerDocumentFormattingEditProvider(languageSelector: LanguageSelector, provider: languages.DocumentFormattingEditProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.documentFormattingEditProvider.register(languageSelector, provider);
}

export function registerDocumentRangeFormattingEditProvider(languageSelector: LanguageSelector, provider: languages.DocumentRangeFormattingEditProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.documentRangeFormattingEditProvider.register(languageSelector, provider);
}

export function registerOnTypeFormattingEditProvider(languageSelector: LanguageSelector, provider: languages.OnTypeFormattingEditProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.onTypeFormattingEditProvider.register(languageSelector, provider);
}

export function registerLinkProvider(languageSelector: LanguageSelector, provider: languages.LinkProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.linkProvider.register(languageSelector, provider);
}

export function registerCompletionItemProvider(languageSelector: LanguageSelector, provider: languages.CompletionItemProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.completionProvider.register(languageSelector, provider);
}

export function registerColorProvider(languageSelector: LanguageSelector, provider: languages.DocumentColorProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.colorProvider.register(languageSelector, provider);
}

export function registerFoldingRangeProvider(languageSelector: LanguageSelector, provider: languages.FoldingRangeProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.foldingRangeProvider.register(languageSelector, provider);
}

export function registerDeclarationProvider(languageSelector: LanguageSelector, provider: languages.DeclarationProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.declarationProvider.register(languageSelector, provider);
}

export function registerSelectionRangeProvider(languageSelector: LanguageSelector, provider: languages.SelectionRangeProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.selectionRangeProvider.register(languageSelector, provider);
}

export function registerDocumentSemanticTokensProvider(languageSelector: LanguageSelector, provider: languages.DocumentSemanticTokensProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.documentSemanticTokensProvider.register(languageSelector, provider);
}

export function registerDocumentRangeSemanticTokensProvider(languageSelector: LanguageSelector, provider: languages.DocumentRangeSemanticTokensProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.documentRangeSemanticTokensProvider.register(languageSelector, provider);
}

export function registerInlineCompletionsProvider(languageSelector: LanguageSelector, provider: languages.InlineCompletionsProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.inlineCompletionsProvider.register(languageSelector, provider);
}

export function registerInlayHintsProvider(languageSelector: LanguageSelector, provider: languages.InlayHintsProvider): IDisposable {
	const languageFeaturesService = StandaloneServices.get(ILanguageFeaturesService);
	return languageFeaturesService.inlayHintsProvider.register(languageSelector, provider);
}

export interface CodeActionContext {

	readonly markers: IMarkerData[];

	readonly only?: string;

	readonly trigger: languages.CodeActionTriggerType;
}

export interface CodeActionProvider {
	provideCodeActions(model: model.ITextModel, range: Range, context: CodeActionContext, token: CancellationToken): languages.ProviderResult<languages.CodeActionList>;

	resolveCodeAction?(codeAction: languages.CodeAction, token: CancellationToken): languages.ProviderResult<languages.CodeAction>;
}



export interface CodeActionProviderMetadata {
	readonly providedCodeActionKinds?: readonly string[];

	readonly documentation?: ReadonlyArray<{ readonly kind: string; readonly command: languages.Command }>;
}

/**
 * @internal
 */
export function createMonacoLanguagesAPI(): typeof monaco.languages {
	return {
		// eslint-disable-next-line local/code-no-any-casts
		register: <any>register,
		// eslint-disable-next-line local/code-no-any-casts
		getLanguages: <any>getLanguages,
		// eslint-disable-next-line local/code-no-any-casts
		onLanguage: <any>onLanguage,
		// eslint-disable-next-line local/code-no-any-casts
		onLanguageEncountered: <any>onLanguageEncountered,
		// eslint-disable-next-line local/code-no-any-casts
		getEncodedLanguageId: <any>getEncodedLanguageId,

		// eslint-disable-next-line local/code-no-any-casts
		setLanguageConfiguration: <any>setLanguageConfiguration,
		setColorMap: setColorMap,
		// eslint-disable-next-line local/code-no-any-casts
		registerTokensProviderFactory: <any>registerTokensProviderFactory,
		// eslint-disable-next-line local/code-no-any-casts
		setTokensProvider: <any>setTokensProvider,
		// eslint-disable-next-line local/code-no-any-casts
		setMonarchTokensProvider: <any>setMonarchTokensProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerReferenceProvider: <any>registerReferenceProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerRenameProvider: <any>registerRenameProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerNewSymbolNameProvider: <any>registerNewSymbolNameProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerCompletionItemProvider: <any>registerCompletionItemProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerSignatureHelpProvider: <any>registerSignatureHelpProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerHoverProvider: <any>registerHoverProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerDocumentSymbolProvider: <any>registerDocumentSymbolProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerDocumentHighlightProvider: <any>registerDocumentHighlightProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerLinkedEditingRangeProvider: <any>registerLinkedEditingRangeProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerDefinitionProvider: <any>registerDefinitionProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerImplementationProvider: <any>registerImplementationProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerTypeDefinitionProvider: <any>registerTypeDefinitionProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerCodeLensProvider: <any>registerCodeLensProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerCodeActionProvider: <any>registerCodeActionProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerDocumentFormattingEditProvider: <any>registerDocumentFormattingEditProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerDocumentRangeFormattingEditProvider: <any>registerDocumentRangeFormattingEditProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerOnTypeFormattingEditProvider: <any>registerOnTypeFormattingEditProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerLinkProvider: <any>registerLinkProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerColorProvider: <any>registerColorProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerFoldingRangeProvider: <any>registerFoldingRangeProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerDeclarationProvider: <any>registerDeclarationProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerSelectionRangeProvider: <any>registerSelectionRangeProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerDocumentSemanticTokensProvider: <any>registerDocumentSemanticTokensProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerDocumentRangeSemanticTokensProvider: <any>registerDocumentRangeSemanticTokensProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerInlineCompletionsProvider: <any>registerInlineCompletionsProvider,
		// eslint-disable-next-line local/code-no-any-casts
		registerInlayHintsProvider: <any>registerInlayHintsProvider,

		DocumentHighlightKind: standaloneEnums.DocumentHighlightKind,
		CompletionItemKind: standaloneEnums.CompletionItemKind,
		CompletionItemTag: standaloneEnums.CompletionItemTag,
		CompletionItemInsertTextRule: standaloneEnums.CompletionItemInsertTextRule,
		SymbolKind: standaloneEnums.SymbolKind,
		SymbolTag: standaloneEnums.SymbolTag,
		IndentAction: standaloneEnums.IndentAction,
		CompletionTriggerKind: standaloneEnums.CompletionTriggerKind,
		SignatureHelpTriggerKind: standaloneEnums.SignatureHelpTriggerKind,
		InlayHintKind: standaloneEnums.InlayHintKind,
		InlineCompletionTriggerKind: standaloneEnums.InlineCompletionTriggerKind,
		CodeActionTriggerType: standaloneEnums.CodeActionTriggerType,
		NewSymbolNameTag: standaloneEnums.NewSymbolNameTag,
		NewSymbolNameTriggerKind: standaloneEnums.NewSymbolNameTriggerKind,
		PartialAcceptTriggerKind: standaloneEnums.PartialAcceptTriggerKind,
		HoverVerbosityAction: standaloneEnums.HoverVerbosityAction,
		InlineCompletionEndOfLifeReasonKind: standaloneEnums.InlineCompletionEndOfLifeReasonKind,
		InlineCompletionHintStyle: standaloneEnums.InlineCompletionHintStyle,

		FoldingRangeKind: languages.FoldingRangeKind,
		// eslint-disable-next-line local/code-no-any-casts
		SelectedSuggestionInfo: <any>languages.SelectedSuggestionInfo,
		// eslint-disable-next-line local/code-no-any-casts
		EditDeltaInfo: <any>EditDeltaInfo,
	};
}
