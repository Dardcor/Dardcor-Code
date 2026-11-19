/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRange } from '../../../../../../../editor/common/core/range.js';
import { inputPlaceholderForeground } from '../../../../../../../platform/theme/common/colorRegistry.js';
import { IThemeService } from '../../../../../../../platform/theme/common/themeService.js';

export function getRangeForPlaceholder(editorRange: IRange): IRange {
	return {
		startLineNumber: editorRange.startLineNumber,
		endLineNumber: editorRange.endLineNumber,
		startColumn: editorRange.endColumn + 1,
		endColumn: 1000
	};
}

export function getInputPlaceholderColor(themeService: IThemeService): string | undefined {
	const theme = themeService.getColorTheme();
	const transparentForeground = theme.getColor(inputPlaceholderForeground);
	return transparentForeground?.toString();
}
