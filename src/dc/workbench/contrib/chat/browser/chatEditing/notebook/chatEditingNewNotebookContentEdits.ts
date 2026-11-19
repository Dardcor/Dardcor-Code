/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { TextEdit } from '../../../../../../editor/common/languages.js';
import { NotebookTextModel } from '../../../../notebook/common/model/notebookTextModel.js';
import { CellEditType, ICellEditOperation } from '../../../../notebook/common/notebookCommon.js';
import { INotebookService } from '../../../../notebook/common/notebookService.js';


export class ChatEditingNewNotebookContentEdits {
	private readonly textEdits: TextEdit[] = [];
	constructor(
		private readonly notebook: NotebookTextModel,
		@INotebookService private readonly _notebookService: INotebookService,
	) {
	}

	acceptTextEdits(edits: TextEdit[]): void {
		if (edits.length) {
			this.textEdits.push(...edits);
		}
	}

	async generateEdits(): Promise<ICellEditOperation[]> {
		if (this.notebook.cells.length) {
			console.error(`Notebook edits not generated as notebook already has cells`);
			return [];
		}
		const content = this.generateContent();
		if (!content) {
			return [];
		}

		const notebookEdits: ICellEditOperation[] = [];
		try {
			const { serializer } = await this._notebookService.withNotebookDataProvider(this.notebook.viewType);
			const data = await serializer.dataToNotebook(VSBuffer.fromString(content));
			for (let i = 0; i < data.cells.length; i++) {
				notebookEdits.push({
					editType: CellEditType.Replace,
					index: i,
					count: 0,
					cells: [data.cells[i]]
				});
			}
		} catch (ex) {
			console.error(`Failed to generate notebook edits from text edits ${content}`, ex);
			return [];
		}

		return notebookEdits;
	}

	private generateContent() {
		try {
			return applyTextEdits(this.textEdits);
		} catch (ex) {
			console.error('Failed to generate content from text edits', ex);
			return '';
		}
	}
}

function applyTextEdits(edits: TextEdit[]): string {
	let output = '';
	for (const edit of edits) {
		output = output.slice(0, edit.range.startColumn)
			+ edit.text
			+ output.slice(edit.range.endColumn);
	}
	return output;
}
