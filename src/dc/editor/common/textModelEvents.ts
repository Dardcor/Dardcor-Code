/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPosition } from './core/position.js';
import { IRange, Range } from './core/range.js';
import { Selection } from './core/selection.js';
import { IModelDecoration, InjectedTextOptions } from './model.js';
import { IModelContentChange } from './model/mirrorTextModel.js';
import { AnnotationsUpdate } from './model/tokens/annotations.js';
import { TextModelEditSource } from './textModelEditSource.js';

export interface IModelLanguageChangedEvent {
	readonly oldLanguage: string;
	readonly newLanguage: string;

	readonly source: string;
}

export interface IModelLanguageConfigurationChangedEvent {
}

export interface IModelContentChangedEvent {
	readonly changes: IModelContentChange[];
	readonly eol: string;
	readonly versionId: number;
	readonly isUndoing: boolean;
	readonly isRedoing: boolean;
	readonly isFlush: boolean;

	readonly isEolChange: boolean;

	/**
	 * Detailed reason information for the change
	 * @internal
	 */
	readonly detailedReasons: TextModelEditSource[];

	readonly detailedReasonsChangeLengths: number[];
}

export interface ISerializedModelContentChangedEvent {
	readonly changes: IModelContentChange[];
	readonly eol: string;
	readonly versionId: number;
	readonly isUndoing: boolean;
	readonly isRedoing: boolean;
	readonly isFlush: boolean;

	readonly isEolChange: boolean;

	/**
	 * Detailed reason information for the change
	 * @internal
	 */
	readonly detailedReason: Record<string, unknown> | undefined;
}

export interface IModelDecorationsChangedEvent {
	readonly affectsMinimap: boolean;
	readonly affectsOverviewRuler: boolean;
	readonly affectsGlyphMargin: boolean;
	readonly affectsLineNumber: boolean;
}

/**
 * An event describing that some ranges of lines have been tokenized (their tokens have changed).
 * @internal
 */
export interface IModelTokensChangedEvent {
	readonly semanticTokensApplied: boolean;
	readonly ranges: {
		readonly fromLineNumber: number;
		readonly toLineNumber: number;
	}[];
}

/**
 * @internal
 */
export interface IFontTokenOption {
	readonly fontFamily?: string;
	readonly fontSizeMultiplier?: number;
	readonly lineHeightMultiplier?: number;
}

/**
 * An event describing a token font change event
 * @internal
 */
export interface IModelFontTokensChangedEvent {
	changes: FontTokensUpdate;
}

/**
 * @internal
 */
export type FontTokensUpdate = AnnotationsUpdate<IFontTokenOption | undefined>;

/**
 * @internal
 */
export function serializeFontTokenOptions(): (options: IFontTokenOption) => IFontTokenOption {
	return (annotation: IFontTokenOption) => {
		return {
			fontFamily: annotation.fontFamily ?? '',
			fontSizeMultiplier: annotation.fontSizeMultiplier ?? 0,
			lineHeightMultiplier: annotation.lineHeightMultiplier ?? 0
		};
	};
}

/**
 * @internal
 */
export function deserializeFontTokenOptions(): (options: IFontTokenOption) => IFontTokenOption {
	return (annotation: IFontTokenOption) => {
		return {
			fontFamily: annotation.fontFamily ? String(annotation.fontFamily) : undefined,
			fontSizeMultiplier: annotation.fontSizeMultiplier ? Number(annotation.fontSizeMultiplier) : undefined,
			lineHeightMultiplier: annotation.lineHeightMultiplier ? Number(annotation.lineHeightMultiplier) : undefined
		};
	};
}

export interface IModelOptionsChangedEvent {
	readonly tabSize: boolean;
	readonly indentSize: boolean;
	readonly insertSpaces: boolean;
	readonly trimAutoWhitespace: boolean;
}

/**
 * @internal
 */
export const enum RawContentChangedType {
	Flush = 1,
	LineChanged = 2,
	LinesDeleted = 3,
	LinesInserted = 4,
	EOLChanged = 5
}

/**
 * An event describing that a model has been reset to a new value.
 * @internal
 */
export class ModelRawFlush {
	public readonly changeType = RawContentChangedType.Flush;
}

/**
 * Represents text injected on a line
 * @internal
 */
