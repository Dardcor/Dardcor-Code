/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from '../../../base/common/charCode.js';
import * as strings from '../../../base/common/strings.js';
import { WrappingIndent, IComputedEditorOptions, EditorOption } from '../config/editorOptions.js';
import { CharacterClassifier } from '../core/characterClassifier.js';
import { FontInfo } from '../config/fontInfo.js';
import { LineInjectedText } from '../textModelEvents.js';
import { InjectedTextOptions } from '../model.js';
import { ILineBreaksComputerFactory, ILineBreaksComputer, ModelLineProjectionData, ILineBreaksComputerContext } from '../modelLineProjectionData.js';

export class MonospaceLineBreaksComputerFactory implements ILineBreaksComputerFactory {
	public static create(options: IComputedEditorOptions): MonospaceLineBreaksComputerFactory {
		return new MonospaceLineBreaksComputerFactory(
			options.get(EditorOption.wordWrapBreakBeforeCharacters),
			options.get(EditorOption.wordWrapBreakAfterCharacters)
		);
	}

	private readonly classifier: WrappingCharacterClassifier;

	constructor(breakBeforeChars: string, breakAfterChars: string) {
		this.classifier = new WrappingCharacterClassifier(breakBeforeChars, breakAfterChars);
	}

	public createLineBreaksComputer(context: ILineBreaksComputerContext, fontInfo: FontInfo, tabSize: number, wrappingColumn: number, wrappingIndent: WrappingIndent, wordBreak: 'normal' | 'keepAll', wrapOnEscapedLineFeeds: boolean): ILineBreaksComputer {
		const lineNumbers: number[] = [];
		const previousBreakingData: (ModelLineProjectionData | null)[] = [];
		return {
			addRequest: (lineNumber: number, previousLineBreakData: ModelLineProjectionData | null) => {
				lineNumbers.push(lineNumber);
				previousBreakingData.push(previousLineBreakData);
			},
			finalize: () => {
				const columnsForFullWidthChar = fontInfo.typicalFullwidthCharacterWidth / fontInfo.typicalHalfwidthCharacterWidth;
				const result: (ModelLineProjectionData | null)[] = [];
				for (let i = 0, len = lineNumbers.length; i < len; i++) {
					const lineNumber = lineNumbers[i];
					const injectedText = context.getLineInjectedText(lineNumber);
					const lineText = context.getLineContent(lineNumber);
					const previousLineBreakData = previousBreakingData[i];
					const isLineFeedWrappingEnabled = wrapOnEscapedLineFeeds && lineText.includes('"') && lineText.includes('\\n');
					if (previousLineBreakData && !previousLineBreakData.injectionOptions && !injectedText && !isLineFeedWrappingEnabled) {
						result[i] = createLineBreaksFromPreviousLineBreaks(this.classifier, previousLineBreakData, lineText, tabSize, wrappingColumn, columnsForFullWidthChar, wrappingIndent, wordBreak);
					} else {
						result[i] = createLineBreaks(this.classifier, lineText, injectedText, tabSize, wrappingColumn, columnsForFullWidthChar, wrappingIndent, wordBreak, isLineFeedWrappingEnabled);
					}
				}
				arrPool1.length = 0;
				arrPool2.length = 0;
				return result;
			}
		};
	}
}

const enum CharacterClass {
	NONE = 0,
	BREAK_BEFORE = 1,
	BREAK_AFTER = 2,
	BREAK_IDEOGRAPHIC = 3
}

class WrappingCharacterClassifier extends CharacterClassifier<CharacterClass> {

	constructor(BREAK_BEFORE: string, BREAK_AFTER: string) {
		super(CharacterClass.NONE);

		for (let i = 0; i < BREAK_BEFORE.length; i++) {
			this.set(BREAK_BEFORE.charCodeAt(i), CharacterClass.BREAK_BEFORE);
		}

		for (let i = 0; i < BREAK_AFTER.length; i++) {
			this.set(BREAK_AFTER.charCodeAt(i), CharacterClass.BREAK_AFTER);
		}
	}

	public override get(charCode: number): CharacterClass {
		if (charCode >= 0 && charCode < 256) {
			return <CharacterClass>this._asciiMap[charCode];
		} else {
			if (
				(charCode >= 0x3040 && charCode <= 0x30FF)
				|| (charCode >= 0x3400 && charCode <= 0x4DBF)
				|| (charCode >= 0x4E00 && charCode <= 0x9FFF)
			) {
				return CharacterClass.BREAK_IDEOGRAPHIC;
			}

			return <CharacterClass>(this._map.get(charCode) || this._defaultValue);
		}
	}
}

