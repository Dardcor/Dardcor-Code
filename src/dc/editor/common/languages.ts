/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../base/common/buffer.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { Codicon } from '../../base/common/codicons.js';
import { Color } from '../../base/common/color.js';
import { IReadonlyVSDataTransfer } from '../../base/common/dataTransfer.js';
import { Event } from '../../base/common/event.js';
import { HierarchicalKind } from '../../base/common/hierarchicalKind.js';
import { IMarkdownString } from '../../base/common/htmlContent.js';
import { IDisposable } from '../../base/common/lifecycle.js';
import { ThemeIcon } from '../../base/common/themables.js';
import { URI, UriComponents } from '../../base/common/uri.js';
import { EditOperation, ISingleEditOperation } from './core/editOperation.js';
import { IPosition, Position } from './core/position.js';
import { IRange, Range } from './core/range.js';
import { Selection } from './core/selection.js';
import { LanguageId } from './encodedTokenAttributes.js';
import { LanguageSelector } from './languageSelector.js';
import * as model from './model.js';
import { TokenizationRegistry as TokenizationRegistryImpl } from './tokenizationRegistry.js';
import { ContiguousMultilineTokens } from './tokens/contiguousMultilineTokens.js';
import { localize } from '../../nls.js';
import { ExtensionIdentifier } from '../../platform/extensions/common/extensions.js';
import { IMarkerData } from '../../platform/markers/common/markers.js';
import { EditDeltaInfo } from './textModelEditSource.js';
import { FontTokensUpdate } from './textModelEvents.js';

/**
 * @internal
 */
export interface ILanguageIdCodec {
	encodeLanguageId(languageId: string): LanguageId;
	decodeLanguageId(languageId: LanguageId): string;
}

export class Token {
	_tokenBrand: void = undefined;

	constructor(
		public readonly offset: number,
		public readonly type: string,
		public readonly language: string,
	) {
	}

	public toString(): string {
		return '(' + this.offset + ', ' + this.type + ')';
	}
}

/**
 * @internal
 */
export class TokenizationResult {
	_tokenizationResultBrand: void = undefined;

	constructor(
		public readonly tokens: Token[],
		public readonly endState: IState,
	) {
	}
}

/**
 * @internal
 */
export interface IFontToken {
	readonly startIndex: number;
	readonly endIndex: number;
	readonly fontFamily: string | null;
	readonly fontSizeMultiplier: number | null;
	readonly lineHeightMultiplier: number | null;
}

/**
 * @internal
 */
export class EncodedTokenizationResult {
	_encodedTokenizationResultBrand: void = undefined;

	constructor(
		public readonly tokens: Uint32Array,
		public readonly fontInfo: IFontToken[],
		public readonly endState: IState,
	) {
	}
}

export interface SyntaxNode {
	startIndex: number;
	endIndex: number;
	startPosition: IPosition;
	endPosition: IPosition;
}

export interface QueryCapture {
	name: string;
	text?: string;
	node: SyntaxNode;
	encodedLanguageId: number;
}

/**
 * @internal
 */
export interface ITokenizationSupport {
	readonly backgroundTokenizerShouldOnlyVerifyTokens?: boolean;

	getInitialState(): IState;

	tokenize(line: string, hasEOL: boolean, state: IState): TokenizationResult;

	tokenizeEncoded(line: string, hasEOL: boolean, state: IState): EncodedTokenizationResult;

	createBackgroundTokenizer?(textModel: model.ITextModel, store: IBackgroundTokenizationStore): IBackgroundTokenizer | undefined;
}

/**
 * @internal
 */
export interface IBackgroundTokenizer extends IDisposable {
	requestTokens(startLineNumber: number, endLineNumberExclusive: number): void;

	reportMismatchingTokens?(lineNumber: number): void;
}

/**
 * @internal
 */
export interface IBackgroundTokenizationStore {
	setTokens(tokens: ContiguousMultilineTokens[]): void;

	setFontInfo(changes: FontTokensUpdate): void;

	setEndState(lineNumber: number, state: IState): void;

	backgroundTokenizationFinished(): void;
}

export interface IState {
	clone(): IState;
	equals(other: IState): boolean;
}

export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

export interface Hover {
	contents: IMarkdownString[];

	range?: IRange;

	canIncreaseVerbosity?: boolean;

	canDecreaseVerbosity?: boolean;
}

export interface HoverProvider<THover = Hover> {
	provideHover(model: model.ITextModel, position: Position, token: CancellationToken, context?: HoverContext<THover>): ProviderResult<THover>;
}

export interface HoverContext<THover = Hover> {
	verbosityRequest?: HoverVerbosityRequest<THover>;
}

export interface HoverVerbosityRequest<THover = Hover> {
	verbosityDelta: number;
	previousHover: THover;
}

export enum HoverVerbosityAction {
	Increase,
	Decrease
}

/**
 * An evaluatable expression represents additional information for an expression in a document. Evaluatable expressions are
 * evaluated by a debugger or runtime and their result is rendered in a tooltip-like widget.
 * @internal
 */
export interface EvaluatableExpression {
	range: IRange;
	expression?: string;
}


/**
 * The evaluatable expression provider interface defines the contract between extensions and
 * the debug hover.
 * @internal
 */
export interface EvaluatableExpressionProvider {
	provideEvaluatableExpression(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<EvaluatableExpression>;
}

/**
 * A value-object that contains contextual information when requesting inline values from a InlineValuesProvider.
 * @internal
 */
export interface InlineValueContext {
	frameId: number;
	stoppedLocation: Range;
}

/**
 * Provide inline value as text.
 * @internal
 */
export interface InlineValueText {
	type: 'text';
	range: IRange;
	text: string;
}

/**
 * Provide inline value through a variable lookup.
 * @internal
 */
export interface InlineValueVariableLookup {
	type: 'variable';
	range: IRange;
	variableName?: string;
	caseSensitiveLookup: boolean;
}

/**
 * Provide inline value through an expression evaluation.
 * @internal
 */
export interface InlineValueExpression {
	type: 'expression';
	range: IRange;
	expression?: string;
}

/**
 * Inline value information can be provided by different means:
 * - directly as a text value (class InlineValueText).
 * - as a name to use for a variable lookup (class InlineValueVariableLookup)
 * - as an evaluatable expression (class InlineValueEvaluatableExpression)
 * The InlineValue types combines all inline value types into one type.
 * @internal
 */
export type InlineValue = InlineValueText | InlineValueVariableLookup | InlineValueExpression;

/**
 * The inline values provider interface defines the contract between extensions and
 * the debugger's inline values feature.
 * @internal
 */
export interface InlineValuesProvider {
	onDidChangeInlineValues?: Event<void> | undefined;
	provideInlineValues(model: model.ITextModel, viewPort: Range, context: InlineValueContext, token: CancellationToken): ProviderResult<InlineValue[]>;
}

export const enum CompletionItemKind {
	Method,
	Function,
	Constructor,
	Field,
	Variable,
	Class,
	Struct,
	Interface,
	Module,
	Property,
	Event,
	Operator,
	Unit,
	Value,
	Constant,
	Enum,
	EnumMember,
	Keyword,
	Text,
	Color,
	File,
	Reference,
	Customcolor,
	Folder,
	TypeParameter,
	User,
	Issue,
	Tool,
	Snippet,
}

/**
 * @internal
 */
export namespace CompletionItemKinds {

