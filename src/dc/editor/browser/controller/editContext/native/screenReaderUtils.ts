/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IComputedEditorOptions } from '../../../../common/config/editorOptions.js';
import { Selection } from '../../../../common/core/selection.js';

export interface IScreenReaderContent {

	dispose(): void;

	onWillCut(): void;

	onWillPaste(): void;

	onFocusChange(newFocusValue: boolean): void;

	onConfigurationChanged(options: IComputedEditorOptions): void;

	updateScreenReaderContent(primarySelection: Selection): void;

	updateScrollTop(primarySelection: Selection): void;
}