let arrPool1: number[] = [];
let arrPool2: number[] = [];

function createLineBreaksFromPreviousLineBreaks(classifier: WrappingCharacterClassifier, previousBreakingData: ModelLineProjectionData, lineText: string, tabSize: number, firstLineBreakColumn: number, columnsForFullWidthChar: number, wrappingIndent: WrappingIndent, wordBreak: 'normal' | 'keepAll'): ModelLineProjectionData | null {
	if (firstLineBreakColumn === -1) {
		return null;
	}

	const len = lineText.length;
	if (len <= 1) {
		return null;
	}

	const isKeepAll = (wordBreak === 'keepAll');

	const prevBreakingOffsets = previousBreakingData.breakOffsets;
	const prevBreakingOffsetsVisibleColumn = previousBreakingData.breakOffsetsVisibleColumn;

	const wrappedTextIndentLength = computeWrappedTextIndentLength(lineText, tabSize, firstLineBreakColumn, columnsForFullWidthChar, wrappingIndent);
	const wrappedLineBreakColumn = firstLineBreakColumn - wrappedTextIndentLength;

	const breakingOffsets: number[] = arrPool1;
	const breakingOffsetsVisibleColumn: number[] = arrPool2;
	let breakingOffsetsCount = 0;
	let lastBreakingOffset = 0;
	let lastBreakingOffsetVisibleColumn = 0;

	let breakingColumn = firstLineBreakColumn;
	const prevLen = prevBreakingOffsets.length;
	let prevIndex = 0;

	if (prevIndex >= 0) {
		let bestDistance = Math.abs(prevBreakingOffsetsVisibleColumn[prevIndex] - breakingColumn);
		while (prevIndex + 1 < prevLen) {
			const distance = Math.abs(prevBreakingOffsetsVisibleColumn[prevIndex + 1] - breakingColumn);
			if (distance >= bestDistance) {
				break;
			}
			bestDistance = distance;
			prevIndex++;
		}
	}

	while (prevIndex < prevLen) {
		let prevBreakOffset = prevIndex < 0 ? 0 : prevBreakingOffsets[prevIndex];
		let prevBreakOffsetVisibleColumn = prevIndex < 0 ? 0 : prevBreakingOffsetsVisibleColumn[prevIndex];
		if (lastBreakingOffset > prevBreakOffset) {
			prevBreakOffset = lastBreakingOffset;
			prevBreakOffsetVisibleColumn = lastBreakingOffsetVisibleColumn;
		}

		let breakOffset = 0;
		let breakOffsetVisibleColumn = 0;

		let forcedBreakOffset = 0;
		let forcedBreakOffsetVisibleColumn = 0;

		if (prevBreakOffsetVisibleColumn <= breakingColumn) {
			let visibleColumn = prevBreakOffsetVisibleColumn;
			let prevCharCode = prevBreakOffset === 0 ? CharCode.Null : lineText.charCodeAt(prevBreakOffset - 1);
			let prevCharCodeClass = prevBreakOffset === 0 ? CharacterClass.NONE : classifier.get(prevCharCode);
			let entireLineFits = true;
			for (let i = prevBreakOffset; i < len; i++) {
				const charStartOffset = i;
				const charCode = lineText.charCodeAt(i);
				let charCodeClass: number;
				let charWidth: number;

				if (strings.isHighSurrogate(charCode)) {
					i++;
					charCodeClass = CharacterClass.NONE;
					charWidth = 2;
				} else {
					charCodeClass = classifier.get(charCode);
					charWidth = computeCharWidth(charCode, visibleColumn, tabSize, columnsForFullWidthChar);
				}

				if (charStartOffset > lastBreakingOffset && canBreak(prevCharCode, prevCharCodeClass, charCode, charCodeClass, isKeepAll)) {
					breakOffset = charStartOffset;
					breakOffsetVisibleColumn = visibleColumn;
				}

				visibleColumn += charWidth;

				if (visibleColumn > breakingColumn) {
					if (charStartOffset > lastBreakingOffset) {
						forcedBreakOffset = charStartOffset;
						forcedBreakOffsetVisibleColumn = visibleColumn - charWidth;
					} else {
						forcedBreakOffset = i + 1;
						forcedBreakOffsetVisibleColumn = visibleColumn;
					}

					if (visibleColumn - breakOffsetVisibleColumn > wrappedLineBreakColumn) {
						breakOffset = 0;
					}

					entireLineFits = false;
					break;
				}

				prevCharCode = charCode;
				prevCharCodeClass = charCodeClass;
			}

			if (entireLineFits) {
				if (breakingOffsetsCount > 0) {
					breakingOffsets[breakingOffsetsCount] = prevBreakingOffsets[prevBreakingOffsets.length - 1];
					breakingOffsetsVisibleColumn[breakingOffsetsCount] = prevBreakingOffsetsVisibleColumn[prevBreakingOffsets.length - 1];
					breakingOffsetsCount++;
				}
				break;
			}
		}

		if (breakOffset === 0) {
			let visibleColumn = prevBreakOffsetVisibleColumn;
			let charCode = lineText.charCodeAt(prevBreakOffset);
			let charCodeClass = classifier.get(charCode);
			let hitATabCharacter = false;
			for (let i = prevBreakOffset - 1; i >= lastBreakingOffset; i--) {
				const charStartOffset = i + 1;
				const prevCharCode = lineText.charCodeAt(i);

				if (prevCharCode === CharCode.Tab) {
					hitATabCharacter = true;
					break;
				}

				let prevCharCodeClass: number;
				let prevCharWidth: number;

				if (strings.isLowSurrogate(prevCharCode)) {
					i--;
					prevCharCodeClass = CharacterClass.NONE;
					prevCharWidth = 2;
				} else {
					prevCharCodeClass = classifier.get(prevCharCode);
					prevCharWidth = (strings.isFullWidthCharacter(prevCharCode) ? columnsForFullWidthChar : 1);
				}

				if (visibleColumn <= breakingColumn) {
					if (forcedBreakOffset === 0) {
						forcedBreakOffset = charStartOffset;
						forcedBreakOffsetVisibleColumn = visibleColumn;
					}

					if (visibleColumn <= breakingColumn - wrappedLineBreakColumn) {
						break;
					}

					if (canBreak(prevCharCode, prevCharCodeClass, charCode, charCodeClass, isKeepAll)) {
						breakOffset = charStartOffset;
						breakOffsetVisibleColumn = visibleColumn;
						break;
					}
				}

				visibleColumn -= prevCharWidth;
				charCode = prevCharCode;
				charCodeClass = prevCharCodeClass;
			}

			if (breakOffset !== 0) {
				const remainingWidthOfNextLine = wrappedLineBreakColumn - (forcedBreakOffsetVisibleColumn - breakOffsetVisibleColumn);
				if (remainingWidthOfNextLine <= tabSize) {
					const charCodeAtForcedBreakOffset = lineText.charCodeAt(forcedBreakOffset);
					let charWidth: number;
					if (strings.isHighSurrogate(charCodeAtForcedBreakOffset)) {
						charWidth = 2;
					} else {
						charWidth = computeCharWidth(charCodeAtForcedBreakOffset, forcedBreakOffsetVisibleColumn, tabSize, columnsForFullWidthChar);
					}
					if (remainingWidthOfNextLine - charWidth < 0) {
						breakOffset = 0;
					}
				}
			}

			if (hitATabCharacter) {
				prevIndex--;
				continue;
			}
		}

		if (breakOffset === 0) {
			breakOffset = forcedBreakOffset;
			breakOffsetVisibleColumn = forcedBreakOffsetVisibleColumn;
		}

		if (breakOffset <= lastBreakingOffset) {
			const charCode = lineText.charCodeAt(lastBreakingOffset);
			if (strings.isHighSurrogate(charCode)) {
				breakOffset = lastBreakingOffset + 2;
				breakOffsetVisibleColumn = lastBreakingOffsetVisibleColumn + 2;
			} else {
				breakOffset = lastBreakingOffset + 1;
				breakOffsetVisibleColumn = lastBreakingOffsetVisibleColumn + computeCharWidth(charCode, lastBreakingOffsetVisibleColumn, tabSize, columnsForFullWidthChar);
			}
		}

		lastBreakingOffset = breakOffset;
		breakingOffsets[breakingOffsetsCount] = breakOffset;
		lastBreakingOffsetVisibleColumn = breakOffsetVisibleColumn;
		breakingOffsetsVisibleColumn[breakingOffsetsCount] = breakOffsetVisibleColumn;
		breakingOffsetsCount++;
		breakingColumn = breakOffsetVisibleColumn + wrappedLineBreakColumn;

		while (prevIndex < 0 || (prevIndex < prevLen && prevBreakingOffsetsVisibleColumn[prevIndex] < breakOffsetVisibleColumn)) {
			prevIndex++;
		}

		let bestDistance = Math.abs(prevBreakingOffsetsVisibleColumn[prevIndex] - breakingColumn);
		while (prevIndex + 1 < prevLen) {
			const distance = Math.abs(prevBreakingOffsetsVisibleColumn[prevIndex + 1] - breakingColumn);
			if (distance >= bestDistance) {
				break;
			}
			bestDistance = distance;
			prevIndex++;
		}
	}

	if (breakingOffsetsCount === 0) {
		return null;
	}

	breakingOffsets.length = breakingOffsetsCount;
	breakingOffsetsVisibleColumn.length = breakingOffsetsCount;
	arrPool1 = previousBreakingData.breakOffsets;
	arrPool2 = previousBreakingData.breakOffsetsVisibleColumn;
	previousBreakingData.breakOffsets = breakingOffsets;
	previousBreakingData.breakOffsetsVisibleColumn = breakingOffsetsVisibleColumn;
	previousBreakingData.wrappedTextIndentLength = wrappedTextIndentLength;
	return previousBreakingData;
}