	const byKind = new Map<CompletionItemKind, ThemeIcon>();
	byKind.set(CompletionItemKind.Method, Codicon.symbolMethod);
	byKind.set(CompletionItemKind.Function, Codicon.symbolFunction);
	byKind.set(CompletionItemKind.Constructor, Codicon.symbolConstructor);
	byKind.set(CompletionItemKind.Field, Codicon.symbolField);
	byKind.set(CompletionItemKind.Variable, Codicon.symbolVariable);
	byKind.set(CompletionItemKind.Class, Codicon.symbolClass);
	byKind.set(CompletionItemKind.Struct, Codicon.symbolStruct);
	byKind.set(CompletionItemKind.Interface, Codicon.symbolInterface);
	byKind.set(CompletionItemKind.Module, Codicon.symbolModule);
	byKind.set(CompletionItemKind.Property, Codicon.symbolProperty);
	byKind.set(CompletionItemKind.Event, Codicon.symbolEvent);
	byKind.set(CompletionItemKind.Operator, Codicon.symbolOperator);
	byKind.set(CompletionItemKind.Unit, Codicon.symbolUnit);
	byKind.set(CompletionItemKind.Value, Codicon.symbolValue);
	byKind.set(CompletionItemKind.Enum, Codicon.symbolEnum);
	byKind.set(CompletionItemKind.Constant, Codicon.symbolConstant);
	byKind.set(CompletionItemKind.EnumMember, Codicon.symbolEnumMember);
	byKind.set(CompletionItemKind.Keyword, Codicon.symbolKeyword);
	byKind.set(CompletionItemKind.Snippet, Codicon.symbolSnippet);
	byKind.set(CompletionItemKind.Text, Codicon.symbolText);
	byKind.set(CompletionItemKind.Color, Codicon.symbolColor);
	byKind.set(CompletionItemKind.File, Codicon.symbolFile);
	byKind.set(CompletionItemKind.Reference, Codicon.symbolReference);
	byKind.set(CompletionItemKind.Customcolor, Codicon.symbolCustomColor);
	byKind.set(CompletionItemKind.Folder, Codicon.symbolFolder);
	byKind.set(CompletionItemKind.TypeParameter, Codicon.symbolTypeParameter);
	byKind.set(CompletionItemKind.User, Codicon.account);
	byKind.set(CompletionItemKind.Issue, Codicon.issues);
	byKind.set(CompletionItemKind.Tool, Codicon.tools);

	/**
	 * @internal
	 */
	export function toIcon(kind: CompletionItemKind): ThemeIcon {
		let codicon = byKind.get(kind);
		if (!codicon) {
			console.info('No codicon found for CompletionItemKind ' + kind);
			codicon = Codicon.symbolProperty;
		}
		return codicon;
	}

	/**
	 * @internal
	 */
	export function toLabel(kind: CompletionItemKind): string {
		switch (kind) {
			case CompletionItemKind.Method: return localize('suggestWidget.kind.method', 'Method');
			case CompletionItemKind.Function: return localize('suggestWidget.kind.function', 'Function');
			case CompletionItemKind.Constructor: return localize('suggestWidget.kind.constructor', 'Constructor');
			case CompletionItemKind.Field: return localize('suggestWidget.kind.field', 'Field');
			case CompletionItemKind.Variable: return localize('suggestWidget.kind.variable', 'Variable');
			case CompletionItemKind.Class: return localize('suggestWidget.kind.class', 'Class');
			case CompletionItemKind.Struct: return localize('suggestWidget.kind.struct', 'Struct');
			case CompletionItemKind.Interface: return localize('suggestWidget.kind.interface', 'Interface');
			case CompletionItemKind.Module: return localize('suggestWidget.kind.module', 'Module');
			case CompletionItemKind.Property: return localize('suggestWidget.kind.property', 'Property');
			case CompletionItemKind.Event: return localize('suggestWidget.kind.event', 'Event');
			case CompletionItemKind.Operator: return localize('suggestWidget.kind.operator', 'Operator');
			case CompletionItemKind.Unit: return localize('suggestWidget.kind.unit', 'Unit');
			case CompletionItemKind.Value: return localize('suggestWidget.kind.value', 'Value');
			case CompletionItemKind.Constant: return localize('suggestWidget.kind.constant', 'Constant');
			case CompletionItemKind.Enum: return localize('suggestWidget.kind.enum', 'Enum');
			case CompletionItemKind.EnumMember: return localize('suggestWidget.kind.enumMember', 'Enum Member');
			case CompletionItemKind.Keyword: return localize('suggestWidget.kind.keyword', 'Keyword');
			case CompletionItemKind.Text: return localize('suggestWidget.kind.text', 'Text');
			case CompletionItemKind.Color: return localize('suggestWidget.kind.color', 'Color');
			case CompletionItemKind.File: return localize('suggestWidget.kind.file', 'File');
			case CompletionItemKind.Reference: return localize('suggestWidget.kind.reference', 'Reference');
			case CompletionItemKind.Customcolor: return localize('suggestWidget.kind.customcolor', 'Custom Color');
			case CompletionItemKind.Folder: return localize('suggestWidget.kind.folder', 'Folder');
			case CompletionItemKind.TypeParameter: return localize('suggestWidget.kind.typeParameter', 'Type Parameter');
			case CompletionItemKind.User: return localize('suggestWidget.kind.user', 'User');
			case CompletionItemKind.Issue: return localize('suggestWidget.kind.issue', 'Issue');
			case CompletionItemKind.Tool: return localize('suggestWidget.kind.tool', 'Tool');
			case CompletionItemKind.Snippet: return localize('suggestWidget.kind.snippet', 'Snippet');
			default: return '';
		}
	}

	const data = new Map<string, CompletionItemKind>();
	data.set('method', CompletionItemKind.Method);
	data.set('function', CompletionItemKind.Function);
	data.set('constructor', CompletionItemKind.Constructor);
	data.set('field', CompletionItemKind.Field);
	data.set('variable', CompletionItemKind.Variable);
	data.set('class', CompletionItemKind.Class);
	data.set('struct', CompletionItemKind.Struct);
	data.set('interface', CompletionItemKind.Interface);
	data.set('module', CompletionItemKind.Module);
	data.set('property', CompletionItemKind.Property);
	data.set('event', CompletionItemKind.Event);
	data.set('operator', CompletionItemKind.Operator);
	data.set('unit', CompletionItemKind.Unit);
	data.set('value', CompletionItemKind.Value);
	data.set('constant', CompletionItemKind.Constant);
	data.set('enum', CompletionItemKind.Enum);
	data.set('enum-member', CompletionItemKind.EnumMember);
	data.set('enumMember', CompletionItemKind.EnumMember);
	data.set('keyword', CompletionItemKind.Keyword);
	data.set('snippet', CompletionItemKind.Snippet);
	data.set('text', CompletionItemKind.Text);
	data.set('color', CompletionItemKind.Color);
	data.set('file', CompletionItemKind.File);
	data.set('reference', CompletionItemKind.Reference);
	data.set('customcolor', CompletionItemKind.Customcolor);
	data.set('folder', CompletionItemKind.Folder);
	data.set('type-parameter', CompletionItemKind.TypeParameter);
	data.set('typeParameter', CompletionItemKind.TypeParameter);
	data.set('account', CompletionItemKind.User);
	data.set('issue', CompletionItemKind.Issue);
	data.set('tool', CompletionItemKind.Tool);

