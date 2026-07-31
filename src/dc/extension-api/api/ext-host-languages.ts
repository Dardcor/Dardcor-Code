/**
 * Dardcor Code - dc.languages API Bridge (Task 609)
 * Mirrors: vs/workbench/api/common/extHostLanguageFeatures.ts
 */

import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol';
import { URI } from '../../core/types/uri';
import { match as globMatch } from '../../core/formatting/glob';
import { TextDocument, ExtHostDocuments } from './ext-host-documents';
import { ExtHostDiagnostics, DiagnosticCollection } from './ext-host-diagnostics';
import { Position, Range, Location, MarkdownString, WorkspaceEdit, TextEdit, Diagnostic } from './ext-host-api-impl';
import { CancellationToken } from '../../core/async/cancellation';

export type Thenable<T> = PromiseLike<T>;

export interface IDocumentFilter {
	language?: string;
	scheme?: string;
	pattern?: string;
	notebookType?: string;
}

export type DocumentSelector = string | IDocumentFilter | Array<string | IDocumentFilter>;

export function matchesSelector(selector: DocumentSelector, uri: URI, languageId: string): boolean {
	const candidates = Array.isArray(selector) ? selector : [selector];
	for (const candidate of candidates) {
		if (typeof candidate === 'string') {
			if (candidate === languageId) {
				return true;
			}
			continue;
		}
		if (candidate.language && candidate.language !== languageId) {
			continue;
		}
		if (candidate.scheme && candidate.scheme !== uri.scheme) {
			continue;
		}
		if (candidate.pattern && !globMatch(candidate.pattern, uri.path)) {
			continue;
		}
		return true;
	}
	return false;
}

export interface Command {
	title: string;
	command: string;
	tooltip?: string;
	arguments?: any[];
}

export enum CompletionItemKind {
	Text = 0,
	Method = 1,
	Function = 2,
	Constructor = 3,
	Field = 4,
	Variable = 5,
	Class = 6,
	Interface = 7,
	Module = 8,
	Property = 9,
	Unit = 10,
	Value = 11,
	Enum = 12,
	Keyword = 13,
	Snippet = 14,
	Color = 15,
	File = 16,
	Reference = 17,
	Folder = 18,
	EnumMember = 19,
	Constant = 20,
	Struct = 21,
	Event = 22,
	Operator = 23,
	TypeParameter = 24
}

export interface CompletionItem {
	label: string | { label: string; detail?: string; description?: string };
	kind?: CompletionItemKind;
	detail?: string;
	documentation?: string | MarkdownString;
	sortText?: string;
	filterText?: string;
	preselect?: boolean;
	insertText?: string;
	insertTextRange?: Range;
	textEdit?: TextEdit;
	command?: Command;
	tags?: number[];
	additionalTextEdits?: TextEdit[];
}

export interface CompletionList {
	items: CompletionItem[];
	isIncomplete?: boolean;
}

export interface CompletionContext {
	triggerKind: number;
	triggerCharacter?: string;
}

export interface CompletionItemProvider {
	provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): CompletionItem[] | CompletionList | undefined | null | Thenable<CompletionItem[] | CompletionList | undefined | null>;
	resolveCompletionItem?(item: CompletionItem, token: CancellationToken): CompletionItem | Thenable<CompletionItem>;
}

export interface Hover {
	contents: Array<string | MarkdownString> | string | MarkdownString;
	range?: Range;
}

export interface HoverProvider {
	provideHover(document: TextDocument, position: Position, token: CancellationToken): Hover | undefined | null | Thenable<Hover | undefined | null>;
}

export interface LocationLink {
	originSelectionRange?: Range;
	targetUri: URI;
	targetRange: Range;
	targetSelectionRange?: Range;
}

export interface DefinitionProvider {
	provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Location | Location[] | LocationLink[] | undefined | null | Thenable<Location | Location[] | LocationLink[] | undefined | null>;
}

export interface ReferenceContext {
	includeDeclaration: boolean;
}

export interface ReferenceProvider {
	provideReferences(document: TextDocument, position: Position, context: ReferenceContext, token: CancellationToken): Location[] | undefined | null | Thenable<Location[] | undefined | null>;
}

