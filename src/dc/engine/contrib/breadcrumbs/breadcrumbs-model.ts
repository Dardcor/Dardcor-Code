/**
 * Dardcor Code - Active Symbol Breadcrumb Path Calculator
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { IDocumentSymbol, SymbolKind } from "../goto-symbol/goto-symbol.js";

export interface IBreadcrumbsModelState {
	readonly fileName: string;
	readonly symbols: readonly IDocumentSymbol[];
	readonly activePath: readonly IDocumentSymbol[];
	readonly hasModel: boolean;
}

const SCOPE_PATTERNS: { regex: RegExp; kind: SymbolKind; nameGroup: number }[] = [
	{ regex: /^\s*(?:export\s+|declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Function, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Class, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Interface, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Enum, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?namespace\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/, kind: SymbolKind.Namespace, nameGroup: 1 },
	{ regex: /^\s*(?:type|abstract|readonly|static|public|private|protected|async)*\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/, kind: SymbolKind.Method, nameGroup: 1 }
];

export class BreadcrumbsModel extends Disposable {
	private _model: ITextModel | null = null;
	private _position: IPosition | null = null;
	private _symbols: IDocumentSymbol[] = [];
	private _activePath: IDocumentSymbol[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this._symbols = model ? this.computeSymbols(model) : [];
		this._recomputePath();
	}

	public setPosition(position: IPosition | null): void {
		this._position = position;
		this._recomputePath();
	}

	public computeSymbols(model: ITextModel): IDocumentSymbol[] {
		const symbols: IDocumentSymbol[] = [];
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			for (const pattern of SCOPE_PATTERNS) {
				const match = pattern.regex.exec(text);
				if (match) {
					const name = match[pattern.nameGroup];
					if (name) {
						symbols.push({
							name,
							kind: pattern.kind,
							range: {
								startLineNumber: line,
								startColumn: 1,
								endLineNumber: line,
								endColumn: Math.max(1, text.length)
							},
							detail: text.trim()
						});
						break;
					}
				}
			}
		}
		return symbols;
	}

	public computeActivePath(symbols: readonly IDocumentSymbol[], lineNumber: number): IDocumentSymbol[] {
		const path: IDocumentSymbol[] = [];
		for (const symbol of symbols) {
			if (symbol.range.startLineNumber > lineNumber) {
				break;
			}
			while (path.length > 0 && path[path.length - 1].range.endLineNumber < symbol.range.startLineNumber) {
				path.pop();
			}
			path.push(symbol);
		}
		return path.filter(s => s.range.endLineNumber >= lineNumber);
	}

	public getSymbols(): readonly IDocumentSymbol[] {
		return this._symbols;
	}

	public getActivePath(): readonly IDocumentSymbol[] {
		return this._activePath;
	}

	public getFileName(): string {
		const path = this._model?.uri.path ?? "";
		const parts = path.split("/");
		return parts[parts.length - 1] || path;
	}

	public getState(): IBreadcrumbsModelState {
		return {
			fileName: this.getFileName(),
			symbols: this._symbols,
			activePath: this._activePath,
			hasModel: this._model !== null
		};
	}

	public getModel(): ITextModel | null {
		return this._model;
	}

	public getPosition(): IPosition | null {
		return this._position;
	}

	public navigateToSymbol(name: string): IRange | null {
		const symbol = this._symbols.find(s => s.name === name);
		return symbol ? symbol.range : null;
	}

	private _recomputePath(): void {
		const position = this._position;
		this._activePath = position ? this.computeActivePath(this._symbols, position.lineNumber) : [];
		this._onDidChange.fire();
	}
}
