/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ScrollEvent } from '../../base/common/scrollable.js';
import { ConfigurationChangedEvent, EditorOption } from './config/editorOptions.js';
import { Range } from './core/range.js';
import { Selection } from './core/selection.js';
import { CursorChangeReason } from './cursorEvents.js';
import { ScrollType } from './editorCommon.js';
import { IModelDecorationsChangedEvent } from './textModelEvents.js';
import { IColorTheme } from '../../platform/theme/common/themeService.js';

export const enum ViewEventType {
	ViewCompositionStart,
	ViewCompositionEnd,
	ViewConfigurationChanged,
	ViewCursorStateChanged,
	ViewDecorationsChanged,
	ViewFlushed,
	ViewFocusChanged,
	ViewLanguageConfigurationChanged,
	ViewLineMappingChanged,
	ViewLinesChanged,
	ViewLinesDeleted,
	ViewLinesInserted,
	ViewRevealRangeRequest,
	ViewScrollChanged,
	ViewThemeChanged,
	ViewTokensChanged,
	ViewTokensColorsChanged,
	ViewZonesChanged,
}

export class ViewCompositionStartEvent {
	public readonly type = ViewEventType.ViewCompositionStart;
	constructor() { }
}

export class ViewCompositionEndEvent {
	public readonly type = ViewEventType.ViewCompositionEnd;
	constructor() { }
}

export class ViewConfigurationChangedEvent {

	public readonly type = ViewEventType.ViewConfigurationChanged;

	public readonly _source: ConfigurationChangedEvent;

	constructor(source: ConfigurationChangedEvent) {
		this._source = source;
	}

	public hasChanged(id: EditorOption): boolean {
		return this._source.hasChanged(id);
	}
}

export class ViewCursorStateChangedEvent {

	public readonly type = ViewEventType.ViewCursorStateChanged;

	constructor(
		public readonly selections: Selection[],
		public readonly modelSelections: Selection[],
		public readonly reason: CursorChangeReason
	) { }
}

export class ViewDecorationsChangedEvent {

	public readonly type = ViewEventType.ViewDecorationsChanged;

	readonly affectsMinimap: boolean;
	readonly affectsOverviewRuler: boolean;
	readonly affectsGlyphMargin: boolean;
	readonly affectsLineNumber: boolean;

	constructor(source: IModelDecorationsChangedEvent | null) {
		if (source) {
			this.affectsMinimap = source.affectsMinimap;
			this.affectsOverviewRuler = source.affectsOverviewRuler;
			this.affectsGlyphMargin = source.affectsGlyphMargin;
			this.affectsLineNumber = source.affectsLineNumber;
		} else {
			this.affectsMinimap = true;
			this.affectsOverviewRuler = true;
			this.affectsGlyphMargin = true;
			this.affectsLineNumber = true;
		}
	}
}

export class ViewFlushedEvent {

	public readonly type = ViewEventType.ViewFlushed;

	constructor() {
	}
}

export class ViewFocusChangedEvent {

	public readonly type = ViewEventType.ViewFocusChanged;

	public readonly isFocused: boolean;

	constructor(isFocused: boolean) {
		this.isFocused = isFocused;
	}
}

export class ViewLanguageConfigurationEvent {

	public readonly type = ViewEventType.ViewLanguageConfigurationChanged;
}

export class ViewLineMappingChangedEvent {

	public readonly type = ViewEventType.ViewLineMappingChanged;

	constructor() {
	}
}

export class ViewLinesChangedEvent {

	public readonly type = ViewEventType.ViewLinesChanged;

	constructor(
		public readonly fromLineNumber: number,
		public readonly count: number,
	) { }
}

export class ViewLinesDeletedEvent {

	public readonly type = ViewEventType.ViewLinesDeleted;

	public readonly fromLineNumber: number;
	public readonly toLineNumber: number;

	constructor(fromLineNumber: number, toLineNumber: number) {
		this.fromLineNumber = fromLineNumber;
		this.toLineNumber = toLineNumber;
	}
}

export class ViewLinesInsertedEvent {

	public readonly type = ViewEventType.ViewLinesInserted;

	public readonly fromLineNumber: number;
	public readonly toLineNumber: number;

	constructor(fromLineNumber: number, toLineNumber: number) {
		this.fromLineNumber = fromLineNumber;
		this.toLineNumber = toLineNumber;
	}
}

export const enum VerticalRevealType {
	Simple = 0,
	Center = 1,
	CenterIfOutsideViewport = 2,
	Top = 3,
	Bottom = 4,
	NearTop = 5,
	NearTopIfOutsideViewport = 6,
}

export class ViewRevealRangeRequestEvent {

	public readonly type = ViewEventType.ViewRevealRangeRequest;


	constructor(
		public readonly source: string | null | undefined,
		public readonly minimalReveal: boolean,
		public readonly range: Range | null,
		public readonly selections: Selection[] | null,
		public readonly verticalType: VerticalRevealType,
		public readonly revealHorizontal: boolean,
		public readonly scrollType: ScrollType
	) { }
}

export class ViewScrollChangedEvent {

	public readonly type = ViewEventType.ViewScrollChanged;

	public readonly scrollWidth: number;
	public readonly scrollLeft: number;
	public readonly scrollHeight: number;
	public readonly scrollTop: number;

	public readonly scrollWidthChanged: boolean;
	public readonly scrollLeftChanged: boolean;
	public readonly scrollHeightChanged: boolean;
	public readonly scrollTopChanged: boolean;

	constructor(source: ScrollEvent) {
		this.scrollWidth = source.scrollWidth;
		this.scrollLeft = source.scrollLeft;
		this.scrollHeight = source.scrollHeight;
		this.scrollTop = source.scrollTop;

		this.scrollWidthChanged = source.scrollWidthChanged;
		this.scrollLeftChanged = source.scrollLeftChanged;
		this.scrollHeightChanged = source.scrollHeightChanged;
		this.scrollTopChanged = source.scrollTopChanged;
	}
}

export class ViewThemeChangedEvent {

	public readonly type = ViewEventType.ViewThemeChanged;

	constructor(
		public readonly theme: IColorTheme
	) { }
}

export class ViewTokensChangedEvent {

	public readonly type = ViewEventType.ViewTokensChanged;

	public readonly ranges: {
		readonly fromLineNumber: number;
		readonly toLineNumber: number;
	}[];

	constructor(ranges: { fromLineNumber: number; toLineNumber: number }[]) {
		this.ranges = ranges;
	}
}

export class ViewTokensColorsChangedEvent {

	public readonly type = ViewEventType.ViewTokensColorsChanged;

	constructor() {
	}
}

export class ViewZonesChangedEvent {

	public readonly type = ViewEventType.ViewZonesChanged;

	constructor() {
	}
}

export type ViewEvent = (
	ViewCompositionStartEvent
	| ViewCompositionEndEvent
	| ViewConfigurationChangedEvent
	| ViewCursorStateChangedEvent
	| ViewDecorationsChangedEvent
	| ViewFlushedEvent
	| ViewFocusChangedEvent
	| ViewLanguageConfigurationEvent
	| ViewLineMappingChangedEvent
	| ViewLinesChangedEvent
	| ViewLinesDeletedEvent
	| ViewLinesInsertedEvent
	| ViewRevealRangeRequestEvent
	| ViewScrollChangedEvent
	| ViewThemeChangedEvent
	| ViewTokensChangedEvent
	| ViewTokensColorsChangedEvent
	| ViewZonesChangedEvent
);