export interface RenameProvider {
	provideRenameEdits(document: TextDocument, position: Position, newName: string, token: CancellationToken): WorkspaceEdit | undefined | null | Thenable<WorkspaceEdit | undefined | null>;
	prepareRename?(document: TextDocument, position: Position, token: CancellationToken): Range | { range: Range; placeholder: string } | undefined | Thenable<Range | { range: Range; placeholder: string } | undefined>;
}

export interface FormattingOptions {
	tabSize: number;
	insertSpaces: boolean;
}

export interface DocumentFormattingEditProvider {
	provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): TextEdit[] | undefined | null | Thenable<TextEdit[] | undefined | null>;
}

export interface CodeActionContext {
	diagnostics: Diagnostic[];
	only?: string;
	triggerKind?: number;
}

export interface CodeAction {
	title: string;
	kind?: string;
	edit?: WorkspaceEdit;
	command?: Command;
	isPreferred?: boolean;
	diagnostics?: Diagnostic[];
}

export interface CodeActionProvider {
	provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Array<Command | CodeAction> | undefined | null | Thenable<Array<Command | CodeAction> | undefined | null>;
}

export interface CodeLens {
	range: Range;
	command?: Command;
	isResolved?: boolean;
}

export interface CodeLensProvider {
	provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | undefined | null | Thenable<CodeLens[] | undefined | null>;
	resolveCodeLens?(codeLens: CodeLens, token: CancellationToken): CodeLens | Thenable<CodeLens>;
}

export enum InlayHintKind {
	Type = 1,
	Parameter = 2
}

export interface InlayHint {
	position: Position;
	label: string | Array<{ value: string; tooltip?: string | MarkdownString }>;
	kind?: InlayHintKind;
	paddingLeft?: boolean;
	paddingRight?: boolean;
	tooltip?: string | MarkdownString;
}

export interface InlayHintsProvider {
	provideInlayHints(document: TextDocument, range: Range, token: CancellationToken): InlayHint[] | undefined | null | Thenable<InlayHint[] | undefined | null>;
}

type ProviderKind = 'completion' | 'hover' | 'definition' | 'references' | 'rename' | 'formatting' | 'codeActions' | 'codeLens' | 'resolveCodeLens' | 'inlayHints';

interface IProviderRegistration {
	handle: number;
	kind: ProviderKind;
	selector: DocumentSelector;
	provider: any;
	triggerCharacters?: string[];
}

export interface ILanguagesApi {
	registerCompletionItemProvider(selector: DocumentSelector, provider: CompletionItemProvider, triggerCharacters?: string[]): IDisposable;
	registerHoverProvider(selector: DocumentSelector, provider: HoverProvider): IDisposable;
	registerDefinitionProvider(selector: DocumentSelector, provider: DefinitionProvider): IDisposable;
	registerReferencesProvider(selector: DocumentSelector, provider: ReferenceProvider): IDisposable;
	registerRenameProvider(selector: DocumentSelector, provider: RenameProvider): IDisposable;
	registerDocumentFormattingEditProvider(selector: DocumentSelector, provider: DocumentFormattingEditProvider): IDisposable;
	registerCodeActionsProvider(selector: DocumentSelector, provider: CodeActionProvider, metadata?: { providedCodeActionKinds?: string[] }): IDisposable;
	registerCodeLensProvider(selector: DocumentSelector, provider: CodeLensProvider): IDisposable;
	registerInlayHintsProvider(selector: DocumentSelector, provider: InlayHintsProvider): IDisposable;
	createDiagnosticCollection(name?: string): DiagnosticCollection;
}

/**
 * Bridges language feature providers running in extensions to the main
 * editor. Provider results are normalized into plain JSON payloads.
 */
export class ExtHostLanguageFeatures extends Disposable {
	private _nextHandle = 1;
	private readonly _registrations = new Map<number, IProviderRegistration>();

	constructor(
		private readonly _rpc: RPCProtocol,
		private readonly _documents: ExtHostDocuments,
		private readonly _diagnostics: ExtHostDiagnostics
	) {
		super();
	}