export class LineInjectedText {
	public static applyInjectedText(lineText: string, injectedTexts: LineInjectedText[] | null): string {
		if (!injectedTexts || injectedTexts.length === 0) {
			return lineText;
		}
		let result = '';
		let lastOriginalOffset = 0;
		for (const injectedText of injectedTexts) {
			result += lineText.substring(lastOriginalOffset, injectedText.column - 1);
			lastOriginalOffset = injectedText.column - 1;
			result += injectedText.options.content;
		}
		result += lineText.substring(lastOriginalOffset);
		return result;
	}

	public static fromDecorations(decorations: IModelDecoration[]): LineInjectedText[] {
		const result: LineInjectedText[] = [];
		for (const decoration of decorations) {
			if (decoration.options.before && decoration.options.before.content.length > 0) {
				result.push(new LineInjectedText(
					decoration.ownerId,
					decoration.range.startLineNumber,
					decoration.range.startColumn,
					decoration.options.before,
					0,
				));
			}
			if (decoration.options.after && decoration.options.after.content.length > 0) {
				result.push(new LineInjectedText(
					decoration.ownerId,
					decoration.range.endLineNumber,
					decoration.range.endColumn,
					decoration.options.after,
					1,
				));
			}
		}
		result.sort((a, b) => {
			if (a.lineNumber === b.lineNumber) {
				if (a.column === b.column) {
					return a.order - b.order;
				}
				return a.column - b.column;
			}
			return a.lineNumber - b.lineNumber;
		});
		return result;
	}

	constructor(
		public readonly ownerId: number,
		public readonly lineNumber: number,
		public readonly column: number,
		public readonly options: InjectedTextOptions,
		public readonly order: number
	) { }

	public withText(text: string): LineInjectedText {
		return new LineInjectedText(this.ownerId, this.lineNumber, this.column, { ...this.options, content: text }, this.order);
	}
}

/**
 * An event describing that a line has changed in a model.
 * @internal
 */
export class ModelRawLineChanged {
	public readonly changeType = RawContentChangedType.LineChanged;
	public readonly lineNumber: number;
	public readonly lineNumberPostEdit: number;

	constructor(lineNumber: number, lineNumberPostEdit: number) {
		this.lineNumber = lineNumber;
		this.lineNumberPostEdit = lineNumberPostEdit;
	}
}


/**
 * An event describing that a line height has changed in the model.
 * @internal
 */
export class ModelLineHeightChanged {
	public readonly ownerId: number;
	public readonly decorationId: string;
	public readonly lineNumber: number;
	public readonly lineHeightMultiplier: number | null;

	constructor(ownerId: number, decorationId: string, lineNumber: number, lineHeightMultiplier: number | null) {
		this.ownerId = ownerId;
		this.decorationId = decorationId;
		this.lineNumber = lineNumber;
		this.lineHeightMultiplier = lineHeightMultiplier;
	}
}

/**
 * An event describing that a line height has changed in the model.
 * @internal
 */
export class ModelFontChanged {
	public readonly ownerId: number;
	public readonly lineNumber: number;

	constructor(ownerId: number, lineNumber: number) {
		this.ownerId = ownerId;
		this.lineNumber = lineNumber;
	}
}

/**
 * An event describing that line(s) have been deleted in a model.
 * @internal
 */
export class ModelRawLinesDeleted {
	public readonly changeType = RawContentChangedType.LinesDeleted;
	public readonly fromLineNumber: number;
	public readonly toLineNumber: number;
	public readonly lastUntouchedLinePostEdit: number;

	constructor(fromLineNumber: number, toLineNumber: number, lastUntouchedLinePostEdit: number) {
		this.fromLineNumber = fromLineNumber;
		this.toLineNumber = toLineNumber;
		this.lastUntouchedLinePostEdit = lastUntouchedLinePostEdit;
	}
}

/**
 * An event describing that line(s) have been inserted in a model.
 * @internal
 */
export class ModelRawLinesInserted {
	public readonly changeType = RawContentChangedType.LinesInserted;
	public readonly fromLineNumber: number;
	public readonly fromLineNumberPostEdit: number;
	public readonly count: number;
	public get toLineNumber(): number {
		return this.fromLineNumber + this.count - 1;
	}
	public get toLineNumberPostEdit(): number {
		return this.fromLineNumberPostEdit + this.count - 1;
	}

	constructor(fromLineNumber: number, fromLineNumberPostEdit: number, count: number) {
		this.fromLineNumber = fromLineNumber;
		this.fromLineNumberPostEdit = fromLineNumberPostEdit;
		this.count = count;
	}
}

/**
 * An event describing that a model has had its EOL changed.
 * @internal
 */
export class ModelRawEOLChanged {
	public readonly changeType = RawContentChangedType.EOLChanged;
}

