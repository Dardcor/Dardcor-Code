/**
 * Dardcor Code - LSP textDocument/completion Request Handler (Task 629)
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { LspClient } from './lsp-client.js';
import { lspRangeToApiRange, ILspPosition } from './lsp-converters.js';
import { Position, MarkdownString } from '../api/ext-host-api-impl.js';

export enum CompletionTriggerKind {
	Invoked = 1,
	TriggerCharacter = 2,
	TriggerForIncompleteCompletions = 3
}

export interface ILspCompletionItem {
	label: string | { label: string; detail?: string; description?: string };
	kind?: number;
	detail?: string;
	documentation?: string | { kind: string; value: string };
	sortText?: string;
	filterText?: string;
	insertText?: string;
	textEdit?: { range: any; newText: string };
	insertTextFormat?: number;
	command?: { title: string; command: string; arguments?: any[] };
	preselect?: boolean;
	tags?: number[];
	additionalTextEdits?: Array<{ range: any; newText: string }>;
	data?: any;
}

export interface ILspCompletionList {
	isIncomplete?: boolean;
	items: ILspCompletionItem[];
}

export interface ICompletionRequestParams {
	readonly uri: string;
	readonly languageId: string;
	readonly text: string;
	readonly position: Position;
	readonly triggerCharacter?: string;
	readonly triggerKind?: CompletionTriggerKind;
	readonly context?: { triggerKind: CompletionTriggerKind; triggerCharacter?: string };
}

export interface ICompletionResult {
	isIncomplete: boolean;
	items: Array<Record<string, any>>;
}

export interface ILspCompletionOptions {
	readonly resolveProvider?: boolean;
}

/**
 * Sends `textDocument/completion` requests to the language server and
 * normalizes the response into editor-ready completion items.
 */
export class LspCompletionHandler extends Disposable {
	constructor(
		private readonly _client: LspClient,
		private readonly _options: ILspCompletionOptions = {}
	) {
		super();
	}

	public async provideCompletions(params: ICompletionRequestParams): Promise<ICompletionResult> {
		const lspPosition: ILspPosition = { line: params.position.lineNumber - 1, character: params.position.column - 1 };
		const context = params.context ?? {
			triggerKind: params.triggerKind ?? CompletionTriggerKind.Invoked,
			triggerCharacter: params.triggerCharacter
		};
		const result = await this._client.request<ILspCompletionList>('textDocument/completion', {
			textDocument: { uri: params.uri },
			position: lspPosition,
			context
		});
		if (!result) {
			return { isIncomplete: false, items: [] };
		}
		const list = Array.isArray(result) ? { items: result as ILspCompletionItem[] } : result;
		return {
			isIncomplete: list.isIncomplete ?? false,
			items: list.items.map(item => this._normalizeItem(item))
		};
	}

	public async resolveCompletionItem(item: Record<string, any>): Promise<Record<string, any>> {
		if (!this._options.resolveProvider) {
			return item;
		}
		const resolved = await this._client.request<ILspCompletionItem>('completionItem/resolve', item);
		return this._normalizeItem(resolved ?? (item as unknown as ILspCompletionItem));
	}

	private _normalizeItem(item: ILspCompletionItem): Record<string, any> {
		const label = typeof item.label === 'string' ? item.label : item.label.label;
		const documentation = typeof item.documentation === 'string'
			? new MarkdownString(item.documentation).toJSON()
			: item.documentation
				? new MarkdownString(item.documentation.value).toJSON()
				: undefined;
		const textEdit = item.textEdit
			? { range: lspRangeToApiRange(item.textEdit.range), newText: item.textEdit.newText }
			: undefined;
		const insertTextRange = textEdit
			? { startLineNumber: textEdit.range.start.lineNumber, startColumn: textEdit.range.start.column, endLineNumber: textEdit.range.end.lineNumber, endColumn: textEdit.range.end.column }
			: undefined;
		return {
			label,
			kind: item.kind ?? 0,
			detail: item.detail ?? (typeof item.label !== 'string' ? item.label.detail : undefined),
			documentation,
			sortText: item.sortText,
			filterText: item.filterText,
			preselect: item.preselect,
			insertText: item.insertText ?? label,
			insertTextRange,
			textEdit,
			command: item.command ?? undefined,
			tags: item.tags,
			additionalTextEdits: item.additionalTextEdits?.map(e => ({ range: lspRangeToApiRange(e.range), newText: e.newText })),
			data: item.data
		};
	}
}

export function completionTriggerKindToString(kind: CompletionTriggerKind): string {
	switch (kind) {
		case CompletionTriggerKind.TriggerCharacter:
			return 'triggerCharacter';
		case CompletionTriggerKind.TriggerForIncompleteCompletions:
			return 'incomplete';
		default:
			return 'invoked';
	}
}
