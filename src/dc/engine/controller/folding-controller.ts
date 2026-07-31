import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { IRange, ITextModel } from '../model/text-model.js';
import { Position } from '../model/position.js';

export interface IFoldingEditor {
	getModel(): ITextModel | null;
	revealLineInCenterIfOutsideViewport?(line: number): void;
	setHiddenAreas?(hiddenRanges: IRange[]): void;
	getPrimarySelection?(): { active: { lineNumber: number } } | null;
}

export interface IFoldingRegion {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	readonly indentLevel: number;
}

export class FoldingController extends Disposable {
	private _regions: IFoldingRegion[] = [];
	private readonly _collapsed = new Map<number, number>();
	private _enabled = true;

	private readonly _onDidChangeFoldingRegion = this._register(new Emitter<void>());
	readonly onDidChangeFoldingRegion: Event<void> = this._onDidChangeFoldingRegion.event;

	constructor(private readonly _editor: IFoldingEditor) {
		super();
		const model = this._editor.getModel();
		if (model) {
			this._register(model.onDidChangeContent(() => this._handleModelChanged()));
		}
		this._computeRegions();
	}

	public getRegions(): IFoldingRegion[] {
		return this._regions.slice();
	}

	public getRegionAtLine(lineNumber: number): IFoldingRegion | undefined {
		return this._regions.find(region => lineNumber >= region.startLineNumber && lineNumber <= region.endLineNumber);
	}

	public fold(levels?: number): void {
		if (levels !== undefined && levels > 0) {
			this._setCollapsed(region => region.indentLevel < levels, true);
			return;
		}
		const line = this._getCursorLine();
		const region = this._regions.find(r => line >= r.startLineNumber && line <= r.endLineNumber);
		if (region && region.endLineNumber > region.startLineNumber && !this._collapsed.has(region.startLineNumber)) {
			this._collapsed.set(region.startLineNumber, region.endLineNumber);
			this._applyHiddenAreas();
		}
	}

	public unfold(): void {
		const line = this._getCursorLine();
		for (const [startLine, endLine] of Array.from(this._collapsed.entries())) {
			if (line >= startLine && line <= endLine) {
				this._collapsed.delete(startLine);
			}
		}
		this._applyHiddenAreas();
	}

	public foldAll(): void {
		this._setCollapsed(() => true, true);
	}

	public unfoldAll(): void {
		if (this._collapsed.size === 0) {
			return;
		}
		this._collapsed.clear();
		this._applyHiddenAreas();
	}

	public foldRecursively(): void {
		this._setCollapsed(region => region.indentLevel > 0, true);
	}

	public unfoldRecursively(): void {
		this.unfoldAll();
	}

	public toggleFold(): void {
		const line = this._getCursorLine();
		const collapsed = this._getCollapsedRegionAtLine(line);
		if (collapsed) {
			this._collapsed.delete(collapsed.startLineNumber);
		} else {
			const region = this.getRegionAtLine(line);
			if (region && region.endLineNumber > region.startLineNumber) {
				this._collapsed.set(region.startLineNumber, region.endLineNumber);
			}
		}
		this._applyHiddenAreas();
	}

	public toggleAllFolds(): void {
		if (this._collapsed.size > 0) {
			this.unfoldAll();
		} else {
			this.foldAll();
		}
	}

	public isFoldingEnabled(): boolean {
		return this._enabled && this._editor.getModel() !== null;
	}

	public setFoldingEnabled(enabled: boolean): void {
		if (this._enabled === enabled) {
			return;
		}
		this._enabled = enabled;
		if (!enabled) {
			this._collapsed.clear();
		}
		this._applyHiddenAreas();
	}

	public isCollapsed(startLineNumber: number): boolean {
		return this._collapsed.has(startLineNumber);
	}

	public getCollapsedRegions(): IFoldingRegion[] {
		return this._regions.filter(region => this._collapsed.has(region.startLineNumber));
	}

	public getHiddenRanges(): IRange[] {
		return this._computeHiddenRanges();
	}

