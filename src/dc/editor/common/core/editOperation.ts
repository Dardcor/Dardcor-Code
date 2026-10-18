/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from './position.js';
import { IRange, Range } from './range.js';

export interface ISingleEditOperation {
	range: IRange;
	text: string | null;
	forceMoveMarkers?: boolean;
}

export class EditOperation {

	public static insert(position: Position, text: string): ISingleEditOperation {
		return {
			range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
			text: text,
			forceMoveMarkers: true
		};
	}

	public static delete(range: Range): ISingleEditOperation {
		return {
			range: range,
			text: null
		};
	}

	public static replace(range: Range, text: string | null): ISingleEditOperation {
		return {
			range: range,
			text: text
		};
	}

	public static replaceMove(range: Range, text: string | null): ISingleEditOperation {
		return {
			range: range,
			text: text,
			forceMoveMarkers: true
		};
	}
}
