/**
 * Dardcor Code - TextModel Representation
 */

import { PieceTree } from './piece-tree/piece-tree.js';
import { URI } from '../../core/types/uri.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface IPosition {
	readonly lineNumber: number;
	readonly column: number;
}

export interface IRange {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export class Position implements IPosition {
	constructor(public readonly lineNumber: number, public readonly column: number) {}
}

export class Range implements IRange {
	constructor(
		public readonly startLineNumber: number,
		public readonly startColumn: number,
		public readonly endLineNumber: number,
		public readonly endColumn: number
	) {}

	static areIntersecting(a: IRange, b: IRange): boolean {
		if (a.endLineNumber < b.startLineNumber || b.endLineNumber < a.startLineNumber) {
			return false;
		}
		if (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn) {
			return false;
		}
		if (b.endLineNumber === a.startLineNumber && b.endColumn < a.startColumn) {
			return false;
		}
		return true;
	}
}


export interface IModelContentChangedEvent {
	readonly text: string;
}

export interface ITextModel {
	readonly uri: URI;
	getValue(): string;
	setValue(newText: string): void;
	getLineCount(): number;
	getLineContent(lineNumber: number): string;
	onDidChangeContent: Event<IModelContentChangedEvent>;
}

export class TextModel extends Disposable implements ITextModel {
	private _tree: PieceTree;
	private readonly _onDidChangeContent = this._register(new Emitter<IModelContentChangedEvent>());

	readonly onDidChangeContent = this._onDidChangeContent.event;

	constructor(
		public readonly uri: URI,
		initialText: string
	) {
		super();
		this._tree = new PieceTree(initialText);
	}

	public getValue(): string {
		return this._tree.getContent();
	}

	public setValue(newText: string): void {
		this._tree = new PieceTree(newText);
		this._onDidChangeContent.fire({ text: newText });
	}

	public getLineCount(): number {
		return this._tree.getLineCount();
	}

	public getLineContent(lineNumber: number): string {
		const lines = this.getValue().split(/\r?\n/);
		return lines[lineNumber - 1] || '';
	}
}
