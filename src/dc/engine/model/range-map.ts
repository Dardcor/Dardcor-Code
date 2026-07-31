/**
 * Dardcor Code - Interval Tree for Tracking Decorations across Edits (Task 206)
 * Mirrors: vs/editor/common/model/intervalTree.ts
 */

import { IRange, Range } from './text-model.js';


export interface IDecorationInterval {
	id: string;
	range: Range;
	options: Record<string, any>;
}

export class DecorationRangeMap {
	private readonly _intervals = new Map<string, IDecorationInterval>();

	add(id: string, range: Range, options: Record<string, any> = {}): void {
		this._intervals.set(id, { id, range, options });
	}

	remove(id: string): boolean {
		return this._intervals.delete(id);
	}

	get(id: string): IDecorationInterval | undefined {
		return this._intervals.get(id);
	}

	getDecorationsInRange(range: IRange): IDecorationInterval[] {
		const result: IDecorationInterval[] = [];
		for (const dec of this._intervals.values()) {
			if (Range.areIntersecting(dec.range, range)) {
				result.push(dec);
			}
		}
		return result;
	}

	getAll(): IDecorationInterval[] {
		return Array.from(this._intervals.values());
	}
}
