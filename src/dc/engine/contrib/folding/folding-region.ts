/**
 * Dardcor Code - Fold Region Hierarchy Tree
 */

import { IRange } from "../../model/text-model.js";

export interface IFoldRegionTreeOptions {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
}

export class FoldingRegion {
	public isCollapsed: boolean = false;
	public parent: FoldingRegion | null = null;
	public children: FoldingRegion[] = [];
	public readonly startLineNumber: number;
	public readonly endLineNumber: number;
	public readonly indentLevel: number;
	public readonly isComment: boolean;

	constructor(startLineNumber: number, endLineNumber: number, indentLevel: number = 0, isComment: boolean = false) {
		this.startLineNumber = startLineNumber;
		this.endLineNumber = endLineNumber;
		this.indentLevel = indentLevel;
		this.isComment = isComment;
	}

	public containsLine(lineNumber: number): boolean {
		return lineNumber >= this.startLineNumber && lineNumber <= this.endLineNumber;
	}

	public containsRegion(other: FoldingRegion): boolean {
		return this.startLineNumber <= other.startLineNumber && this.endLineNumber >= other.endLineNumber;
	}

	public get depth(): number {
		let depth = 0;
		let node: FoldingRegion | null = this.parent;
		while (node) {
			depth++;
			node = node.parent;
		}
		return depth;
	}

	public get isRoot(): boolean {
		return this.parent === null;
	}

	public getCollapsedChildren(): FoldingRegion[] {
		return this.children.filter(c => c.isCollapsed);
	}
}

export class FoldingRegionTree {
	public readonly root: FoldingRegion;

	private constructor(root: FoldingRegion) {
		this.root = root;
	}

	public static build(ranges: readonly { startLineNumber: number; endLineNumber: number; indentLevel?: number; isComment?: boolean }[], lineCount: number, options?: IFoldRegionTreeOptions): FoldingRegionTree {
		const sorted = [...ranges].sort((a, b) => {
			if (a.startLineNumber !== b.startLineNumber) {
				return a.startLineNumber - b.startLineNumber;
			}
			return b.endLineNumber - a.endLineNumber;
		});

		const root = new FoldingRegion(
			options?.startLineNumber ?? 1,
			options?.endLineNumber ?? lineCount,
			-1
		);

		const stack: FoldingRegion[] = [root];
		for (const item of sorted) {
			const region = new FoldingRegion(item.startLineNumber, item.endLineNumber, item.indentLevel ?? 0, item.isComment ?? false);
			let parent: FoldingRegion = stack[stack.length - 1];
			while (parent !== root && !parent.containsRegion(region)) {
				stack.pop();
				parent = stack[stack.length - 1];
			}
			if (parent !== root && parent.startLineNumber === region.startLineNumber) {
				// Same start line: keep the outer region as parent.
				stack.pop();
				parent = stack[stack.length - 1];
			}
			region.parent = parent;
			parent.children.push(region);
			stack.push(region);
		}
		return new FoldingRegionTree(root);
	}

	public getRegionsAtLine(lineNumber: number): FoldingRegion[] {
		const result: FoldingRegion[] = [];
		const visit = (region: FoldingRegion): boolean => {
			if (!region.containsLine(lineNumber)) {
				return false;
			}
			result.push(region);
			for (const child of region.children) {
				if (visit(child)) {
					break;
				}
			}
			return true;
		};
		visit(this.root);
		return result;
	}

	public getSmallestRegionAtLine(lineNumber: number): FoldingRegion | null {
		const regions = this.getRegionsAtLine(lineNumber);
		if (regions.length === 0) {
			return null;
		}
		return regions[regions.length - 1];
	}

	public getVisibleRegions(): FoldingRegion[] {
		const result: FoldingRegion[] = [];
		const visit = (region: FoldingRegion) => {
			for (const child of region.children) {
				result.push(child);
				if (!child.isCollapsed) {
					visit(child);
				}
			}
		};
		visit(this.root);
		return result;
	}

	public flatten(): FoldingRegion[] {
		const result: FoldingRegion[] = [];
		const visit = (region: FoldingRegion) => {
			for (const child of region.children) {
				result.push(child);
				visit(child);
			}
		};
		visit(this.root);
		return result;
	}
}
