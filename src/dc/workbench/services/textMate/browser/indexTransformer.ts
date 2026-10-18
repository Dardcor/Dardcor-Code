/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AnyEdit } from '../../../../editor/common/core/edits/edit.js';

export interface IIndexTransformer {
	transform(index: number): number | undefined;
}

export class MonotonousIndexTransformer implements IIndexTransformer {
	public static fromMany(transformations: AnyEdit[]): IIndexTransformer {
		const transformers = transformations.map(t => new MonotonousIndexTransformer(t));
		return new CombinedIndexTransformer(transformers);
	}

	private idx = 0;
	private offset = 0;

	constructor(private readonly transformation: AnyEdit) {
	}

	transform(index: number): number | undefined {
		let nextChange = this.transformation.replacements.at(this.idx);
		while (nextChange && nextChange.replaceRange.endExclusive <= index) {
			this.offset += nextChange.getLengthDelta();
			this.idx++;
			nextChange = this.transformation.replacements.at(this.idx);
		}

		if (nextChange && nextChange.replaceRange.start <= index) {
			return undefined;
		}

		return index + this.offset;
	}
}

export class CombinedIndexTransformer implements IIndexTransformer {
	constructor(
		private readonly transformers: IIndexTransformer[]
	) { }

	transform(index: number): number | undefined {
		for (const transformer of this.transformers) {
			const result = transformer.transform(index);
			if (result === undefined) {
				return undefined;
			}
			index = result;
		}
		return index;
	}
}
