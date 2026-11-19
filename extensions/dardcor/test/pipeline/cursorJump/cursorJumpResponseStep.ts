/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OffsetRange } from '../../../src/util/dardcor/editor/common/core/ranges/offsetRange';
import { ICrossFileJump, ISameFileJump, normalizeRelativePathForModel } from './detectJump';

export interface ISameFileGeneratedResponse {
	readonly assistant: string;
	readonly jump: {
		readonly fromLine: number;
		readonly toLine: number;
		readonly distance: number;
	};
}

export interface ICrossFileGeneratedResponse {
	readonly assistant: string;
	readonly jump: {
		readonly fromLine: number;
		readonly toLine: number;
		readonly toFilePath: string;
		readonly distance: number;
	};
}

export function generateSameFileResponse(
	jump: ISameFileJump,
	keptRange: OffsetRange,
): ISameFileGeneratedResponse | { error: string } {
	if (jump.toLine < keptRange.start || jump.toLine >= keptRange.endExclusive) {
		return { error: `outsideKeptRange (toLine=${jump.toLine}, keptRange=[${keptRange.start}, ${keptRange.endExclusive}))` };
	}
	return {
		assistant: String(jump.toLine),
		jump: {
			fromLine: jump.fromLine,
			toLine: jump.toLine,
			distance: Math.abs(jump.toLine - jump.fromLine),
		},
	};
}

export function generateCrossFileResponse(
	jump: ICrossFileJump,
	cursorAtRequestLine: number,
): ICrossFileGeneratedResponse | { error: string } {
	const normalizedPath = normalizeRelativePathForModel(jump.toRelativePath);
	if (!normalizedPath) {
		return { error: 'crossFileEmptyPath' };
	}
	return {
		assistant: `${normalizedPath}:${jump.toLine}`,
		jump: {
			fromLine: cursorAtRequestLine,
			toLine: jump.toLine,
			toFilePath: normalizedPath,
			distance: 0,
		},
	};
}
