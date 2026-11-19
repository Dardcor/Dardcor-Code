/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ITextModel } from '../../../common/model.js';
import { computeIndentLevel } from '../../../common/model/utils.js';
import { FoldingMarkers } from '../../../common/languages/languageConfiguration.js';
import { ILanguageConfigurationService } from '../../../common/languages/languageConfigurationRegistry.js';
import { FoldingRegions, MAX_LINE_NUMBER } from './foldingRanges.js';
import { FoldingLimitReporter, RangeProvider } from './folding.js';

const MAX_FOLDING_REGIONS_FOR_INDENT_DEFAULT = 5000;

const ID_INDENT_PROVIDER = 'indent';

export class IndentRangeProvider implements RangeProvider {
	readonly id = ID_INDENT_PROVIDER;

	constructor(
		private readonly editorModel: ITextModel,
		private readonly languageConfigurationService: ILanguageConfigurationService,
		private readonly foldingRangesLimit: FoldingLimitReporter
	) { }

	dispose() { }

	compute(cancelationToken: CancellationToken,): Promise<FoldingRegions> {
		const foldingRules = this.languageConfigurationService.getLanguageConfiguration(this.editorModel.getLanguageId()).foldingRules;
		const offSide = foldingRules && !!foldingRules.offSide;
		const markers = foldingRules && foldingRules.markers;
		return Promise.resolve(computeRanges(this.editorModel, offSide, markers, this.foldingRangesLimit));
	}
}

export class RangesCollector {
	private readonly _startIndexes: number[];
	private readonly _endIndexes: number[];
	private readonly _indentOccurrences: number[];
	private _length: number;
	private readonly _foldingRangesLimit: FoldingLimitReporter;

	constructor(foldingRangesLimit: FoldingLimitReporter) {
		this._startIndexes = [];
		this._endIndexes = [];
		this._indentOccurrences = [];
		this._length = 0;
		this._foldingRangesLimit = foldingRangesLimit;
	}

	public insertFirst(startLineNumber: number, endLineNumber: number, indent: number) {
		if (startLineNumber > MAX_LINE_NUMBER || endLineNumber > MAX_LINE_NUMBER) {
			return;
		}
		const index = this._length;
		this._startIndexes[index] = startLineNumber;
		this._endIndexes[index] = endLineNumber;
		this._length++;
		if (indent < 1000) {
			this._indentOccurrences[indent] = (this._indentOccurrences[indent] || 0) + 1;
		}
	}

	public toIndentRanges(model: ITextModel) {
		const limit = this._foldingRangesLimit.limit;
		if (this._length <= limit) {
			this._foldingRangesLimit.update(this._length, false);

			const startIndexes = new Uint32Array(this._length);
			const endIndexes = new Uint32Array(this._length);
			for (let i = this._length - 1, k = 0; i >= 0; i--, k++) {
				startIndexes[k] = this._startIndexes[i];
				endIndexes[k] = this._endIndexes[i];
			}
			return new FoldingRegions(startIndexes, endIndexes);
		} else {
			this._foldingRangesLimit.update(this._length, limit);

			let entries = 0;
			let maxIndent = this._indentOccurrences.length;
			for (let i = 0; i < this._indentOccurrences.length; i++) {
				const n = this._indentOccurrences[i];
				if (n) {
					if (n + entries > limit) {
						maxIndent = i;
						break;
					}
					entries += n;
				}
			}
			const tabSize = model.getOptions().tabSize;
			const startIndexes = new Uint32Array(limit);
			const endIndexes = new Uint32Array(limit);
			for (let i = this._length - 1, k = 0; i >= 0; i--) {
				const startIndex = this._startIndexes[i];
				const lineContent = model.getLineContent(startIndex);
				const indent = computeIndentLevel(lineContent, tabSize);
				if (indent < maxIndent || (indent === maxIndent && entries++ < limit)) {
					startIndexes[k] = startIndex;
					endIndexes[k] = this._endIndexes[i];
					k++;
				}
			}
			return new FoldingRegions(startIndexes, endIndexes);
		}

	}
}


interface PreviousRegion {
	indent: number;
	endAbove: number;
	line: number;
}

const foldingRangesLimitDefault: FoldingLimitReporter = {
	limit: MAX_FOLDING_REGIONS_FOR_INDENT_DEFAULT,
	update: () => { }
};

export function computeRanges(model: ITextModel, offSide: boolean, markers?: FoldingMarkers, foldingRangesLimit: FoldingLimitReporter = foldingRangesLimitDefault): FoldingRegions {
	const tabSize = model.getOptions().tabSize;
	const result = new RangesCollector(foldingRangesLimit);

	let pattern: RegExp | undefined = undefined;
	let startPattern: RegExp | undefined = undefined;
	let endPattern: RegExp | undefined = undefined;
	if (markers) {
		if (markers.start.flags === markers.end.flags) {
			pattern = new RegExp(`(${markers.start.source})|(?:${markers.end.source})`, markers.start.flags);
		} else {
			startPattern = markers.start;
			endPattern = markers.end;
		}
	}

	const previousRegions: PreviousRegion[] = [];
	const line = model.getLineCount() + 1;
	previousRegions.push({ indent: -1, endAbove: line, line });

	for (let line = model.getLineCount(); line > 0; line--) {
		const lineContent = model.getLineContent(line);
		const indent = computeIndentLevel(lineContent, tabSize);
		let previous = previousRegions[previousRegions.length - 1];
		if (indent === -1) {
			if (offSide) {
				previous.endAbove = line;
			}
			continue;
		}
		let isStartMatch = false;
		let isEndMatch = false;
		let m;
		if (pattern) {
			pattern.lastIndex = 0;
			if ((m = pattern.exec(lineContent))) {
				isStartMatch = !!m[1];
				isEndMatch = !isStartMatch;
			}
		} else {
			if (startPattern) {
				startPattern.lastIndex = 0;
				isStartMatch = startPattern.test(lineContent);
			}
			if (!isStartMatch && endPattern) {
				endPattern.lastIndex = 0;
				isEndMatch = endPattern.test(lineContent);
			}
		}
		if (isStartMatch || isEndMatch) {
			if (isStartMatch) {
				let i = previousRegions.length - 1;
				while (i > 0 && previousRegions[i].indent !== -2) {
					i--;
				}
				if (i > 0) {
					previousRegions.length = i + 1;
					previous = previousRegions[i];

					result.insertFirst(line, previous.line, indent);
					previous.line = line;
					previous.indent = indent;
					previous.endAbove = line;
					continue;
				} else {
				}
			} else {
				previousRegions.push({ indent: -2, endAbove: line, line });
				continue;
			}
		}
		if (previous.indent > indent) {
			do {
				previousRegions.pop();
				previous = previousRegions[previousRegions.length - 1];
			} while (previous.indent > indent);

			const endLineNumber = previous.endAbove - 1;
			if (endLineNumber - line >= 1) {
				result.insertFirst(line, endLineNumber, indent);
			}
		}
		if (previous.indent === indent) {
			previous.endAbove = line;
		} else {
			previousRegions.push({ indent, endAbove: line, line });
		}
	}
	return result.toIndentRanges(model);
}
