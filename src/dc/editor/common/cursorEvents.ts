/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from './core/position.js';
import { Selection } from './core/selection.js';

export const enum CursorChangeReason {
	NotSet = 0,
	ContentFlush = 1,
	RecoverFromMarkers = 2,
	Explicit = 3,
	Paste = 4,
	Undo = 5,
	Redo = 6,
}
export interface ICursorPositionChangedEvent {
	readonly position: Position;
	readonly secondaryPositions: Position[];
	readonly reason: CursorChangeReason;
	readonly source: string;
}
export interface ICursorSelectionChangedEvent {
	readonly selection: Selection;
	readonly secondarySelections: Selection[];
	readonly modelVersionId: number;
	readonly oldSelections: Selection[] | null;
	readonly oldModelVersionId: number;
	readonly source: string;
	readonly reason: CursorChangeReason;
}
