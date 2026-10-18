/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolResult } from '../languageModelToolsService.js';

export function createToolSimpleTextResult(value: string): IToolResult {
	return {
		content: [{
			kind: 'text',
			value
		}]
	};
}
