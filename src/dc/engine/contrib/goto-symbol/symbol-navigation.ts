/**
 * Dardcor Code - Symbol Navigation Controller
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { IPosition, IRange } from "../../model/text-model.js";
import { SymbolNode, SymbolTree } from "./symbol-tree.js";
import { IDocumentSymbol } from "./goto-symbol.js";

export interface ISymbolNavigationHost {
	getPosition(): IPosition | null;
	revealRange(range: IRange): void;
}

export interface ISymbolNavigationResult {
	readonly symbol: SymbolNode | null;
	readonly direction: "next" | "previous";
	readonly index: number;
}

/**
 * Walks a SymbolTree in document order and navigates to the next / previous
 * symbol relative to the cursor position, supporting wrap-around. Works both
 * with the flattened list and the hierarchy (children before siblings).
 */
export class SymbolNavigationController extends Disposable {
	private readonly _host: ISymbolNavigationHost;
	private _tree: SymbolTree | null = null;
	private _flat: SymbolNode[] = [];

	private readonly _onDidNavigate = this._register(new Emitter<SymbolNode>());
	readonly onDidNavigate: Event<SymbolNode> = this._onDidNavigate.event;

	constructor(host: ISymbolNavigationHost) {
		super();
		this._host = host;
	}

	public setSymbols(symbols: IDocumentSymbol[]): void {
		this._tree = SymbolTree.build(symbols);
		this._flat = this._tree.flatten().sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			return a.range.startColumn - b.range.startColumn;
		});
	}

	public setTree(tree: SymbolTree): void {
		this._tree = tree;
		this._flat = tree.flatten().sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			return a.range.startColumn - b.range.startColumn;
		});
	}

	public getSymbolCount(): number {
		return this._flat.length;
	}

	public getCurrentIndex(): number {
		const position = this._host.getPosition();
		if (!position) {
			return -1;
		}
		let index = -1;
		for (let i = 0; i < this._flat.length; i++) {
			const symbol = this._flat[i];
			if (symbol.range.startLineNumber > position.lineNumber ||
				(symbol.range.startLineNumber === position.lineNumber && symbol.range.startColumn > position.column)) {
				break;
			}
			index = i;
		}
		return index;
	}

	public navigateNext(): ISymbolNavigationResult {
		const position = this._host.getPosition();
		if (this._flat.length === 0) {
			return { symbol: null, direction: "next", index: -1 };
		}
		const current = this.getCurrentIndex();
		const index = current < this._flat.length - 1 ? current + 1 : 0;
		return this._navigateTo(index, "next");
	}

	public navigatePrevious(): ISymbolNavigationResult {
		if (this._flat.length === 0) {
			return { symbol: null, direction: "previous", index: -1 };
		}
		const current = this.getCurrentIndex();
		const index = current > 0 ? current - 1 : this._flat.length - 1;
		return this._navigateTo(index, "previous");
	}

	public navigateToIndex(index: number): ISymbolNavigationResult {
		return this._navigateTo(Math.max(0, Math.min(index, this._flat.length - 1)), "next");
	}

	public navigateToName(name: string): ISymbolNavigationResult {
		const index = this._flat.findIndex(symbol => symbol.name === name);
		return index !== -1 ? this._navigateTo(index, "next") : { symbol: null, direction: "next", index: -1 };
	}

	public getSymbols(): readonly SymbolNode[] {
		return this._flat;
	}

	private _navigateTo(index: number, direction: "next" | "previous"): ISymbolNavigationResult {
		const symbol = this._flat[index] ?? null;
		if (symbol) {
			this._onDidNavigate.fire(symbol);
			this._host.revealRange(symbol.range);
		}
		return { symbol, direction, index };
	}

	public override dispose(): void {
		this._tree?.dispose();
		this._tree = null;
		super.dispose();
	}
}
