/**
 * Dardcor Code - Outline View Tree Model Adapter
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { SymbolNode, SymbolTree } from "./symbol-tree.js";
import { IDocumentSymbol, SymbolKind } from "./goto-symbol.js";

export interface IOutlineNode {
	readonly node: SymbolNode;
	readonly depth: number;
	readonly isExpanded: boolean;
}

export interface IOutlineModelState {
	readonly roots: readonly SymbolNode[];
	readonly activePath: readonly SymbolNode[];
	readonly symbolCount: number;
}

/**
 * Adapts the SymbolTree for an outline view: exposes a navigable node
 * hierarchy with expand/collapse state, tracks the active symbol path for a
 * cursor position and reports selection changes.
 */
export class OutlineModel extends Disposable {
	private _tree: SymbolTree | null = null;
	private _expanded = new Set<SymbolNode>();
	private _activePath: SymbolNode[] = [];
	private _selectedNode: SymbolNode | null = null;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidSelect = this._register(new Emitter<SymbolNode | null>());
	readonly onDidSelect: Event<SymbolNode | null> = this._onDidSelect.event;

	public static fromSymbols(symbols: IDocumentSymbol[]): OutlineModel {
		const model = new OutlineModel();
		model.setSymbols(symbols);
		return model;
	}

	public setSymbols(symbols: IDocumentSymbol[]): void {
		this._tree = SymbolTree.build(symbols);
		this._expanded.clear();
		this._activePath = [];
		this._selectedNode = null;
		for (const root of this._tree.getRoots()) {
			this._expanded.add(root);
		}
		this._onDidChange.fire();
	}

	public setModel(model: ITextModel | null, computeSymbols: (model: ITextModel) => IDocumentSymbol[]): void {
		this.setSymbols(model ? computeSymbols(model) : []);
	}

	public setPosition(position: IPosition | null): void {
		if (!this._tree || !position) {
			this._activePath = [];
			this._onDidChange.fire();
			return;
		}
		this._activePath = this._tree.getPathAtLine(position.lineNumber);
		this._onDidChange.fire();
	}

	public getRoots(): readonly SymbolNode[] {
		return this._tree?.getRoots() ?? [];
	}

	public getChildren(node: SymbolNode): SymbolNode[] {
		return node.children;
	}

	public isExpanded(node: SymbolNode): boolean {
		return this._expanded.has(node);
	}

	public toggleExpanded(node: SymbolNode): void {
		if (this._expanded.has(node)) {
			this._expanded.delete(node);
		} else {
			this._expanded.add(node);
		}
		this._onDidChange.fire();
	}

	public expandAll(): void {
		if (!this._tree) {
			return;
		}
		for (const node of this._tree.flatten()) {
			this._expanded.add(node);
		}
		this._onDidChange.fire();
	}

	public collapseAll(): void {
		this._expanded.clear();
		this._onDidChange.fire();
	}

	public getVisibleNodes(): IOutlineNode[] {
		if (!this._tree) {
			return [];
		}
		const result: IOutlineNode[] = [];
		const visit = (node: SymbolNode, depth: number) => {
			result.push({ node, depth, isExpanded: this._expanded.has(node) });
			if (this._expanded.has(node)) {
				for (const child of node.children) {
					visit(child, depth + 1);
				}
			}
		};
		for (const root of this._tree.getRoots()) {
			visit(root, 0);
		}
		return result;
	}

	public selectNode(node: SymbolNode): void {
		this._selectedNode = node;
		this._onDidSelect.fire(node);
	}

	public getSelectedNode(): SymbolNode | null {
		return this._selectedNode;
	}

	public getActivePath(): readonly SymbolNode[] {
		return this._activePath;
	}

	public getSymbolsAtLine(lineNumber: number): SymbolNode[] {
		return this._tree?.getSymbolsAtLine(lineNumber) ?? [];
	}

	public navigateToNode(node: SymbolNode): IRange {
		return node.range;
	}

	public findByName(name: string, kind?: SymbolKind): SymbolNode[] {
		if (!this._tree) {
			return [];
		}
		const nodes = this._tree.findByName(name);
		return kind === undefined ? nodes : nodes.filter(n => n.kind === kind);
	}

	public getState(): IOutlineModelState {
		return {
			roots: this._tree?.getRoots() ?? [],
			activePath: this._activePath,
			symbolCount: this._tree?.getSymbolCount() ?? 0
		};
	}

	public override dispose(): void {
		this._tree?.dispose();
		this._tree = null;
		super.dispose();
	}
}
