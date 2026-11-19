/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkerDecorationsService } from '../../common/services/markerDecorations.js';
import { ICodeEditor } from '../editorBrowser.js';
import { IEditorContribution } from '../../common/editorCommon.js';

export class MarkerDecorationsContribution implements IEditorContribution {

	public static readonly ID: string = 'editor.contrib.markerDecorations';

	constructor(
		_editor: ICodeEditor,
		@IMarkerDecorationsService _markerDecorationsService: IMarkerDecorationsService
	) {
	}

	dispose(): void {
	}
}
