/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDiffEditorModel } from '../../../editor/common/editorCommon.js';
import { BaseTextEditorModel } from './textEditorModel.js';
import { DiffEditorModel } from './diffEditorModel.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';

export class TextDiffEditorModel extends DiffEditorModel {

	protected override readonly _originalModel: BaseTextEditorModel | undefined;
	override get originalModel(): BaseTextEditorModel | undefined { return this._originalModel; }

	protected override readonly _modifiedModel: BaseTextEditorModel | undefined;
	override get modifiedModel(): BaseTextEditorModel | undefined { return this._modifiedModel; }

	private _textDiffEditorModel: IDiffEditorModel | undefined = undefined;
	get textDiffEditorModel(): IDiffEditorModel | undefined { return this._textDiffEditorModel; }

	constructor(originalModel: BaseTextEditorModel, modifiedModel: BaseTextEditorModel) {
		super(originalModel, modifiedModel);

		this._originalModel = originalModel;
		this._modifiedModel = modifiedModel;

		this.updateTextDiffEditorModel();
	}

	override async resolve(): Promise<void> {
		await super.resolve();

		this.updateTextDiffEditorModel();
	}

	private updateTextDiffEditorModel(): void {
		if (this.originalModel?.isResolved() && this.modifiedModel?.isResolved()) {

			if (!this._textDiffEditorModel) {
				this._textDiffEditorModel = {
					original: this.originalModel.textEditorModel,
					modified: this.modifiedModel.textEditorModel
				};
			}

			else {
				this._textDiffEditorModel.original = this.originalModel.textEditorModel;
				this._textDiffEditorModel.modified = this.modifiedModel.textEditorModel;
			}
		}
	}

	override isResolved(): boolean {
		return !!this._textDiffEditorModel;
	}

	isReadonly(): boolean | IMarkdownString {
		return !!this.modifiedModel && this.modifiedModel.isReadonly();
	}

	override dispose(): void {

		this._textDiffEditorModel = undefined;

		super.dispose();
	}
}
