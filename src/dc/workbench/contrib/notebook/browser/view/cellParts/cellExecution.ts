/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { clamp } from '../../../../../../base/common/numbers.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { ICellViewModel, INotebookEditorDelegate } from '../../notebookBrowser.js';
import { CellContentPart } from '../cellPart.js';
import { CodeCellViewModel } from '../../viewModel/codeCellViewModel.js';
import { NotebookCellInternalMetadata } from '../../../common/notebookCommon.js';
import { INotebookExecutionStateService } from '../../../common/notebookExecutionStateService.js';
import { executingStateIcon } from '../../notebookIcons.js';
import { renderLabelWithIcons } from '../../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { CellViewModelStateChangeEvent } from '../../notebookViewEvents.js';
import { hasKey } from '../../../../../../base/common/types.js';

const UPDATE_EXECUTION_ORDER_GRACE_PERIOD = 200;

export class CellExecutionPart extends CellContentPart {
	private readonly kernelDisposables = this._register(new DisposableStore());
	private readonly _executionOrderContent: HTMLElement;

	constructor(
		private readonly _notebookEditor: INotebookEditorDelegate,
		private readonly _executionOrderLabel: HTMLElement,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService
	) {
		super();

		this._executionOrderLabel.classList.add('cell-execution-order');

		this._executionOrderContent = DOM.append(this._executionOrderLabel, DOM.$('div'));

		this._register(this._notebookExecutionStateService.onDidChangeExecution(e => {
			if (this.currentCell && hasKey(e, { affectsCell: true }) && e.affectsCell(this.currentCell.uri)) {
				this._updatePosition();
			}
		}));

		this._register(this._notebookEditor.onDidChangeActiveKernel(() => {
			if (this.currentCell) {
				this.kernelDisposables.clear();

				if (this._notebookEditor.activeKernel) {
					this.kernelDisposables.add(this._notebookEditor.activeKernel.onDidChange(() => {
						if (this.currentCell) {
							this.updateExecutionOrder(this.currentCell.internalMetadata);
						}
					}));
				}

				this.updateExecutionOrder(this.currentCell.internalMetadata);
			}
		}));

		this._register(this._notebookEditor.onDidScroll(() => {
			this._updatePosition();
		}));
	}

	override didRenderCell(element: ICellViewModel): void {
		this.updateExecutionOrder(element.internalMetadata, true);
	}

	override updateState(element: ICellViewModel, e: CellViewModelStateChangeEvent): void {
		if (e.internalMetadataChanged) {
			this.updateExecutionOrder(element.internalMetadata);
		}
	}

	private updateExecutionOrder(internalMetadata: NotebookCellInternalMetadata, forceClear = false): void {
		if (this._notebookEditor.activeKernel?.implementsExecutionOrder || (!this._notebookEditor.activeKernel && typeof internalMetadata.executionOrder === 'number')) {
			if (typeof internalMetadata.executionOrder !== 'number' && !forceClear && !!this._notebookExecutionStateService.getCellExecution(this.currentCell!.uri)) {
				const renderingCell = this.currentCell;
				disposableTimeout(() => {
					if (this.currentCell === renderingCell) {
						this.updateExecutionOrder(this.currentCell!.internalMetadata, true);
						this._updatePosition();
					}
				}, UPDATE_EXECUTION_ORDER_GRACE_PERIOD, this.cellDisposables);
				return;
			}

			const executionOrderLabel = typeof internalMetadata.executionOrder === 'number' ?
				`[${internalMetadata.executionOrder}]` :
				'[ ]';
			this._executionOrderContent.innerText = executionOrderLabel;

			this._updatePosition();
		} else {
			this._executionOrderContent.innerText = '';
		}
	}

	override updateInternalLayoutNow(element: ICellViewModel): void {
		this._updatePosition();
	}

	private _updatePosition() {
		if (!this.currentCell) {
			return;
		}

		if (this.currentCell.isInputCollapsed) {
			DOM.hide(this._executionOrderLabel);
			return;
		}

		const cellIsRunning = !!this._notebookExecutionStateService.getCellExecution(this.currentCell.uri);

		const wasSticky = this._executionOrderLabel.classList.contains('sticky');

		if (!cellIsRunning) {
			this._executionOrderLabel.classList.remove('sticky');

			if (wasSticky) {
				const executionOrder = this.currentCell.internalMetadata.executionOrder;
				const executionOrderLabel = typeof executionOrder === 'number' ?
					`[${executionOrder}]` :
					'[ ]';
				this._executionOrderContent.innerText = executionOrderLabel;
			}
		}

		DOM.show(this._executionOrderLabel);
		let top = this.currentCell.layoutInfo.editorHeight - 22 + this.currentCell.layoutInfo.statusBarHeight;

		if (this.currentCell instanceof CodeCellViewModel) {
			const elementTop = this._notebookEditor.getAbsoluteTopOfElement(this.currentCell);
			const editorBottom = elementTop + this.currentCell.layoutInfo.outputContainerOffset;
			const scrollBottom = this._notebookEditor.scrollBottom;
			const lineHeight = 22;

			const statusBarVisible = this.currentCell.layoutInfo.statusBarHeight > 0;

			const offset = editorBottom - scrollBottom;
			top -= offset;
			top = clamp(
				top,
				lineHeight + 12,
				this.currentCell.layoutInfo.editorHeight - lineHeight + this.currentCell.layoutInfo.statusBarHeight
			);

			if (scrollBottom <= editorBottom && cellIsRunning) {
				const isAlreadyIcon = this._executionOrderContent.classList.contains('sticky-spinner');
				if (!isAlreadyIcon) {
					this._executionOrderLabel.classList.add('sticky-spinner');
					DOM.clearNode(this._executionOrderContent);
					const icon = ThemeIcon.modify(executingStateIcon, 'spin');
					DOM.append(this._executionOrderContent, ...renderLabelWithIcons(`$(${icon.id})`));
				}
			} else if (!statusBarVisible && cellIsRunning) {
				const wasStickyHere = this._executionOrderLabel.classList.contains('sticky');
				this._executionOrderLabel.classList.remove('sticky');
				top = this.currentCell.layoutInfo.editorHeight - lineHeight;
				// eslint-disable-next-line no-restricted-syntax
				const iconIsPresent = this._executionOrderContent.querySelector('.codicon') !== null;
				if (wasStickyHere || iconIsPresent) {
					const executionOrder = this.currentCell.internalMetadata.executionOrder;
					const executionOrderLabel = typeof executionOrder === 'number' ?
						`[${executionOrder}]` :
						'[ ]';
					this._executionOrderContent.innerText = executionOrderLabel;
				}
			} else {
				const currentlySticky = this._executionOrderLabel.classList.contains('sticky');
				this._executionOrderLabel.classList.remove('sticky');

				if (currentlySticky) {
					const executionOrder = this.currentCell.internalMetadata.executionOrder;
					const executionOrderLabel = typeof executionOrder === 'number' ?
						`[${executionOrder}]` :
						'[ ]';
					this._executionOrderContent.innerText = executionOrderLabel;
				}
			}
		}

		this._executionOrderLabel.style.top = `${top}px`;
	}
}