function createLineBreaks(classifier: WrappingCharacterClassifier, _lineText: string, injectedTexts: LineInjectedText[] | null, tabSize: number, firstLineBreakColumn: number, columnsForFullWidthChar: number, wrappingIndent: WrappingIndent, wordBreak: 'normal' | 'keepAll', wrapOnEscapedLineFeeds: boolean): ModelLineProjectionData | null {
	const lineText = LineInjectedText.applyInjectedText(_lineText, injectedTexts);

	let injectionOptions: InjectedTextOptions[] | null;
	let injectionOffsets: number[] | null;
	if (injectedTexts && injectedTexts.length > 0) {
		injectionOptions = injectedTexts.map(t => t.options);
		injectionOffsets = injectedTexts.map(text => text.column - 1);
	} else {
		injectionOptions = null;
		injectionOffsets = null;
	}

	if (firstLineBreakColumn === -1) {
		if (!injectionOptions) {
			return null;
		}
		return new ModelLineProjectionData(injectionOffsets, injectionOptions, [lineText.length], [], 0);
	}

	const len = lineText.length;
	if (len <= 1) {
		if (!injectionOptions) {
			return null;
		}
		return new ModelLineProjectionData(injectionOffsets, injectionOptions, [lineText.length], [], 0);
	}

	const isKeepAll = (wordBreak === 'keepAll');
	const wrappedTextIndentLength = computeWrappedTextIndentLength(lineText, tabSize, firstLineBreakColumn, columnsForFullWidthChar, wrappingIndent);
	const wrappedLineBreakColumn = firstLineBreakColumn - wrappedTextIndentLength;

	const breakingOffsets: number[] = [];
	const breakingOffsetsVisibleColumn: number[] = [];
	let breakingOffsetsCount: number = 0;
	let breakOffset = 0;
	let breakOffsetVisibleColumn = 0;

	let breakingColumn = firstLineBreakColumn;
	let prevCharCode = lineText.charCodeAt(0);
	let prevCharCodeClass = classifier.get(prevCharCode);
	let visibleColumn = computeCharWidth(prevCharCode, 0, tabSize, columnsForFullWidthChar);

	let startOffset = 1;
	if (strings.isHighSurrogate(prevCharCode)) {
		visibleColumn += 1;
		prevCharCode = lineText.charCodeAt(1);
		prevCharCodeClass = classifier.get(prevCharCode);
		startOffset++;
	}

	for (let i = startOffset; i < len; i++) {
		const charStartOffset = i;
		const charCode = lineText.charCodeAt(i);
		let charCodeClass: CharacterClass;
		let charWidth: number;
		let wrapEscapedLineFeed = false;

		if (strings.isHighSurrogate(charCode)) {
			i++;
			charCodeClass = CharacterClass.NONE;
			charWidth = 2;
		} else {
			charCodeClass = classifier.get(charCode);
			charWidth = computeCharWidth(charCode, visibleColumn, tabSize, columnsForFullWidthChar);
		}

		if (wrapOnEscapedLineFeeds && isEscapedLineBreakAtPosition(lineText, i)) {
			breakOffset = charStartOffset;
			breakOffsetVisibleColumn = visibleColumn;
			wrapEscapedLineFeed = true;
		} else if (canBreak(prevCharCode, prevCharCodeClass, charCode, charCodeClass, isKeepAll)) {
			breakOffset = charStartOffset;
			breakOffsetVisibleColumn = visibleColumn;
		}

		visibleColumn += charWidth;

		if (visibleColumn > breakingColumn || wrapEscapedLineFeed) {

			if (breakOffset === 0 || visibleColumn - breakOffsetVisibleColumn > wrappedLineBreakColumn) {
				breakOffset = charStartOffset;
				breakOffsetVisibleColumn = visibleColumn - charWidth;
			}

			breakingOffsets[breakingOffsetsCount] = breakOffset;
			breakingOffsetsVisibleColumn[breakingOffsetsCount] = breakOffsetVisibleColumn;
			breakingOffsetsCount++;
			breakingColumn = breakOffsetVisibleColumn + wrappedLineBreakColumn;
			breakOffset = 0;
		}

		prevCharCode = charCode;
		prevCharCodeClass = charCodeClass;
	}

	if (breakingOffsetsCount === 0 && (!injectedTexts || injectedTexts.length === 0)) {
		return null;
	}

	breakingOffsets[breakingOffsetsCount] = len;
	breakingOffsetsVisibleColumn[breakingOffsetsCount] = visibleColumn;

	return new ModelLineProjectionData(injectionOffsets, injectionOptions, breakingOffsets, breakingOffsetsVisibleColumn, wrappedTextIndentLength);
}

