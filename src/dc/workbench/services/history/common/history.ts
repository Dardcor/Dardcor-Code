/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IResourceEditorInput } from '../../../../platform/editor/common/editor.js';
import { GroupIdentifier } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { URI } from '../../../../base/common/uri.js';

export const IHistoryService = createDecorator<IHistoryService>('historyService');

export const MOUSE_BACK_FORWARD_NAVIGATION_SETTING = 'workbench.editor.mouseBackForwardToNavigate';

export const enum GoFilter {

	NONE,

	EDITS,

	NAVIGATION
}

export const enum GoScope {

	DEFAULT,

	EDITOR_GROUP,

	EDITOR
}

export interface IHistoryService {

	readonly _serviceBrand: undefined;

	goForward(filter?: GoFilter): Promise<void>;

	goBack(filter?: GoFilter): Promise<void>;

	goPrevious(filter?: GoFilter): Promise<void>;

	goLast(filter?: GoFilter): Promise<void>;

	reopenLastClosedEditor(): Promise<void>;

	getHistory(): readonly (EditorInput | IResourceEditorInput)[];

	removeFromHistory(input: EditorInput | IResourceEditorInput): void;

	getLastActiveWorkspaceRoot(schemeFilter?: string, authorityFilter?: string): URI | undefined;

	getLastActiveFile(schemeFilter: string, authorityFilter?: string): URI | undefined;

	openNextRecentlyUsedEditor(group?: GroupIdentifier): Promise<void>;

	openPreviouslyUsedEditor(group?: GroupIdentifier): Promise<void>;

	clear(): void;

	clearRecentlyOpened(): void;
}