	private _handleModelChanged(): void {
		this._computeRegions();
		const validStarts = new Set(this._regions.map(region => region.startLineNumber));
		let changed = false;
		for (const startLine of Array.from(this._collapsed.keys())) {
			if (!validStarts.has(startLine)) {
				this._collapsed.delete(startLine);
				changed = true;
			}
		}
		if (changed) {
			this._applyHiddenAreas();
		}
	}

	private _computeRegions(): void {
		const model = this._editor.getModel();
		if (!model) {
			this._regions = [];
			return;
		}
		const lineCount = model.getLineCount();
		const indents: number[] = [];
		for (let i = 1; i <= lineCount; i++) {
			const line = model.getLineContent(i);
			const match = /^\s*/.exec(line);
			const whitespace = match ? match[0] : '';
			indents.push(whitespace.includes('\t') ? whitespace.length : Math.floor(whitespace.length / 2));
		}
		const regions: IFoldingRegion[] = [];
		const stack: { indent: number; startLine: number }[] = [];
		for (let i = 1; i <= lineCount; i++) {
			const indent = indents[i - 1];
			while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
				const top = stack.pop() as { indent: number; startLine: number };
				if (i - 1 > top.startLine) {
					regions.push({ startLineNumber: top.startLine, endLineNumber: i - 1, indentLevel: top.indent });
				}
			}
			stack.push({ indent, startLine: i });
		}
		while (stack.length > 0) {
			const top = stack.pop() as { indent: number; startLine: number };
			if (lineCount > top.startLine) {
				regions.push({ startLineNumber: top.startLine, endLineNumber: lineCount, indentLevel: top.indent });
			}
		}
		this._regions = regions;
	}

	private _setCollapsed(predicate: (region: IFoldingRegion) => boolean, fold: boolean): void {
		let changed = false;
		for (const region of this._regions) {
			if (region.endLineNumber <= region.startLineNumber) {
				continue;
			}
			if (fold && predicate(region)) {
				if (!this._collapsed.has(region.startLineNumber)) {
					this._collapsed.set(region.startLineNumber, region.endLineNumber);
					changed = true;
				}
			} else if (!fold && predicate(region)) {
				if (this._collapsed.delete(region.startLineNumber)) {
					changed = true;
				}
			}
		}
		if (changed) {
			this._applyHiddenAreas();
		}
	}

	private _applyHiddenAreas(): void {
		const hiddenRanges = this._computeHiddenRanges();
		this._editor.setHiddenAreas?.(hiddenRanges);
		if (hiddenRanges.length > 0) {
			this._editor.revealLineInCenterIfOutsideViewport?.(hiddenRanges[0].startLineNumber);
		}
		this._onDidChangeFoldingRegion.fire();
	}

	private _computeHiddenRanges(): IRange[] {
		const ranges: IRange[] = [];
		const collapsed = Array.from(this._collapsed.entries()).sort((a, b) => a[0] - b[0]);
		for (const [startLine, endLine] of collapsed) {
			const hidden = { startLineNumber: startLine + 1, startColumn: 1, endLineNumber: endLine, endColumn: 1 };
			if (hidden.startLineNumber <= hidden.endLineNumber) {
				ranges.push(hidden);
			}
		}
		return ranges;
	}

	private _getCollapsedRegionAtLine(lineNumber: number): IFoldingRegion | undefined {
		for (const region of this._regions) {
			if (region.startLineNumber === lineNumber && this._collapsed.has(region.startLineNumber)) {
				return region;
			}
		}
		for (const [startLine, endLine] of this._collapsed.entries()) {
			if (lineNumber > startLine && lineNumber <= endLine) {
				const region = this._regions.find(r => r.startLineNumber === startLine);
				if (region) {
					return region;
				}
			}
		}
		return undefined;
	}

	private _getCursorLine(): number {
		const selection = this._editor.getPrimarySelection?.();
		if (selection) {
			return Math.max(1, selection.active.lineNumber);
		}
		if (this._regions.length > 0) {
			return this._regions[0].startLineNumber;
		}
		return 1;
	}
}

export function computeIndentationLevel(line: string, tabSize: number = 2): number {
	const match = /^\s*/.exec(line);
	if (!match) {
		return 0;
	}
	const whitespace = match[0];
	return whitespace.includes('\t') ? whitespace.length : Math.floor(whitespace.length / tabSize);
}
