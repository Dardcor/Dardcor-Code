/**
 * Dardcor Code - Side-by-Side Text Model Diff Calculator (Task 228)
 * Mirrors: vs/editor/common/diff/diffComputer.ts (Myers)
 */

import { computeDiff, IChange } from '../../core/formatting/diff';
import { ITextModel } from '../model/text-model';

export enum DiffChangeType {
	Insert = 'insert',
	Delete = 'delete',
	Modify = 'modify',
}

export interface IDiffChange {
	readonly type: DiffChangeType;
	/** 1-based inclusive line ranges */
	readonly originalStart: number;
	readonly originalEnd: number;
	readonly modifiedStart: number;
	readonly modifiedEnd: number;
	/** character-level changes for modified blocks (0-based offsets) */
	readonly charChanges: IChange[] | null;
}

export interface IDiffResult {
	readonly changes: IDiffChange[];
	readonly identical: boolean;
}

function linesOf(model: ITextModel): string[] {
	const result: string[] = [];
	const count = model.getLineCount();
	for (let i = 1; i <= count; i++) {
		result.push(model.getLineContent(i));
	}
	return result;
}

export class DiffComputer {
	private _changes: IDiffChange[] | null = null;

	constructor(
		private readonly _original: ITextModel,
		private readonly _modified: ITextModel
	) {}

	compute(): IDiffResult {
		if (!this._changes) {
			const originalLines = linesOf(this._original);
			const modifiedLines = linesOf(this._modified);
			this._changes = DiffComputer.computeLineChanges(originalLines, modifiedLines);
		}
		return {
			changes: this._changes,
			identical: this._changes.length === 0,
		};
	}

	getChanges(): IDiffChange[] {
		return this.compute().changes;
	}

	/**
	 * Character-level diff inside a single modified block.
	 */
	static computeCharacterChanges(originalText: string, modifiedText: string): IChange[] {
		if (originalText === modifiedText) {
			return [];
		}
		return computeDiff(originalText.split(''), modifiedText.split(''));
	}

	/**
	 * Computes 1-based line ranges from the core Myers implementation.
	 */
	static computeLineChanges(originalLines: string[], modifiedLines: string[]): IDiffChange[] {
		const rawChanges = computeDiff(originalLines, modifiedLines);
		const result: IDiffChange[] = [];

		for (const change of rawChanges) {
			const type = change.originalLength === 0
				? DiffChangeType.Insert
				: change.modifiedLength === 0
					? DiffChangeType.Delete
					: DiffChangeType.Modify;

			const originalStart = change.originalStart + 1;
			const originalEnd = change.originalStart + change.originalLength;
			const modifiedStart = change.modifiedStart + 1;
			const modifiedEnd = change.modifiedStart + change.modifiedLength;

			let charChanges: IChange[] | null = null;
			if (type === DiffChangeType.Modify) {
				const originalText = originalLines.slice(originalStart - 1, originalEnd).join('\n');
				const modifiedText = modifiedLines.slice(modifiedStart - 1, modifiedEnd).join('\n');
				charChanges = DiffComputer.computeCharacterChanges(originalText, modifiedText);
			}

			result.push({
				type,
				originalStart,
				originalEnd,
				modifiedStart,
				modifiedEnd,
				charChanges,
			});
		}

		return result;
	}

	static computeTextDiff(originalText: string, modifiedText: string): IDiffChange[] {
		return DiffComputer.computeLineChanges(originalText.split('\n'), modifiedText.split('\n'));
	}
}
