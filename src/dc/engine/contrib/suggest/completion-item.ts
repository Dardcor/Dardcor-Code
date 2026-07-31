/**
 * Dardcor Code - Suggestion Completion Item Model
 */

import { URI } from "../../../core/types/uri.js";
import { IRange } from "../../model/text-model.js";

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

export enum CompletionItemTag {
	Deprecated = 1
}

export enum CompletionTriggerKind {
	Invoke = 0,
	TriggerCharacter = 1,
	TriggerForIncompleteCompletions = 2
}

export interface ICompletionItemOptions {
	readonly label: string;
	readonly kind?: CompletionItemKind;
	readonly detail?: string;
	readonly documentation?: string;
	readonly insertText?: string;
	readonly sortText?: string;
	readonly filterText?: string;
	readonly range?: IRange;
	readonly commitCharacters?: string[];
	readonly tags?: CompletionItemTag[];
	readonly preselect?: boolean;
	readonly uri?: URI;
	readonly data?: unknown;
}

export class CompletionItem {
	readonly label: string;
	readonly kind: CompletionItemKind;
	readonly detail: string;
	readonly documentation: string;
	readonly insertText: string;
	readonly sortText: string;
	readonly filterText: string;
	readonly range: IRange | null;
	readonly commitCharacters: readonly string[];
	readonly tags: readonly CompletionItemTag[];
	readonly preselect: boolean;
	readonly uri: URI | null;
	readonly data: unknown;
	score: number = 0;
	isFavorite: boolean = false;

	constructor(options: ICompletionItemOptions) {
		this.label = options.label;
		this.kind = options.kind ?? CompletionItemKind.Text;
		this.detail = options.detail ?? "";
		this.documentation = options.documentation ?? "";
		this.insertText = options.insertText ?? options.label;
		this.sortText = options.sortText ?? options.label;
		this.filterText = options.filterText ?? options.label;
		this.range = options.range ?? null;
		this.commitCharacters = options.commitCharacters ?? [];
		this.tags = options.tags ?? [];
		this.preselect = options.preselect ?? false;
		this.uri = options.uri ?? null;
		this.data = options.data;
	}

	public isDeprecated(): boolean {
		return this.tags.includes(CompletionItemTag.Deprecated);
	}
}

export function compareCompletionItems(a: CompletionItem, b: CompletionItem): number {
	if (a.preselect !== b.preselect) {
		return a.preselect ? -1 : 1;
	}
	if (a.isFavorite !== b.isFavorite) {
		return a.isFavorite ? -1 : 1;
	}
	const diff = a.score - b.score;
	if (diff !== 0) {
		return -diff;
	}
	return a.sortText.localeCompare(b.sortText);
}

export function getCompletionItemKindName(kind: CompletionItemKind): string {
	const names = [
		"Text", "Method", "Function", "Constructor", "Field", "Variable", "Class",
		"Interface", "Module", "Property", "Unit", "Value", "Enum", "Keyword",
		"Snippet", "Color", "File", "Reference", "Folder", "EnumMember", "Constant",
		"Struct", "Event", "Operator", "TypeParameter"
	];
	return names[kind] ?? "Text";
}