	/**
	 * @internal
	 */
	export function fromString(value: string): CompletionItemKind;
	/**
	 * @internal
	 */
	export function fromString(value: string, strict: true): CompletionItemKind | undefined;
	/**
	 * @internal
	 */
	export function fromString(value: string, strict?: boolean): CompletionItemKind | undefined {
		let res = data.get(value);
		if (typeof res === 'undefined' && !strict) {
			res = CompletionItemKind.Property;
		}
		return res;
	}
}

export interface CompletionItemLabel {
	label: string;
	detail?: string;
	description?: string;
}

export const enum CompletionItemTag {
	Deprecated = 1
}

export const enum CompletionItemInsertTextRule {
	None = 0,

	KeepWhitespace = 0b001,

	InsertAsSnippet = 0b100,
}

export interface CompletionItemRanges {
	insert: IRange;
	replace: IRange;
}

export interface CompletionItem {
	label: string | CompletionItemLabel;
	kind: CompletionItemKind;
	tags?: ReadonlyArray<CompletionItemTag>;
	detail?: string;
	documentation?: string | IMarkdownString;
	sortText?: string;
	filterText?: string;
	preselect?: boolean;
	insertText: string;
	insertTextRules?: CompletionItemInsertTextRule;
	range: IRange | CompletionItemRanges;
	commitCharacters?: string[];
	additionalTextEdits?: ISingleEditOperation[];
	command?: Command;
	action?: Command;
	/**
	 * @internal
	 */
	extensionId?: ExtensionIdentifier;

	/**
	 * @internal
	 */
	_id?: [number, number];
}

export interface CompletionList {
	suggestions: CompletionItem[];
	incomplete?: boolean;
	dispose?(): void;

	/**
	 * @internal
	 */
	duration?: number;
}

export interface PartialAcceptInfo {
	kind: PartialAcceptTriggerKind;
	acceptedLength: number;
}

export const enum PartialAcceptTriggerKind {
	Word = 0,
	Line = 1,
	Suggest = 2,
}

export const enum CompletionTriggerKind {
	Invoke = 0,
	TriggerCharacter = 1,
	TriggerForIncompleteCompletions = 2
}
export interface CompletionContext {
	triggerKind: CompletionTriggerKind;
	triggerCharacter?: string;
}
export interface CompletionItemProvider {

	/**
	 * Used to identify completions in the (debug) UI and telemetry. This isn't the extension identifier because extensions
	 * often contribute multiple completion item providers.
	 *
	 * @internal
	 */
	_debugDisplayName: string;

	triggerCharacters?: string[];
	provideCompletionItems(model: model.ITextModel, position: Position, context: CompletionContext, token: CancellationToken): ProviderResult<CompletionList>;

	resolveCompletionItem?(item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem>;
}

export enum InlineCompletionTriggerKind {
	Automatic = 0,

	Explicit = 1,
}

export interface IInlineCompletionChangeHint {
	readonly data?: unknown;
}

export interface InlineCompletionContext {

	readonly triggerKind: InlineCompletionTriggerKind;
	readonly selectedSuggestionInfo: SelectedSuggestionInfo | undefined;
	/**
	 * @experimental
	 * @internal
	*/
	readonly userPrompt?: string | undefined;
	/**
	 * @experimental
	 * @internal
	*/
	readonly requestUuid: string;

	readonly includeInlineEdits: boolean;
	readonly includeInlineCompletions: boolean;
	readonly requestIssuedDateTime: number;
	readonly earliestShownDateTime: number;

	readonly changeHint?: IInlineCompletionChangeHint;
}

export interface IInlineCompletionModelInfo {
	models: IInlineCompletionModel[];
	currentModelId: string;
}

export interface IInlineCompletionModel {
	name: string;
	id: string;
}

export interface IInlineCompletionProviderOption {
	readonly id: string;
	readonly label: string;
	readonly values: readonly IInlineCompletionProviderOptionValue[];
	readonly currentValueId: string;
}

export interface IInlineCompletionProviderOptionValue {
	readonly id: string;
	readonly label: string;
}

export class SelectedSuggestionInfo {
	constructor(
		public readonly range: IRange,
		public readonly text: string,
		public readonly completionKind: CompletionItemKind,
		public readonly isSnippetText: boolean,
	) {
	}

	public equals(other: SelectedSuggestionInfo): boolean {
		return Range.lift(this.range).equalsRange(other.range)
			&& this.text === other.text
			&& this.completionKind === other.completionKind
			&& this.isSnippetText === other.isSnippetText;
	}
}

export interface InlineCompletion {
	readonly insertText: string | { snippet: string } | undefined;

	readonly range?: IRange;

	readonly additionalTextEdits?: ISingleEditOperation[];

	readonly uri?: UriComponents;

	readonly command?: Command;

	readonly gutterMenuLinkAction?: Command;

	readonly shownCommand?: Command;

	readonly completeBracketPairs?: boolean;

	readonly isInlineEdit?: boolean;
	readonly showInlineEditMenu?: boolean;

	readonly showRange?: IRange;

	readonly warning?: InlineCompletionWarning;

	readonly hint?: IInlineCompletionHint;

	readonly supportsRename?: boolean;

	readonly correlationId?: string | undefined;

	readonly jumpToPosition?: IPosition;

	readonly doNotLog?: boolean;
}

export interface InlineCompletionWarning {
	message: IMarkdownString | string;
	icon?: IconPath;
}

export enum InlineCompletionHintStyle {
	Code = 1,
	Label = 2
}

export interface IInlineCompletionHint {
	range: IRange;
	style: InlineCompletionHintStyle;
	content: string;
}

export type IconPath = ThemeIcon;

export interface InlineCompletions<TItem extends InlineCompletion = InlineCompletion> {
	readonly items: readonly TItem[];
	readonly commands?: InlineCompletionCommand[];

	readonly suppressSuggestions?: boolean | undefined;

	readonly enableForwardStability?: boolean | undefined;
}

export type InlineCompletionCommand = { command: Command; icon?: ThemeIcon };

export type InlineCompletionProviderGroupId = string;

export interface InlineCompletionsProvider<T extends InlineCompletions = InlineCompletions> {
	provideInlineCompletions(model: model.ITextModel, position: Position, context: InlineCompletionContext, token: CancellationToken): ProviderResult<T>;

	handleItemDidShow?(completions: T, item: T['items'][number], updatedInsertText: string, editDeltaInfo: EditDeltaInfo): void;

	handlePartialAccept?(completions: T, item: T['items'][number], acceptedCharacters: number, info: PartialAcceptInfo): void;

	handleRejection?(completions: T, item: T['items'][number]): void;

	handleEndOfLifetime?(completions: T, item: T['items'][number], reason: InlineCompletionEndOfLifeReason<T['items'][number]>, lifetimeSummary: LifetimeSummary): void;

	disposeInlineCompletions(completions: T, reason: InlineCompletionsDisposeReason): void;