function computeCharWidth(charCode: number, visibleColumn: number, tabSize: number, columnsForFullWidthChar: number): number {
	if (charCode === CharCode.Tab) {
		return (tabSize - (visibleColumn % tabSize));
	}
	if (strings.isFullWidthCharacter(charCode)) {
		return columnsForFullWidthChar;
	}
	if (charCode < 32) {
		return columnsForFullWidthChar;
	}
	return 1;
}

function tabCharacterWidth(visibleColumn: number, tabSize: number): number {
	return (tabSize - (visibleColumn % tabSize));
}

function isEscapedLineBreakAtPosition(lineText: string, i: number): boolean {
	if (i >= 2 && lineText.charAt(i - 1) === 'n') {
		let escapeCount = 0;
		for (let j = i - 2; j >= 0; j--) {
			if (lineText.charAt(j) === '\\') {
				escapeCount++;
			} else {
				return escapeCount % 2 === 1;
			}
		}
	}
	return false;
}

function canBreak(prevCharCode: number, prevCharCodeClass: CharacterClass, charCode: number, charCodeClass: CharacterClass, isKeepAll: boolean): boolean {
	return (
		charCode !== CharCode.Space
		&& (
			(prevCharCodeClass === CharacterClass.BREAK_AFTER && charCodeClass !== CharacterClass.BREAK_AFTER)
			|| (prevCharCodeClass !== CharacterClass.BREAK_BEFORE && charCodeClass === CharacterClass.BREAK_BEFORE)
			|| (!isKeepAll && prevCharCodeClass === CharacterClass.BREAK_IDEOGRAPHIC && charCodeClass !== CharacterClass.BREAK_AFTER)
			|| (!isKeepAll && charCodeClass === CharacterClass.BREAK_IDEOGRAPHIC && prevCharCodeClass !== CharacterClass.BREAK_BEFORE)
		)
	);
}

function computeWrappedTextIndentLength(lineText: string, tabSize: number, firstLineBreakColumn: number, columnsForFullWidthChar: number, wrappingIndent: WrappingIndent): number {
	let wrappedTextIndentLength = 0;
	if (wrappingIndent !== WrappingIndent.None) {
		const firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(lineText);
		if (firstNonWhitespaceIndex !== -1) {

			for (let i = 0; i < firstNonWhitespaceIndex; i++) {
				const charWidth = (lineText.charCodeAt(i) === CharCode.Tab ? tabCharacterWidth(wrappedTextIndentLength, tabSize) : 1);
				wrappedTextIndentLength += charWidth;
			}

			const numberOfAdditionalTabs = (wrappingIndent === WrappingIndent.DeepIndent ? 2 : wrappingIndent === WrappingIndent.Indent ? 1 : 0);
			for (let i = 0; i < numberOfAdditionalTabs; i++) {
				const charWidth = tabCharacterWidth(wrappedTextIndentLength, tabSize);
				wrappedTextIndentLength += charWidth;
			}

			if (wrappedTextIndentLength + columnsForFullWidthChar > firstLineBreakColumn) {
				wrappedTextIndentLength = 0;
			}
		}
	}
	return wrappedTextIndentLength;
}
