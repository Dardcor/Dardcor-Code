/**
 * Dardcor Code - Go To Symbol In File Command Action
 */

import { ITextModel, IRange } from "../../model/text-model.js";
import { IDocumentSymbol } from "./goto-symbol.js";

export interface IGotoSymbolActionHost {
	getModel(): ITextModel | null;
	getContainer(): HTMLElement;
	revealRange(range: IRange): void;
	computeSymbols(model: ITextModel): IDocumentSymbol[];
}

export interface IGotoSymbolActionResult {
	readonly handled: boolean;
	readonly symbolCount: number;
	readonly selected: IDocumentSymbol | null;
}

export interface IGotoSymbolPicker {
	show(anchor: { x: number; y: number }, symbols: IDocumentSymbol[], query: string): void;
	hide(): void;
}

export enum GotoSymbolActionId {
	GoToSymbol = "dc.editor.goToSymbol",
	QuickOutline = "dc.editor.quickOutline"
}

/**
 * Command action that opens the "Go to Symbol in File" picker populated with
 * the document symbols. Selection reveals the symbol range. The picker is
 * pluggable so the action stays usable without a hard dependency on the
 * GotoSymbol widget.
 */
export class GotoSymbolActions {
	public static open(host: IGotoSymbolActionHost, picker: IGotoSymbolPicker, anchor?: { x: number; y: number }): IGotoSymbolActionResult {
		const model = host.getModel();
		if (!model) {
			return { handled: false, symbolCount: 0, selected: null };
		}
		const symbols = host.computeSymbols(model);
		picker.show(anchor ?? { x: 8, y: 8 }, symbols, "");
		return { handled: true, symbolCount: symbols.length, selected: null };
	}

	public static navigateToSymbol(host: IGotoSymbolActionHost, symbols: readonly IDocumentSymbol[], name: string): IGotoSymbolActionResult {
		const symbol = symbols.find(s => s.name === name) ?? null;
		if (symbol) {
			host.revealRange(symbol.range);
		}
		return { handled: symbol !== null, symbolCount: symbols.length, selected: symbol };
	}

	public static filterSymbols(symbols: readonly IDocumentSymbol[], query: string): IDocumentSymbol[] {
		const q = query.toLowerCase();
		if (q.length === 0) {
			return [...symbols];
		}
		return symbols.filter(symbol =>
			symbol.name.toLowerCase().includes(q) || symbol.detail.toLowerCase().includes(q)
		);
	}

	public static getLineNumber(symbol: IDocumentSymbol): number {
		return symbol.range.startLineNumber;
	}

	public static execute(host: IGotoSymbolActionHost, picker: IGotoSymbolPicker, id: GotoSymbolActionId, anchor?: { x: number; y: number }): IGotoSymbolActionResult {
		switch (id) {
			case GotoSymbolActionId.GoToSymbol:
			case GotoSymbolActionId.QuickOutline:
				return GotoSymbolActions.open(host, picker, anchor);
			default:
				return { handled: false, symbolCount: 0, selected: null };
		}
	}
}

/**
 * Convenience: compute symbols with the same regex strategy as the existing
 * goto-symbol widget, so the action host has a default implementation.
 */
export function computeSymbolsFallback(model: ITextModel): IDocumentSymbol[] {
	const symbols: IDocumentSymbol[] = [];
	const patterns: { regex: RegExp; kind: number; nameGroup: number }[] = [
		{ regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 11, nameGroup: 1 },
		{ regex: /^\s*(?:export\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 4, nameGroup: 1 },
		{ regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 10, nameGroup: 1 },
		{ regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 9, nameGroup: 1 }
	];
	const lineCount = model.getLineCount();
	for (let line = 1; line <= lineCount; line++) {
		const text = model.getLineContent(line);
		for (const pattern of patterns) {
			const match = pattern.regex.exec(text);
			if (match) {
				symbols.push({
					name: match[pattern.nameGroup],
					kind: pattern.kind as IDocumentSymbol["kind"],
					range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: Math.max(1, text.length) },
					detail: text.trim()
				});
				break;
			}
		}
	}
	return symbols;
}
