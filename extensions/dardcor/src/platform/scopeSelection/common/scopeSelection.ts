/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Selection, TextEditor } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export const IScopeSelector = createServiceIdentifier<IScopeSelector>('IScopeSelector');
export interface IScopeSelector {
	_serviceBrand: undefined;
	selectEnclosingScope(editor: TextEditor, options?: { reason?: string; includeBlocks?: boolean }): Promise<Selection | undefined>;
}