	onDidChangeInlineCompletions?: Event<IInlineCompletionChangeHint | void>;

	groupId?: InlineCompletionProviderGroupId;

	/** @internal */
	providerId?: ProviderId;

	yieldsToGroupIds?: InlineCompletionProviderGroupId[];

	excludesGroupIds?: InlineCompletionProviderGroupId[];

	displayName?: string;

	debounceDelayMs?: number;

	modelInfo?: IInlineCompletionModelInfo;
	onDidModelInfoChange?: Event<void>;
	setModelId?(modelId: string): Promise<void>;

	providerOptions?: readonly IInlineCompletionProviderOption[];
	onDidProviderOptionsChange?: Event<void>;
	setProviderOption?(optionId: string, valueId: string): Promise<void>;

	toString?(): string;
}


/** @internal */
export class ProviderId {
	public static fromExtensionId(extensionId: string | undefined): ProviderId {
		return new ProviderId(extensionId, undefined, undefined);
	}

	constructor(
		public readonly extensionId: string | undefined,
		public readonly extensionVersion: string | undefined,
		public readonly providerId: string | undefined
	) {
	}

	toString(): string {
		let result = '';
		if (this.extensionId) {
			result += this.extensionId;
		}
		if (this.extensionVersion) {
			result += `@${this.extensionVersion}`;
		}
		if (this.providerId) {
			result += `:${this.providerId}`;
		}
		if (result.length === 0) {
			result = 'unknown';
		}
		return result;
	}

	toStringWithoutVersion(): string {
		let result = '';
		if (this.extensionId) {
			result += this.extensionId;
		}
		if (this.providerId) {
			result += `:${this.providerId}`;
		}
		return result;
	}
}

/** @internal */
export class VersionedExtensionId {
	public static tryCreate(extensionId: string | undefined, version: string | undefined): VersionedExtensionId | undefined {
		if (!extensionId || !version) {
			return undefined;
		}
		return new VersionedExtensionId(extensionId, version);
	}

	constructor(
		public readonly extensionId: string,
		public readonly version: string,
	) { }

	toString(): string {
		return `${this.extensionId}@${this.version}`;
	}
}

export type InlineCompletionsDisposeReason = { kind: 'lostRace' | 'tokenCancellation' | 'other' | 'empty' | 'notTaken' };

export enum InlineCompletionEndOfLifeReasonKind {
	Accepted = 0,
	Rejected = 1,
	Ignored = 2,
}

export type InlineCompletionEndOfLifeReason<TInlineCompletion = InlineCompletion> = {
	kind: InlineCompletionEndOfLifeReasonKind.Accepted;
	alternativeAction: boolean;
} | {
	kind: InlineCompletionEndOfLifeReasonKind.Rejected;
} | {
	kind: InlineCompletionEndOfLifeReasonKind.Ignored;
	supersededBy?: TInlineCompletion;
	userTypingDisagreed: boolean;
};

export type LifetimeSummary = {
	requestUuid: string;
	correlationId: string | undefined;
	partiallyAccepted: number;
	partiallyAcceptedCountSinceOriginal: number;
	partiallyAcceptedRatioSinceOriginal: number;
	partiallyAcceptedCharactersSinceOriginal: number;
	shown: boolean;
	shownDuration: number;
	shownDurationUncollapsed: number;
	timeUntilShown: number | undefined;
	timeUntilActuallyShown: number | undefined;
	timeUntilProviderRequest: number;
	timeUntilProviderResponse: number;
	notShownReason: string | undefined;
	editorType: string;
	viewKind: string | undefined;
	preceeded: boolean;
	languageId: string;
	requestReason: string;
	performanceMarkers?: string;
	cursorColumnDistance?: number;
	cursorLineDistance?: number;
	lineCountOriginal?: number;
	lineCountModified?: number;
	characterCountOriginal?: number;
	characterCountModified?: number;
	disjointReplacements?: number;
	sameShapeReplacements?: boolean;
	typingInterval: number;
	typingIntervalCharacterCount: number;
	selectedSuggestionInfo: boolean;
	availableProviders: string;
	skuPlan: string | undefined;
	skuType: string | undefined;
	renameCreated: boolean | undefined;
	renameDuration: number | undefined;
	renameTimedOut: boolean | undefined;
	renameDroppedOtherEdits: number | undefined;
	renameDroppedRenameEdits: number | undefined;
	editKind: string | undefined;
	longDistanceHintVisible?: boolean;
	longDistanceHintDistance?: number;
	isForAnotherDocument?: boolean;
};

export interface CodeAction {
	title: string;
	command?: Command;
	edit?: WorkspaceEdit;
	diagnostics?: IMarkerData[];
	kind?: string;
	isPreferred?: boolean;
	isAI?: boolean;
	disabled?: string;
	ranges?: IRange[];
}

export const enum CodeActionTriggerType {
	Invoke = 1,
	Auto = 2,
}

/**
 * @internal
 */
export interface CodeActionContext {
	only?: string;
	trigger: CodeActionTriggerType;
}

export interface CodeActionList extends IDisposable {
	readonly actions: ReadonlyArray<CodeAction>;
}

/**
 * The code action interface defines the contract between extensions and
 * the [light bulb](https://www.dardcor-code.web.id/docs/editor/editingevolved#_code-action) feature.
 * @internal
 */
export interface CodeActionProvider {

	displayName?: string;

	extensionId?: string;

	provideCodeActions(model: model.ITextModel, range: Range | Selection, context: CodeActionContext, token: CancellationToken): ProviderResult<CodeActionList>;

	resolveCodeAction?(codeAction: CodeAction, token: CancellationToken): ProviderResult<CodeAction>;

	readonly providedCodeActionKinds?: ReadonlyArray<string>;

	readonly documentation?: ReadonlyArray<{ readonly kind: string; readonly command: Command }>;

	/**
	 * @internal
	 */
	_getAdditionalMenuItems?(context: CodeActionContext, actions: readonly CodeAction[]): Command[];
}

/**
 * @internal
 */
export interface DocumentPasteEdit {
	readonly title: string;
	readonly kind: HierarchicalKind;
	readonly handledMimeType?: string;
	yieldTo?: readonly DropYieldTo[];
	insertText: string | { readonly snippet: string };
	additionalEdit?: WorkspaceEdit;
}

/**
 * @internal
 */
export enum DocumentPasteTriggerKind {
	Automatic = 0,
	PasteAs = 1,
}

/**
 * @internal
 */
export interface DocumentPasteContext {
	readonly only?: HierarchicalKind;
	readonly triggerKind: DocumentPasteTriggerKind;
}

/**
 * @internal
 */
export interface DocumentPasteEditsSession {
	edits: readonly DocumentPasteEdit[];
	dispose(): void;
}

/**
 * @internal
 */
export interface DocumentPasteEditProvider {
	readonly id?: string;
	readonly copyMimeTypes: readonly string[];
	readonly pasteMimeTypes: readonly string[];
	readonly providedPasteEditKinds: readonly HierarchicalKind[];

	prepareDocumentPaste?(model: model.ITextModel, ranges: readonly IRange[], dataTransfer: IReadonlyVSDataTransfer, token: CancellationToken): Promise<undefined | IReadonlyVSDataTransfer>;

