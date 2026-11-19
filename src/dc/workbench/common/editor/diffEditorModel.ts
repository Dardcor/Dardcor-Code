/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorModel } from './editorModel.js';
import { IResolvableEditorModel } from '../../../platform/editor/common/editor.js';

export class DiffEditorModel extends EditorModel {

	protected readonly _originalModel: IResolvableEditorModel | undefined;
	get originalModel(): IResolvableEditorModel | undefined { return this._originalModel; }

	protected readonly _modifiedModel: IResolvableEditorModel | undefined;
	get modifiedModel(): IResolvableEditorModel | undefined { return this._modifiedModel; }

	constructor(originalModel: IResolvableEditorModel | undefined, modifiedModel: IResolvableEditorModel | undefined) {
		super();

		this._originalModel = originalModel;
		this._modifiedModel = modifiedModel;
	}

	override async resolve(): Promise<void> {
		await Promise.all([
			this._originalModel?.resolve(),
			this._modifiedModel?.resolve()
		]);
	}

	override isResolved(): boolean {
		return !!(this._originalModel?.isResolved() && this._modifiedModel?.isResolved());
	}

	override dispose(): void {


		super.dispose();
	}
}