/**
 * @internal
 */
export type ModelRawChange = ModelRawFlush | ModelRawLineChanged | ModelRawLinesDeleted | ModelRawLinesInserted | ModelRawEOLChanged;

/**
 * An event describing a change in the text of a model.
 * @internal
 */
export class ModelRawContentChangedEvent {

	public readonly changes: ModelRawChange[];
	public readonly versionId: number;
	public readonly isUndoing: boolean;
	public readonly isRedoing: boolean;

	public resultingSelection: Selection[] | null;

	constructor(changes: ModelRawChange[], versionId: number, isUndoing: boolean, isRedoing: boolean) {
		this.changes = changes;
		this.versionId = versionId;
		this.isUndoing = isUndoing;
		this.isRedoing = isRedoing;
		this.resultingSelection = null;
	}

	public containsEvent(type: RawContentChangedType): boolean {
		for (let i = 0, len = this.changes.length; i < len; i++) {
			const change = this.changes[i];
			if (change.changeType === type) {
				return true;
			}
		}
		return false;
	}

	public static merge(a: ModelRawContentChangedEvent, b: ModelRawContentChangedEvent): ModelRawContentChangedEvent {
		const changes = ([] as ModelRawChange[]).concat(a.changes).concat(b.changes);
		const versionId = b.versionId;
		const isUndoing = (a.isUndoing || b.isUndoing);
		const isRedoing = (a.isRedoing || b.isRedoing);
		return new ModelRawContentChangedEvent(changes, versionId, isUndoing, isRedoing);
	}
}

/**
 * An event describing a change in injected text.
 * @internal
 */
export class ModelInjectedTextChangedEvent {

	public readonly changes: ModelRawLineChanged[];

	constructor(changes: ModelRawLineChanged[]) {
		this.changes = changes;
	}
}

/**
 * An event describing a change of a line height.
 * @internal
 */
export class ModelLineHeightChangedEvent {

	public readonly changes: ModelLineHeightChanged[];

	constructor(changes: ModelLineHeightChanged[]) {
		this.changes = changes;
	}

	public affects(rangeOrPosition: IRange | IPosition) {
		if (Range.isIRange(rangeOrPosition)) {
			for (const change of this.changes) {
				if (change.lineNumber >= rangeOrPosition.startLineNumber && change.lineNumber <= rangeOrPosition.endLineNumber) {
					return true;
				}
			}
			return false;
		} else {
			for (const change of this.changes) {
				if (change.lineNumber === rangeOrPosition.lineNumber) {
					return true;
				}
			}
			return false;
		}
	}
}

/**
 * An event describing a change in fonts.
 * @internal
 */
export class ModelFontChangedEvent {

	public readonly changes: ModelFontChanged[];

	constructor(changes: ModelFontChanged[]) {
		this.changes = changes;
	}
}

/**
 * @internal
 */
export class InternalModelContentChangeEvent {
	constructor(
		public readonly rawContentChangedEvent: ModelRawContentChangedEvent,
		public readonly contentChangedEvent: IModelContentChangedEvent,
	) { }

	public merge(other: InternalModelContentChangeEvent): InternalModelContentChangeEvent {
		const rawContentChangedEvent = ModelRawContentChangedEvent.merge(this.rawContentChangedEvent, other.rawContentChangedEvent);
		const contentChangedEvent = InternalModelContentChangeEvent._mergeChangeEvents(this.contentChangedEvent, other.contentChangedEvent);
		return new InternalModelContentChangeEvent(rawContentChangedEvent, contentChangedEvent);
	}

	private static _mergeChangeEvents(a: IModelContentChangedEvent, b: IModelContentChangedEvent): IModelContentChangedEvent {
		const changes = ([] as IModelContentChange[]).concat(a.changes).concat(b.changes);
		const eol = b.eol;
		const versionId = b.versionId;
		const isUndoing = (a.isUndoing || b.isUndoing);
		const isRedoing = (a.isRedoing || b.isRedoing);
		const isFlush = (a.isFlush || b.isFlush);
		const isEolChange = a.isEolChange && b.isEolChange;
		return {
			changes: changes,
			eol: eol,
			isEolChange: isEolChange,
			versionId: versionId,
			isUndoing: isUndoing,
			isRedoing: isRedoing,
			isFlush: isFlush,
			detailedReasons: a.detailedReasons.concat(b.detailedReasons),
			detailedReasonsChangeLengths: a.detailedReasonsChangeLengths.concat(b.detailedReasonsChangeLengths),
		};
	}
}