	provideDocumentPasteEdits?(model: model.ITextModel, ranges: readonly IRange[], dataTransfer: IReadonlyVSDataTransfer, context: DocumentPasteContext, token: CancellationToken): Promise<DocumentPasteEditsSession | undefined>;

	resolveDocumentPasteEdit?(edit: DocumentPasteEdit, token: CancellationToken): Promise<DocumentPasteEdit>;
}

export interface ParameterInformation {
	label: string | [number, number];
	documentation?: string | IMarkdownString;
}
export interface SignatureInformation {
	label: string;
	documentation?: string | IMarkdownString;
	parameters: ParameterInformation[];
	activeParameter?: number;
}
export interface SignatureHelp {
	signatures: SignatureInformation[];
	activeSignature: number;
	activeParameter: number;
}

export interface SignatureHelpResult extends IDisposable {
	value: SignatureHelp;
}

export enum SignatureHelpTriggerKind {
	Invoke = 1,
	TriggerCharacter = 2,
	ContentChange = 3,
}

export interface SignatureHelpContext {
	readonly triggerKind: SignatureHelpTriggerKind;
	readonly triggerCharacter?: string;
	readonly isRetrigger: boolean;
	readonly activeSignatureHelp?: SignatureHelp;
}

export interface SignatureHelpProvider {

	readonly signatureHelpTriggerCharacters?: ReadonlyArray<string>;
	readonly signatureHelpRetriggerCharacters?: ReadonlyArray<string>;

	provideSignatureHelp(model: model.ITextModel, position: Position, token: CancellationToken, context: SignatureHelpContext): ProviderResult<SignatureHelpResult>;
}

export enum DocumentHighlightKind {
	Text,
	Read,
	Write
}
export interface DocumentHighlight {
	range: IRange;
	kind?: DocumentHighlightKind;
}

export interface MultiDocumentHighlight {
	uri: URI;

	highlights: DocumentHighlight[];
}

export interface DocumentHighlightProvider {
	provideDocumentHighlights(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<DocumentHighlight[]>;
}

export interface MultiDocumentHighlightProvider {
	readonly selector: LanguageSelector;

	provideMultiDocumentHighlights(primaryModel: model.ITextModel, position: Position, otherModels: model.ITextModel[], token: CancellationToken): ProviderResult<Map<URI, DocumentHighlight[]>>;
}

export interface LinkedEditingRangeProvider {

	provideLinkedEditingRanges(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<LinkedEditingRanges>;
}

export interface LinkedEditingRanges {
	ranges: IRange[];

	wordPattern?: RegExp;
}

export interface ReferenceContext {
	includeDeclaration: boolean;
}
export interface ReferenceProvider {
	provideReferences(model: model.ITextModel, position: Position, context: ReferenceContext, token: CancellationToken): ProviderResult<Location[]>;
}

export interface Location {
	uri: URI;
	range: IRange;
}

export interface LocationLink {
	originSelectionRange?: IRange;

	uri: URI;

	range: IRange;

	targetSelectionRange?: IRange;
}

/**
 * @internal
 */
export function isLocationLink(thing: unknown): thing is LocationLink {
	return !!thing
		&& URI.isUri((thing as LocationLink).uri)
		&& Range.isIRange((thing as LocationLink).range)
		&& (Range.isIRange((thing as LocationLink).originSelectionRange) || Range.isIRange((thing as LocationLink).targetSelectionRange));
}

/**
 * @internal
 */
export function isLocation(thing: unknown): thing is Location {
	return !!thing
		&& URI.isUri((thing as Location).uri)
		&& Range.isIRange((thing as Location).range);
}


export type Definition = Location | Location[] | LocationLink[];

export interface DefinitionProvider {
	provideDefinition(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
}

export interface DeclarationProvider {
	provideDeclaration(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
}

export interface ImplementationProvider {
	provideImplementation(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
}

export interface TypeDefinitionProvider {
	provideTypeDefinition(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
}

export const enum SymbolKind {
	File = 0,
	Module = 1,
	Namespace = 2,
	Package = 3,
	Class = 4,
	Method = 5,
	Property = 6,
	Field = 7,
	Constructor = 8,
	Enum = 9,
	Interface = 10,
	Function = 11,
	Variable = 12,
	Constant = 13,
	String = 14,
	Number = 15,
	Boolean = 16,
	Array = 17,
	Object = 18,
	Key = 19,
	Null = 20,
	EnumMember = 21,
	Struct = 22,
	Event = 23,
	Operator = 24,
	TypeParameter = 25
}

/**
 * @internal
 */
export const symbolKindNames: { [symbol: number]: string } = {
	[SymbolKind.Array]: localize('Array', "array"),
	[SymbolKind.Boolean]: localize('Boolean', "boolean"),
	[SymbolKind.Class]: localize('Class', "class"),
	[SymbolKind.Constant]: localize('Constant', "constant"),
	[SymbolKind.Constructor]: localize('Constructor', "constructor"),
	[SymbolKind.Enum]: localize('Enum', "enumeration"),
	[SymbolKind.EnumMember]: localize('EnumMember', "enumeration member"),
	[SymbolKind.Event]: localize('Event', "event"),
	[SymbolKind.Field]: localize('Field', "field"),
	[SymbolKind.File]: localize('File', "file"),
	[SymbolKind.Function]: localize('Function', "function"),
	[SymbolKind.Interface]: localize('Interface', "interface"),
	[SymbolKind.Key]: localize('Key', "key"),
	[SymbolKind.Method]: localize('Method', "method"),
	[SymbolKind.Module]: localize('Module', "module"),
	[SymbolKind.Namespace]: localize('Namespace', "namespace"),
	[SymbolKind.Null]: localize('Null', "null"),
	[SymbolKind.Number]: localize('Number', "number"),
	[SymbolKind.Object]: localize('Object', "object"),
	[SymbolKind.Operator]: localize('Operator', "operator"),
	[SymbolKind.Package]: localize('Package', "package"),
	[SymbolKind.Property]: localize('Property', "property"),
	[SymbolKind.String]: localize('String', "string"),
	[SymbolKind.Struct]: localize('Struct', "struct"),
	[SymbolKind.TypeParameter]: localize('TypeParameter', "type parameter"),
	[SymbolKind.Variable]: localize('Variable', "variable"),
};

/**
 * @internal
 */
export function getAriaLabelForSymbol(symbolName: string, kind: SymbolKind): string {
	return localize('symbolAriaLabel', '{0} ({1})', symbolName, symbolKindNames[kind]);
}

export const enum SymbolTag {
	Deprecated = 1,
}

/**
 * @internal
 */
export namespace SymbolKinds {

