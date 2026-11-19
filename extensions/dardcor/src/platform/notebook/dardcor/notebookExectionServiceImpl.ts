/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookCell, workspace } from 'vscode';
import { Emitter } from '../../../util/dardcor/base/common/event';
import { IDisposable } from '../../../util/dardcor/base/common/lifecycle';

export enum NotebookCellExecutionState {
	Idle = 1,
	Executing = 2
}

export interface NotebookCellExecutionStateChangeEvent {
	readonly cell: NotebookCell;
	readonly state: NotebookCellExecutionState;
}


export class NotebookExecutionServiceImpl implements IDisposable {
	private readonly _onDidChangeNotebookCellExecutionStateEmitter = new Emitter<NotebookCellExecutionStateChangeEvent>();
	readonly onDidChangeNotebookCellExecutionState = this._onDidChangeNotebookCellExecutionStateEmitter.event;

	private _disposables: IDisposable[] = [];
	private _cellExecution = new WeakMap<NotebookCell, boolean>();

	constructor() {
		this._disposables.push(workspace.onDidChangeNotebookDocument(e => {
			for (const cellChange of e.cellChanges) {
				if (cellChange.executionSummary) {
					const executionSummary = cellChange.executionSummary;

					if (executionSummary.success === undefined) {
						if (!this._cellExecution.has(cellChange.cell)) {
							this._cellExecution.set(cellChange.cell, true);
							this._onDidChangeNotebookCellExecutionStateEmitter.fire({ cell: cellChange.cell, state: NotebookCellExecutionState.Executing });
						}
					} else {
						this._cellExecution.delete(cellChange.cell);
						this._onDidChangeNotebookCellExecutionStateEmitter.fire({ cell: cellChange.cell, state: NotebookCellExecutionState.Idle });
					}
				}
			}
		}));
	}

	dispose() {
		this._disposables.forEach(d => d.dispose());
	}
}