	public registerCompletionItemProvider(selector: DocumentSelector, provider: CompletionItemProvider, triggerCharacters?: string[]): IDisposable {
		return this._registerProvider('completion', selector, provider, triggerCharacters);
	}

	public registerHoverProvider(selector: DocumentSelector, provider: HoverProvider): IDisposable {
		return this._registerProvider('hover', selector, provider);
	}

	public registerDefinitionProvider(selector: DocumentSelector, provider: DefinitionProvider): IDisposable {
		return this._registerProvider('definition', selector, provider);
	}

	public registerReferencesProvider(selector: DocumentSelector, provider: ReferenceProvider): IDisposable {
		return this._registerProvider('references', selector, provider);
	}

	public registerRenameProvider(selector: DocumentSelector, provider: RenameProvider): IDisposable {
		return this._registerProvider('rename', selector, provider);
	}

	public registerDocumentFormattingEditProvider(selector: DocumentSelector, provider: DocumentFormattingEditProvider): IDisposable {
		return this._registerProvider('formatting', selector, provider);
	}

	public registerCodeActionsProvider(selector: DocumentSelector, provider: CodeActionProvider): IDisposable {
		return this._registerProvider('codeActions', selector, provider);
	}

	public registerCodeLensProvider(selector: DocumentSelector, provider: CodeLensProvider): IDisposable {
		return this._registerProvider('codeLens', selector, provider);
	}

	public registerInlayHintsProvider(selector: DocumentSelector, provider: InlayHintsProvider): IDisposable {
		return this._registerProvider('inlayHints', selector, provider);
	}

	public createDiagnosticCollection(name?: string): DiagnosticCollection {
		return this._diagnostics.createDiagnosticCollection(name);
	}