	const byKind = new Map<SymbolKind, ThemeIcon>();
	byKind.set(SymbolKind.File, Codicon.symbolFile);
	byKind.set(SymbolKind.Module, Codicon.symbolModule);
	byKind.set(SymbolKind.Namespace, Codicon.symbolNamespace);
	byKind.set(SymbolKind.Package, Codicon.symbolPackage);
	byKind.set(SymbolKind.Class, Codicon.symbolClass);
	byKind.set(SymbolKind.Method, Codicon.symbolMethod);
	byKind.set(SymbolKind.Property, Codicon.symbolProperty);
	byKind.set(SymbolKind.Field, Codicon.symbolField);
	byKind.set(SymbolKind.Constructor, Codicon.symbolConstructor);
	byKind.set(SymbolKind.Enum, Codicon.symbolEnum);
	byKind.set(SymbolKind.Interface, Codicon.symbolInterface);
	byKind.set(SymbolKind.Function, Codicon.symbolFunction);
	byKind.set(SymbolKind.Variable, Codicon.symbolVariable);
	byKind.set(SymbolKind.Constant, Codicon.symbolConstant);
	byKind.set(SymbolKind.String, Codicon.symbolString);
	byKind.set(SymbolKind.Number, Codicon.symbolNumber);
	byKind.set(SymbolKind.Boolean, Codicon.symbolBoolean);
	byKind.set(SymbolKind.Array, Codicon.symbolArray);
	byKind.set(SymbolKind.Object, Codicon.symbolObject);
	byKind.set(SymbolKind.Key, Codicon.symbolKey);
	byKind.set(SymbolKind.Null, Codicon.symbolNull);
	byKind.set(SymbolKind.EnumMember, Codicon.symbolEnumMember);
	byKind.set(SymbolKind.Struct, Codicon.symbolStruct);
	byKind.set(SymbolKind.Event, Codicon.symbolEvent);
	byKind.set(SymbolKind.Operator, Codicon.symbolOperator);
	byKind.set(SymbolKind.TypeParameter, Codicon.symbolTypeParameter);
	/**
	 * @internal
	 */
	export function toIcon(kind: SymbolKind): ThemeIcon {
		let icon = byKind.get(kind);
		if (!icon) {
			console.info('No codicon found for SymbolKind ' + kind);
			icon = Codicon.symbolProperty;
		}
		return icon;
	}

	const byCompletionKind = new Map<SymbolKind, CompletionItemKind>();
	byCompletionKind.set(SymbolKind.File, CompletionItemKind.File);
	byCompletionKind.set(SymbolKind.Module, CompletionItemKind.Module);
	byCompletionKind.set(SymbolKind.Namespace, CompletionItemKind.Module);
	byCompletionKind.set(SymbolKind.Package, CompletionItemKind.Module);
	byCompletionKind.set(SymbolKind.Class, CompletionItemKind.Class);
	byCompletionKind.set(SymbolKind.Method, CompletionItemKind.Method);
	byCompletionKind.set(SymbolKind.Property, CompletionItemKind.Property);
	byCompletionKind.set(SymbolKind.Field, CompletionItemKind.Field);
	byCompletionKind.set(SymbolKind.Constructor, CompletionItemKind.Constructor);
	byCompletionKind.set(SymbolKind.Enum, CompletionItemKind.Enum);
	byCompletionKind.set(SymbolKind.Interface, CompletionItemKind.Interface);
	byCompletionKind.set(SymbolKind.Function, CompletionItemKind.Function);
	byCompletionKind.set(SymbolKind.Variable, CompletionItemKind.Variable);
	byCompletionKind.set(SymbolKind.Constant, CompletionItemKind.Constant);
	byCompletionKind.set(SymbolKind.String, CompletionItemKind.Text);
	byCompletionKind.set(SymbolKind.Number, CompletionItemKind.Value);
	byCompletionKind.set(SymbolKind.Boolean, CompletionItemKind.Value);
	byCompletionKind.set(SymbolKind.Array, CompletionItemKind.Value);
	byCompletionKind.set(SymbolKind.Object, CompletionItemKind.Value);
	byCompletionKind.set(SymbolKind.Key, CompletionItemKind.Keyword);
	byCompletionKind.set(SymbolKind.Null, CompletionItemKind.Value);
	byCompletionKind.set(SymbolKind.EnumMember, CompletionItemKind.EnumMember);
	byCompletionKind.set(SymbolKind.Struct, CompletionItemKind.Struct);
	byCompletionKind.set(SymbolKind.Event, CompletionItemKind.Event);
	byCompletionKind.set(SymbolKind.Operator, CompletionItemKind.Operator);
	byCompletionKind.set(SymbolKind.TypeParameter, CompletionItemKind.TypeParameter);
	/**
	 * @internal
	 */
	export function toCompletionKind(kind: SymbolKind): CompletionItemKind {
		let completionKind = byCompletionKind.get(kind);
		if (completionKind === undefined) {
			console.info('No completion kind found for SymbolKind ' + kind);
			completionKind = CompletionItemKind.File;
		}
		return completionKind;
	}
}

export interface DocumentSymbol {
	name: string;
	detail: string;
	kind: SymbolKind;
	tags: ReadonlyArray<SymbolTag>;
	containerName?: string;
	range: IRange;
	selectionRange: IRange;
	children?: DocumentSymbol[];
}

export interface DocumentSymbolProvider {

	displayName?: string;

	provideDocumentSymbols(model: model.ITextModel, token: CancellationToken): ProviderResult<DocumentSymbol[]>;
}

export interface TextEdit {
	range: IRange;
	text: string;
	eol?: model.EndOfLineSequence;
}

/** @internal */
export abstract class TextEdit {
	static asEditOperation(edit: TextEdit): ISingleEditOperation {
		const range = Range.lift(edit.range);
		return range.isEmpty()
			? EditOperation.insert(range.getStartPosition(), edit.text)
			: EditOperation.replace(range, edit.text);
	}
	static isTextEdit(thing: unknown): thing is TextEdit {
		const possibleTextEdit = thing as TextEdit;
		return typeof possibleTextEdit.text === 'string' && Range.isIRange(possibleTextEdit.range);
	}
}

export interface FormattingOptions {
	tabSize: number;
	insertSpaces: boolean;
}
export interface DocumentFormattingEditProvider {

	/**
	 * @internal
	 */
	readonly extensionId?: ExtensionIdentifier;

	readonly displayName?: string;

	provideDocumentFormattingEdits(model: model.ITextModel, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
}
export interface DocumentRangeFormattingEditProvider {
	/**
	 * @internal
	 */
	readonly extensionId?: ExtensionIdentifier;

	readonly displayName?: string;

