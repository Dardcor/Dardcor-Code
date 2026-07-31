/**
 * Dardcor Code - Document Symbols Navigation List
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IRange } from "../../model/text-model.js";

export enum SymbolKind {
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

export interface IDocumentSymbol {
	readonly name: string;
	readonly kind: SymbolKind;
	readonly range: IRange;
	readonly detail: string;
}

export interface IGotoSymbolHost {
	getContainer(): HTMLElement;
	revealLine(lineNumber: number): void;
}

const SYMBOL_PATTERNS: { regex: RegExp; kind: SymbolKind; nameGroup: number }[] = [
	{ regex: /^\s*(?:export\s+|declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Function, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Class, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Interface, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Enum, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?namespace\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/, kind: SymbolKind.Namespace, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?(?:type|abstract|readonly|static|public|private|protected|async)*\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{;]+)?\{/, kind: SymbolKind.Method, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?(?:let|const|var)\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Variable, nameGroup: 1 }
];

export class GotoSymbol extends Disposable {
	private readonly _host: IGotoSymbolHost;
	private readonly _domNode: HTMLElement;
	private readonly _listNode: HTMLElement;
	private _symbols: IDocumentSymbol[] = [];
	private _isVisible: boolean = false;

	private readonly _onDidNavigate = this._register(new Emitter<IDocumentSymbol>());
	readonly onDidNavigate: Event<IDocumentSymbol> = this._onDidNavigate.event;

	constructor(host: IGotoSymbolHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-goto-symbol-widget");
		this._listNode = $<HTMLElement>("div", "dc-goto-symbol-list");
		this._domNode.appendChild(this._listNode);
		this._domNode.style.cssText = "position:absolute;z-index:62;display:none;min-width:260px;max-width:420px;max-height:300px;overflow-y:auto;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);padding:4px 0;font-family:Consolas, monospace;font-size:13px;color:#d4d4d4;";
		host.getContainer().appendChild(this._domNode);

		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
		this._register(addDisposableListener(this._listNode, "click", e => {
			const target = (e.target as HTMLElement).closest(".dc-goto-symbol-item") as HTMLElement | null;
			if (target) {
				const symbol = this._symbols[Number(target.getAttribute("data-index"))];
				if (symbol) {
					this.hide();
					this._onDidNavigate.fire(symbol);
				}
			}
		}));
	}

	public computeSymbols(model: ITextModel): IDocumentSymbol[] {
		const symbols: IDocumentSymbol[] = [];
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			for (const pattern of SYMBOL_PATTERNS) {
				const match = pattern.regex.exec(text);
				if (match) {
					const name = match[pattern.nameGroup];
					if (name && !name.startsWith("if") && !name.startsWith("for") && !name.startsWith("while")) {
						symbols.push({
							name,
							kind: pattern.kind,
							range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: Math.max(1, text.length) },
							detail: text.trim()
						});
						break;
					}
				}
			}
		}
		return symbols;
	}

	public show(anchor: { x: number; y: number }, symbols: IDocumentSymbol[], query: string = ""): void {
		this._symbols = symbols;
		this._render(query);
		const parent = this._domNode.parentElement;
		if (parent) {
			const rect = parent.getBoundingClientRect();
			let left = anchor.x;
			let top = anchor.y + 20;
			if (top + this._domNode.offsetHeight > rect.height) {
				top = Math.max(0, anchor.y - this._domNode.offsetHeight);
			}
			if (left + this._domNode.offsetWidth > rect.width) {
				left = Math.max(0, rect.width - this._domNode.offsetWidth);
			}
			this._domNode.style.left = `${Math.round(left)}px`;
			this._domNode.style.top = `${Math.round(top)}px`;
		}
		this._domNode.style.display = "block";
		this._isVisible = true;
	}

	public hide(): void {
		this._isVisible = false;
		this._domNode.style.display = "none";
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public getSymbols(): readonly IDocumentSymbol[] {
		return this._symbols;
	}

	private _render(query: string): void {
		clearNode(this._listNode);
		const q = query.toLowerCase();
		const filtered = q ? this._symbols.filter(s => s.name.toLowerCase().includes(q) || s.detail.toLowerCase().includes(q)) : this._symbols;
		if (filtered.length === 0) {
			const empty = $<HTMLElement>("div");
			empty.textContent = "No symbols found";
			empty.style.cssText = "padding:6px 14px;color:#969696;";
			this._listNode.appendChild(empty);
			return;
		}
		for (let i = 0; i < filtered.length; i++) {
			const symbol = filtered[i];
			const row = $<HTMLElement>("div", "dc-goto-symbol-item");
			row.setAttribute("data-index", String(i));
			row.style.cssText = "display:flex;align-items:center;gap:8px;padding:3px 14px;cursor:pointer;";
			const icon = $<HTMLElement>("span", "dc-goto-symbol-icon");
			icon.textContent = this._kindIcon(symbol.kind);
			icon.style.cssText = "flex:none;width:16px;color:#75beff;";
			const name = $<HTMLElement>("span", "dc-goto-symbol-name");
			name.textContent = symbol.name;
			const detail = $<HTMLElement>("span", "dc-goto-symbol-detail");
			detail.textContent = `:${symbol.range.startLineNumber}`;
			detail.style.cssText = "margin-left:auto;color:#969696;font-size:11px;";
			row.appendChild(icon);
			row.appendChild(name);
			row.appendChild(detail);
			this._listNode.appendChild(row);
		}
	}

	private _kindIcon(kind: SymbolKind): string {
		switch (kind) {
			case SymbolKind.Class:
				return "C";
			case SymbolKind.Interface:
				return "I";
			case SymbolKind.Enum:
				return "E";
			case SymbolKind.Namespace:
				return "N";
			case SymbolKind.Method:
				return "ƒ";
			case SymbolKind.Variable:
			case SymbolKind.Constant:
				return "v";
			default:
				return "•";
		}
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
