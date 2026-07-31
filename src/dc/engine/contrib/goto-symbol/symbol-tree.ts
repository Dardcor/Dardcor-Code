/**
 * Dardcor Code - Document Symbol Hierarchy Tree Model
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { IRange } from "../../model/text-model.js";
import { IDocumentSymbol, SymbolKind } from "./goto-symbol.js";

export class SymbolNode {
	public readonly name: string;
	public readonly kind: SymbolKind;
	public readonly range: IRange;
	public readonly detail: string;
	public readonly children: SymbolNode[] = [];
	public parent: SymbolNode | null = null;

	constructor(symbol: IDocumentSymbol) {
		this.name = symbol.name;
		this.kind = symbol.kind;
		this.range = symbol.range;
		this.detail = symbol.detail;
	}

	public get depth(): number {
		let depth = 0;
		let node: SymbolNode | null = this.parent;
		while (node) {
			depth++;
			node = node.parent;
		}
		return depth;
	}

	public get isRoot(): boolean {
		return this.parent === null;
	}

	public containsLine(lineNumber: number): boolean {
		return lineNumber >= this.range.startLineNumber && lineNumber <= this.range.endLineNumber;
	}

	public contains(other: SymbolNode): boolean {
		return this.range.startLineNumber <= other.range.startLineNumber &&
			this.range.endLineNumber >= other.range.endLineNumber;
	}

	public getDescendantCount(): number {
		let count = 0;
		const visit = (node: SymbolNode) => {
			for (const child of node.children) {
				count++;
				visit(child);
			}
		};
		visit(this);
		return count;
	}
}

export class SymbolTree extends Disposable {
	private _roots: SymbolNode[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public static build(symbols: IDocumentSymbol[]): SymbolTree {
		const tree = new SymbolTree();
		tree.setSymbols(symbols);
		return tree;
	}

	public setSymbols(symbols: IDocumentSymbol[]): void {
		const sorted = [...symbols].sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			if (a.range.startColumn !== b.range.startColumn) {
				return a.range.startColumn - b.range.startColumn;
			}
			return b.range.endColumn - a.range.endColumn;
		});

		const virtualRoot: SymbolNode = new SymbolNode({
			name: "",

			kind: SymbolKind.File,
			range: { startLineNumber: 0, startColumn: 0, endLineNumber: Number.MAX_SAFE_INTEGER, endColumn: Number.MAX_SAFE_INTEGER },
			detail: ""
		});
		const stack: SymbolNode[] = [virtualRoot];
		for (const symbol of sorted) {
			const node = new SymbolNode(symbol);
			while (stack.length > 1 && !stack[stack.length - 1].contains(node)) {
				stack.pop();
			}
			node.parent = stack[stack.length - 1];
			stack[stack.length - 1].children.push(node);
			stack.push(node);
		}
		this._roots = virtualRoot.children;
		this._onDidChange.fire();
	}

	public getPathAtLine(lineNumber: number): SymbolNode[] {
		const path: SymbolNode[] = [];
		const visit = (node: SymbolNode): boolean => {
			for (const child of node.children) {
				if (child.containsLine(lineNumber)) {
					path.push(child);
					visit(child);
					break;
				}
			}
			return path.length > 0;
		};
		for (const root of this._roots) {
			if (root.containsLine(lineNumber)) {
				path.push(root);
				visit(root);
				break;
			}
		}
		return path;
	}

	public getSymbolsAtLine(lineNumber: number): SymbolNode[] {
		return this.getPathAtLine(lineNumber);
	}

	public findByName(name: string): SymbolNode[] {
		const result: SymbolNode[] = [];
		const visit = (node: SymbolNode) => {
			if (node.name === name) {
				result.push(node);
			}
			for (const child of node.children) {
				visit(child);
			}
		};
		for (const root of this._roots) {
			visit(root);
		}
		return result;
	}

	public flatten(): SymbolNode[] {
		const result: SymbolNode[] = [];
		const visit = (node: SymbolNode) => {
			for (const child of node.children) {
				result.push(child);
				visit(child);
			}
		};
		for (const root of this._roots) {
			visit(root);
		}
		return result;
	}

	public getRoots(): readonly SymbolNode[] {
		return this._roots;
	}

	public getSymbolCount(): number {
		return this.flatten().length;
	}

	public getNodes(): SymbolNode[] {
		return this.flatten();
	}

	public getMaxDepth(): number {
		let max = 0;
		for (const node of this.flatten()) {
			max = Math.max(max, node.depth);
		}
		return max;
	}
}