	provideDocumentRangeFormattingEdits(model: model.ITextModel, range: Range, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;

	provideDocumentRangesFormattingEdits?(model: model.ITextModel, ranges: Range[], options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
}
export interface OnTypeFormattingEditProvider {


	/**
	 * @internal
	 */
	readonly extensionId?: ExtensionIdentifier;

	autoFormatTriggerCharacters: string[];

	provideOnTypeFormattingEdits(model: model.ITextModel, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
}

/**
 * @internal
 */
export interface IInplaceReplaceSupportResult {
	value: string;
	range: IRange;
}

export interface ILink {
	range: IRange;
	url?: URI | string;
	tooltip?: string;
}

export interface ILinksList {
	links: ILink[];
	dispose?(): void;
}
export interface LinkProvider {
	provideLinks(model: model.ITextModel, token: CancellationToken): ProviderResult<ILinksList>;
	resolveLink?: (link: ILink, token: CancellationToken) => ProviderResult<ILink>;
}

export interface IColor {

	readonly red: number;

	readonly green: number;

	readonly blue: number;

	readonly alpha: number;
}

export interface IColorPresentation {
	label: string;
	textEdit?: TextEdit;
	additionalTextEdits?: TextEdit[];
}

export interface IColorInformation {

	range: IRange;

	color: IColor;
}

export interface DocumentColorProvider {
	provideDocumentColors(model: model.ITextModel, token: CancellationToken): ProviderResult<IColorInformation[]>;
	provideColorPresentations(model: model.ITextModel, colorInfo: IColorInformation, token: CancellationToken): ProviderResult<IColorPresentation[]>;
}

export interface SelectionRange {
	range: IRange;
}

export interface SelectionRangeProvider {
	provideSelectionRanges(model: model.ITextModel, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[][]>;
}

export interface FoldingContext {
}
export interface FoldingRangeProvider {

	/**
	 * @internal
	 */
	readonly id?: string;

	onDidChange?: Event<this>;

	provideFoldingRanges(model: model.ITextModel, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRange[]>;
}

export interface FoldingRange {

	start: number;

	end: number;

	kind?: FoldingRangeKind;
}
export class FoldingRangeKind {
	static readonly Comment = new FoldingRangeKind('comment');
	static readonly Imports = new FoldingRangeKind('imports');
	static readonly Region = new FoldingRangeKind('region');

	static fromValue(value: string) {
		switch (value) {
			case 'comment': return FoldingRangeKind.Comment;
			case 'imports': return FoldingRangeKind.Imports;
			case 'region': return FoldingRangeKind.Region;
		}
		return new FoldingRangeKind(value);
	}

	public constructor(public value: string) {
	}
}


export interface WorkspaceEditMetadata {
	needsConfirmation: boolean;
	label: string;
	description?: string;
	/**
	 * @internal
	 */
	iconPath?: ThemeIcon | URI | { light: URI; dark: URI };
}

export interface WorkspaceFileEditOptions {
	overwrite?: boolean;
	ignoreIfNotExists?: boolean;
	ignoreIfExists?: boolean;
	recursive?: boolean;
	copy?: boolean;
	folder?: boolean;
	skipTrashBin?: boolean;
	maxSize?: number;

	/**
	 * @internal
	 */
	contents?: Promise<VSBuffer>;
}

export interface IWorkspaceFileEdit {
	oldResource?: URI;
	newResource?: URI;
	options?: WorkspaceFileEditOptions;
	metadata?: WorkspaceEditMetadata;
}

export interface IWorkspaceTextEdit {
	resource: URI;
	textEdit: TextEdit & { insertAsSnippet?: boolean; keepWhitespace?: boolean };
	versionId: number | undefined;
	metadata?: WorkspaceEditMetadata;
}

export interface WorkspaceEdit {
	edits: Array<IWorkspaceTextEdit | IWorkspaceFileEdit | ICustomEdit>;
}

export interface ICustomEdit {
	readonly resource: URI;
	readonly metadata?: WorkspaceEditMetadata;
	undo(): Promise<void> | void;
	redo(): Promise<void> | void;
}

export interface Rejection {
	rejectReason?: string;
}
export interface RenameLocation {
	range: IRange;
	text: string;
}

export interface RenameProvider {
	provideRenameEdits(model: model.ITextModel, position: Position, newName: string, token: CancellationToken): ProviderResult<WorkspaceEdit & Rejection>;
	resolveRenameLocation?(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<RenameLocation & Rejection>;
}

export enum NewSymbolNameTag {
	AIGenerated = 1
}

export enum NewSymbolNameTriggerKind {
	Invoke = 0,
	Automatic = 1,
}

export interface NewSymbolName {
	readonly newSymbolName: string;
	readonly tags?: readonly NewSymbolNameTag[];
}

export interface NewSymbolNamesProvider {
	supportsAutomaticNewSymbolNamesTriggerKind?: Promise<boolean | undefined>;
	provideNewSymbolNames(model: model.ITextModel, range: IRange, triggerKind: NewSymbolNameTriggerKind, token: CancellationToken): ProviderResult<NewSymbolName[]>;
}

export interface Command {
	id: string;
	title: string;
	tooltip?: string;
	arguments?: unknown[];
}

/**
 * @internal
 */
export namespace Command {

	/**
	 * @internal
	 */
	export function is(obj: unknown): obj is Command {
		if (!obj || typeof obj !== 'object') {
			return false;
		}
		return typeof (<Command>obj).id === 'string' &&
			typeof (<Command>obj).title === 'string';
	}
}

/**
 * @internal
 */
export interface CommentThreadTemplate {
	controllerHandle: number;
	label: string;
	acceptInputCommand?: Command;
	additionalCommands?: Command[];
	deleteCommand?: Command;
}

/**
 * @internal
 */
export interface CommentInfo<T = IRange> {
	extensionId?: string;
	threads: CommentThread<T>[];
	pendingCommentThreads?: PendingCommentThread[];
	commentingRanges: CommentingRanges;
}


/**
 * @internal
 */
export interface CommentingRangeResourceHint {
	schemes: readonly string[];
}

/**
 * @internal
 */
export enum CommentThreadCollapsibleState {
	Collapsed = 0,
	Expanded = 1
}

/**
 * @internal
 */
export enum CommentThreadState {
	Unresolved = 0,
	Resolved = 1
}

/**
 * @internal
 */
export enum CommentThreadApplicability {
	Current = 0,
	Outdated = 1
}

/**
 * @internal
 */
export interface CommentWidget {
	commentThread: CommentThread;
	comment?: Comment;
	input: string;
	readonly onDidChangeInput: Event<string>;
}

/**
 * @internal
 */
export interface CommentInput {
	value: string;
	uri: URI;
}

export interface CommentThreadRevealOptions {
	preserveFocus: boolean;
	focusReply: boolean;
}

/**
 * @internal
 */
export interface CommentThread<T = IRange> {
	isDocumentCommentThread(): this is CommentThread<IRange>;
	commentThreadHandle: number;
	controllerHandle: number;
	extensionId?: string;
	threadId: string;
	resource: string | null;
	range: T | undefined;
	label: string | undefined;
	contextValue: string | undefined;
	comments: ReadonlyArray<Comment> | undefined;
	readonly onDidChangeComments: Event<readonly Comment[] | undefined>;
	collapsibleState?: CommentThreadCollapsibleState;
	initialCollapsibleState?: CommentThreadCollapsibleState;
	readonly onDidChangeInitialCollapsibleState: Event<CommentThreadCollapsibleState | undefined>;
	state?: CommentThreadState;
	applicability?: CommentThreadApplicability;
	canReply: boolean | CommentAuthorInformation;
	input?: CommentInput;
	readonly onDidChangeInput: Event<CommentInput | undefined>;
	readonly onDidChangeLabel: Event<string | undefined>;
	readonly onDidChangeCollapsibleState: Event<CommentThreadCollapsibleState | undefined>;
	readonly onDidChangeState: Event<CommentThreadState | undefined>;
	readonly onDidChangeCanReply: Event<boolean>;
	isDisposed: boolean;
	isTemplate: boolean;
}

/**
 * @internal
 */
export interface AddedCommentThread<T = IRange> extends CommentThread<T> {
	editorId?: string;
}

/**
 * @internal
 */

export interface CommentingRanges {
	readonly resource: URI;
	ranges: IRange[];
	fileComments: boolean;
}

export interface CommentAuthorInformation {
	name: string;
	iconPath?: UriComponents;

}

/**
 * @internal
 */
export interface CommentReaction {
	readonly label?: string;
	readonly iconPath?: UriComponents;
	readonly count?: number;
	readonly hasReacted?: boolean;
	readonly canEdit?: boolean;
	readonly reactors?: readonly string[];
}

/**
 * @internal
 */
export interface CommentOptions {
	prompt?: string;

	placeHolder?: string;
}

/**
 * @internal
 */
export enum CommentMode {
	Editing = 0,
	Preview = 1
}

/**
 * @internal
 */
export enum CommentState {
	Published = 0,
	Draft = 1
}

/**
 * @internal
 */
export interface Comment {
	readonly uniqueIdInThread: number;
	readonly body: string | IMarkdownString;
	readonly userName: string;
	readonly userIconPath?: UriComponents;
	readonly contextValue?: string;
	readonly commentReactions?: CommentReaction[];
	readonly label?: string;
	readonly mode?: CommentMode;
	readonly state?: CommentState;
	readonly timestamp?: string;
}

export interface PendingCommentThread {
	range: IRange | undefined;
	uri: URI;
	uniqueOwner: string;
	isReply: boolean;
	comment: PendingComment;
}

export interface PendingComment {
	body: string;
	cursor: IPosition;
}

/**
 * @internal
 */
export interface CommentThreadChangedEvent<T> {
	readonly pending: PendingCommentThread[];

	readonly added: AddedCommentThread<T>[];

	readonly removed: CommentThread<T>[];

	readonly changed: CommentThread<T>[];
}

export interface CodeLens {
	range: IRange;
	id?: string;
	command?: Command;
}

export interface CodeLensList {
	readonly lenses: readonly CodeLens[];
	dispose?(): void;
}

export interface CodeLensProvider {
	onDidChange?: Event<this>;
	provideCodeLenses(model: model.ITextModel, token: CancellationToken): ProviderResult<CodeLensList>;
	resolveCodeLens?(model: model.ITextModel, codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>;
}


export enum InlayHintKind {
	Type = 1,
	Parameter = 2,
}

export interface InlayHintLabelPart {
	label: string;
	tooltip?: string | IMarkdownString;
	command?: Command;
	location?: Location;
}

export interface InlayHint {
	label: string | InlayHintLabelPart[];
	tooltip?: string | IMarkdownString;
	textEdits?: TextEdit[];
	position: IPosition;
	kind?: InlayHintKind;
	paddingLeft?: boolean;
	paddingRight?: boolean;
}

export interface InlayHintList {
	hints: InlayHint[];
	dispose(): void;
}

export interface InlayHintsProvider {
	displayName?: string;
	onDidChangeInlayHints?: Event<void>;
	provideInlayHints(model: model.ITextModel, range: Range, token: CancellationToken): ProviderResult<InlayHintList>;
	resolveInlayHint?(hint: InlayHint, token: CancellationToken): ProviderResult<InlayHint>;
}

export interface SemanticTokensLegend {
	readonly tokenTypes: string[];
	readonly tokenModifiers: string[];
}

export interface SemanticTokens {
	readonly resultId?: string;
	readonly data: Uint32Array;
}

export interface SemanticTokensEdit {
	readonly start: number;
	readonly deleteCount: number;
	readonly data?: Uint32Array;
}

export interface SemanticTokensEdits {
	readonly resultId?: string;
	readonly edits: SemanticTokensEdit[];
}

export interface DocumentSemanticTokensProvider {
	readonly onDidChange?: Event<void>;
	getLegend(): SemanticTokensLegend;
	provideDocumentSemanticTokens(model: model.ITextModel, lastResultId: string | null, token: CancellationToken): ProviderResult<SemanticTokens | SemanticTokensEdits>;
	releaseDocumentSemanticTokens(resultId: string | undefined): void;
}

export interface DocumentRangeSemanticTokensProvider {
	readonly onDidChange?: Event<void>;
	getLegend(): SemanticTokensLegend;
	provideDocumentRangeSemanticTokens(model: model.ITextModel, range: Range, token: CancellationToken): ProviderResult<SemanticTokens>;
}

/**
 * @internal
 */
export interface ITokenizationSupportChangedEvent {
	changedLanguages: string[];
	changedColorMap: boolean;
}

/**
 * @internal
 */
export interface ILazyTokenizationSupport<TSupport> {
	get tokenizationSupport(): Promise<TSupport | null>;
}

/**
 * @internal
 */
export class LazyTokenizationSupport<TSupport = ITokenizationSupport> implements IDisposable, ILazyTokenizationSupport<TSupport> {
	private _tokenizationSupport: Promise<TSupport & IDisposable | null> | null = null;

	constructor(private readonly createSupport: () => Promise<TSupport & IDisposable | null>) {
	}

	dispose(): void {
		if (this._tokenizationSupport) {
			this._tokenizationSupport.then((support) => {
				if (support) {
					support.dispose();
				}
			});
		}
	}

	get tokenizationSupport(): Promise<TSupport | null> {
		if (!this._tokenizationSupport) {
			this._tokenizationSupport = this.createSupport();
		}
		return this._tokenizationSupport;
	}
}

/**
 * @internal
 */
export interface ITokenizationRegistry<TSupport> {

	readonly onDidChange: Event<ITokenizationSupportChangedEvent>;

	handleChange(languageIds: string[]): void;

	register(languageId: string, support: TSupport): IDisposable;

	registerFactory(languageId: string, factory: ILazyTokenizationSupport<TSupport>): IDisposable;

	getOrCreate(languageId: string): Promise<TSupport | null>;

	get(languageId: string): TSupport | null;

	isResolved(languageId: string): boolean;

	setColorMap(colorMap: Color[]): void;

	getColorMap(): Color[] | null;

	getDefaultBackground(): Color | null;
}

/**
 * @internal
 */
export const TokenizationRegistry: ITokenizationRegistry<ITokenizationSupport> = new TokenizationRegistryImpl();

/**
 * @internal
 */
export enum ExternalUriOpenerPriority {
	None = 0,
	Option = 1,
	Default = 2,
	Preferred = 3,
}

/**
 * @internal
 */
export type DropYieldTo = { readonly kind: HierarchicalKind } | { readonly mimeType: string };

/**
 * @internal
 */
export interface DocumentDropEdit {
	readonly title: string;
	readonly kind: HierarchicalKind | undefined;
	readonly handledMimeType?: string;
	readonly yieldTo?: readonly DropYieldTo[];
	insertText: string | { readonly snippet: string };
	additionalEdit?: WorkspaceEdit;
}

/**
 * @internal
 */
export interface DocumentDropEditsSession {
	edits: readonly DocumentDropEdit[];
	dispose(): void;
}

/**
 * @internal
 */
export interface DocumentDropEditProvider {
	readonly id?: string;
	readonly dropMimeTypes?: readonly string[];
	readonly providedDropEditKinds?: readonly HierarchicalKind[];

	provideDocumentDropEdits(model: model.ITextModel, position: IPosition, dataTransfer: IReadonlyVSDataTransfer, token: CancellationToken): ProviderResult<DocumentDropEditsSession>;
	resolveDocumentDropEdit?(edit: DocumentDropEdit, token: CancellationToken): Promise<DocumentDropEdit>;
}
