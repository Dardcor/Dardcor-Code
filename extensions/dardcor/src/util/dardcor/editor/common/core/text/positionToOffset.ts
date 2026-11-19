/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringEdit, StringReplacement } from '../edits/stringEdit';
import { TextEdit, TextReplacement } from '../edits/textEdit';
import { _setPositionOffsetTransformerDependencies } from './positionToOffsetImpl';
import { TextLength } from './textLength';

export { PositionOffsetTransformerBase, PositionOffsetTransformer } from './positionToOffsetImpl';

_setPositionOffsetTransformerDependencies({
	StringEdit: StringEdit,
	StringReplacement: StringReplacement,
	TextReplacement: TextReplacement,
	TextEdit: TextEdit,
	TextLength: TextLength,
});

export function ensureDependenciesAreSet(): void {
}