	public get api(): ILanguagesApi {
		return {
			registerCompletionItemProvider: (selector, provider, triggerCharacters) => this.registerCompletionItemProvider(selector, provider, triggerCharacters),
			registerHoverProvider: (selector, provider) => this.registerHoverProvider(selector, provider),
			registerDefinitionProvider: (selector, provider) => this.registerDefinitionProvider(selector, provider),
			registerReferencesProvider: (selector, provider) => this.registerReferencesProvider(selector, provider),
			registerRenameProvider: (selector, provider) => this.registerRenameProvider(selector, provider),
			registerDocumentFormattingEditProvider: (selector, provider) => this.registerDocumentFormattingEditProvider(selector, provider),
			registerCodeActionsProvider: (selector, provider) => this.registerCodeActionsProvider(selector, provider),
			registerCodeLensProvider: (selector, provider) => this.registerCodeLensProvider(selector, provider),
			registerInlayHintsProvider: (selector, provider) => this.registerInlayHintsProvider(selector, provider),
			createDiagnosticCollection: (name?: string) => this.createDiagnosticCollection(name)
		};
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				if (command === 'provide') {
					return this._provide(payload.kind, payload.handle, payload.args);
				}
				throw new Error(`Perintah languages tidak dikenal: ${command}`);
			}
		};
	}

	private _registerProvider(kind: ProviderKind, selector: DocumentSelector, provider: any, triggerCharacters?: string[]): IDisposable {
		const handle = this._nextHandle++;
		this._registrations.set(handle, { handle, kind, selector, provider, triggerCharacters });
		this._rpc.notify('main', 'languages.register', { kind, handle, selector, triggerCharacters });
		return toDisposable(() => {
			this._registrations.delete(handle);
			this._rpc.notify('main', 'languages.unregister', { kind, handle });
		});
	}

	private async _provide(kind: ProviderKind, handle: number, args: any): Promise<any> {
		const registration = this._registrations.get(handle);
		if (!registration) {
			throw new Error(`Provider tidak dikenal: handle ${handle}`);
		}
		const document = this._documents.getDocument(args.uri);
		if (!document) {
			throw new Error(`Dokumen tidak terbuka: ${args.uri}`);
		}
		const token = CancellationToken.None;
		switch (kind) {
			case 'completion':
				return this._provideCompletion(registration.provider, document, args);
			case 'hover':
				return this._provideHover(registration.provider, document, args);
			case 'definition':
				return this._provideDefinition(registration.provider, document, args);
			case 'references':
				return this._provideReferences(registration.provider, document, args);
			case 'rename':
				return this._provideRename(registration.provider, document, args);
			case 'formatting':
				return this._provideFormatting(registration.provider, document, args);
			case 'codeActions':
				return this._provideCodeActions(registration.provider, document, args);
			case 'codeLens':
				return this._provideCodeLenses(registration.provider, document, args);
			case 'resolveCodeLens':
				return this._resolveCodeLens(registration.provider, args);
			case 'inlayHints':
				return this._provideInlayHints(registration.provider, document, args);
			default:
				throw new Error(`Kinds provider tidak dikenal: ${kind}`);
		}
	}

	private async _provideCompletion(provider: CompletionItemProvider, document: TextDocument, args: any): Promise<any> {
		const position = new Position(args.position.lineNumber, args.position.column);
		const context: CompletionContext = args.context ?? { triggerKind: 0 };
		const result = await provider.provideCompletionItems(document, position, token(), context);
		const list: CompletionList = Array.isArray(result) ? { items: result } : result ?? { items: [] };
		return {
			isIncomplete: list.isIncomplete ?? false,
			items: list.items.map(item => this._serializeCompletionItem(item))
		};
	}

	private _serializeCompletionItem(item: CompletionItem): any {
		const label = typeof item.label === 'string' ? item.label : item.label.label;
		return {
			label,
			labelDetail: typeof item.label === 'string' ? undefined : item.label.detail,
			kind: item.kind ?? CompletionItemKind.Text,
			detail: item.detail,
			documentation: this._serializeDocumentation(item.documentation),
			sortText: item.sortText,
			filterText: item.filterText,
			preselect: item.preselect,
			insertText: item.insertText ?? label,
			insertTextRange: item.insertTextRange ? this._serializeRange(item.insertTextRange) : undefined,
			textEdit: item.textEdit ? { range: this._serializeRange(item.textEdit.range), newText: item.textEdit.newText } : undefined,
			command: item.command ?? undefined,
			tags: item.tags,
			additionalTextEdits: item.additionalTextEdits?.map(e => ({ range: this._serializeRange(e.range), newText: e.newText }))
		};
	}

	private async _provideHover(provider: HoverProvider, document: TextDocument, args: any): Promise<any> {
		const position = new Position(args.position.lineNumber, args.position.column);
		const result = await provider.provideHover(document, position, token());
		if (!result) {
			return undefined;
		}
		const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
		return {
			contents: contents.map((c: any) => this._serializeDocumentation(c)),
			range: result.range ? this._serializeRange(result.range) : undefined
		};
	}

	private async _provideDefinition(provider: DefinitionProvider, document: TextDocument, args: any): Promise<any> {
		const position = new Position(args.position.lineNumber, args.position.column);
		const result = await provider.provideDefinition(document, position, token());
		if (!result) {
			return [];
		}
		const locations = Array.isArray(result) ? result : [result];
		return locations.map(loc => this._serializeLocation(loc));
	}

	private async _provideReferences(provider: ReferenceProvider, document: TextDocument, args: any): Promise<any> {
		const position = new Position(args.position.lineNumber, args.position.column);
		const result = await provider.provideReferences(document, position, { includeDeclaration: args.context?.includeDeclaration ?? true }, token());
		return (result ?? []).map((loc: any) => this._serializeLocation(loc));
	}

	private async _provideRename(provider: RenameProvider, document: TextDocument, args: any): Promise<any> {
		const position = new Position(args.position.lineNumber, args.position.column);
		const result = await provider.provideRenameEdits(document, position, args.newName, token());
		return result ? result.toJSON() : null;
	}

	private async _provideFormatting(provider: DocumentFormattingEditProvider, document: TextDocument, args: any): Promise<any> {
		const options: FormattingOptions = { tabSize: args.options?.tabSize ?? 4, insertSpaces: args.options?.insertSpaces ?? true };
		const result = await provider.provideDocumentFormattingEdits(document, options, token());
		return (result ?? []).map((e: any) => ({ range: this._serializeRange(e.range), newText: e.newText }));
	}

	private async _provideCodeActions(provider: CodeActionProvider, document: TextDocument, args: any): Promise<any> {
		const range = new Range(args.range.startLineNumber, args.range.startColumn, args.range.endLineNumber, args.range.endColumn);
		const context: CodeActionContext = {
			diagnostics: (args.context?.diagnostics ?? []).map((d: any) => new Diagnostic(
				new Range(d.range.startLineNumber, d.range.startColumn, d.range.endLineNumber, d.range.endColumn),
				d.message,
				d.severity,
				d.code,
				d.source
			)),
			only: args.context?.only
		};
		const result = await provider.provideCodeActions(document, range, context, token());
		if (!result) {
			return [];
		}
		return result.map((action: any) => {
			if ('command' in action && !('title' in action)) {
				return { isCommand: true, title: action.title, command: action.command };
			}
			const codeAction = action as CodeAction;
			return {
				isCommand: false,
				title: codeAction.title,
				kind: codeAction.kind,
				isPreferred: codeAction.isPreferred,
				edit: codeAction.edit ? codeAction.edit.toJSON() : undefined,
				command: codeAction.command ?? undefined
			};
		});
	}

	private async _provideCodeLenses(provider: CodeLensProvider, document: TextDocument, args: any): Promise<any> {
		const result = await provider.provideCodeLenses(document, token());
		return (result ?? []).map((lens: any) => ({
			range: this._serializeRange(lens.range),
			command: lens.command ?? undefined,
			isResolved: lens.isResolved ?? false
		}));
	}

	private async _resolveCodeLens(provider: CodeLensProvider, args: any): Promise<any> {
		if (!provider.resolveCodeLens) {
			return args.codeLens;
		}
		const lens: CodeLens = {
			range: new Range(args.codeLens.range.startLineNumber, args.codeLens.range.startColumn, args.codeLens.range.endLineNumber, args.codeLens.range.endColumn),
			command: args.codeLens.command
		};
		const resolved = await provider.resolveCodeLens(lens, token());
		return {
			range: this._serializeRange(resolved.range),
			command: resolved.command ?? undefined,
			isResolved: true
		};
	}

	private async _provideInlayHints(provider: InlayHintsProvider, document: TextDocument, args: any): Promise<any> {
		const range = new Range(args.range.startLineNumber, args.range.startColumn, args.range.endLineNumber, args.range.endColumn);
		const result = await provider.provideInlayHints(document, range, token());
		return (result ?? []).map((hint: any) => ({
			position: hint.position.toJSON(),
			label: Array.isArray(hint.label) ? hint.label.map((l: any) => ({ value: l.value, tooltip: l.tooltip ? this._serializeDocumentation(l.tooltip) : undefined })) : hint.label,
			kind: hint.kind ?? InlayHintKind.Type,
			paddingLeft: hint.paddingLeft ?? false,
			paddingRight: hint.paddingRight ?? false,
			tooltip: hint.tooltip ? this._serializeDocumentation(hint.tooltip) : undefined
		}));
	}

	private _serializeLocation(loc: Location | LocationLink): any {
		if ('targetUri' in loc) {
			return {
				uri: (loc as LocationLink).targetUri.toString(),
				range: this._serializeRange((loc as LocationLink).targetRange),
				originSelectionRange: (loc as LocationLink).originSelectionRange ? this._serializeRange((loc as LocationLink).originSelectionRange as Range) : undefined,
				targetSelectionRange: (loc as LocationLink).targetSelectionRange ? this._serializeRange((loc as LocationLink).targetSelectionRange as Range) : undefined
			};
		}
		return { uri: (loc as Location).uri.toString(), range: this._serializeRange((loc as Location).range) };
	}

	private _serializeRange(range: Range): any {
		return {
			startLineNumber: range.start.lineNumber,
			startColumn: range.start.column,
			endLineNumber: range.end.lineNumber,
			endColumn: range.end.column
		};
	}

	private _serializeDocumentation(value: string | MarkdownString | undefined): any {
		if (value === undefined) {
			return undefined;
		}
		if (value instanceof MarkdownString) {
			return { value: value.value, isTrusted: value.isTrusted };
		}
		return { value: String(value), isTrusted: false };
	}
}

function token(): CancellationToken {
	return CancellationToken.None;
}
