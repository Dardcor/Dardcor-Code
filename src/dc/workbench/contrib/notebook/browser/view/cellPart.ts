/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ICellViewModel } from '../notebookBrowser.js';
import { CellViewModelStateChangeEvent } from '../notebookViewEvents.js';
import { ICellExecutionStateChangedEvent } from '../../common/notebookExecutionStateService.js';

export abstract class CellContentPart extends Disposable {
	protected currentCell: ICellViewModel | undefined;
	protected readonly cellDisposables = this._register(new DisposableStore());

	constructor() {
		super();
	}

	prepareRenderCell(element: ICellViewModel): void { }

	renderCell(element: ICellViewModel): void {
		this.currentCell = element;
		safeInvokeNoArg(() => this.didRenderCell(element));
	}

	didRenderCell(element: ICellViewModel): void { }

	unrenderCell(element: ICellViewModel): void {
		this.currentCell = undefined;
		this.cellDisposables.clear();
	}

	prepareLayout(): void { }

	updateInternalLayoutNow(element: ICellViewModel): void { }

	updateState(element: ICellViewModel, e: CellViewModelStateChangeEvent): void { }

	updateForExecutionState(element: ICellViewModel, e: ICellExecutionStateChangedEvent): void { }
}

export abstract class CellOverlayPart extends Disposable {
	protected currentCell: ICellViewModel | undefined;
	protected readonly cellDisposables = this._register(new DisposableStore());

	constructor() {
		super();
	}

	prepareRenderCell(element: ICellViewModel): void { }

	renderCell(element: ICellViewModel): void {
		this.currentCell = element;
		this.didRenderCell(element);
	}

	didRenderCell(element: ICellViewModel): void { }

	unrenderCell(element: ICellViewModel): void {
		this.currentCell = undefined;
		this.cellDisposables.clear();
	}

	updateInternalLayoutNow(element: ICellViewModel): void { }

	updateState(element: ICellViewModel, e: CellViewModelStateChangeEvent): void { }

	updateForExecutionState(element: ICellViewModel, e: ICellExecutionStateChangedEvent): void { }
}

function safeInvokeNoArg<T>(func: () => T): T | null {
	try {
		return func();
	} catch (e) {
		onUnexpectedError(e);
		return null;
	}
}

export class CellPartsCollection extends Disposable {
	private readonly _scheduledOverlayRendering = this._register(new MutableDisposable());
	private readonly _scheduledOverlayUpdateState = this._register(new MutableDisposable());
	private readonly _scheduledOverlayUpdateExecutionState = this._register(new MutableDisposable());

	constructor(
		private readonly targetWindow: Window,
		private readonly contentParts: readonly CellContentPart[],
		private readonly overlayParts: readonly CellOverlayPart[]
	) {
		super();
	}

	concatContentPart(other: readonly CellContentPart[], targetWindow: Window): CellPartsCollection {
		return new CellPartsCollection(targetWindow, this.contentParts.concat(other), this.overlayParts);
	}

	concatOverlayPart(other: readonly CellOverlayPart[], targetWindow: Window): CellPartsCollection {
		return new CellPartsCollection(targetWindow, this.contentParts, this.overlayParts.concat(other));
	}

	scheduleRenderCell(element: ICellViewModel): void {
		for (const part of this.contentParts) {
			safeInvokeNoArg(() => part.prepareRenderCell(element));
		}

		for (const part of this.overlayParts) {
			safeInvokeNoArg(() => part.prepareRenderCell(element));
		}

		for (const part of this.contentParts) {
			safeInvokeNoArg(() => part.renderCell(element));
		}

		this._scheduledOverlayRendering.value = DOM.modify(this.targetWindow, () => {
			for (const part of this.overlayParts) {
				safeInvokeNoArg(() => part.renderCell(element));
			}
		});
	}

	unrenderCell(element: ICellViewModel): void {
		for (const part of this.contentParts) {
			safeInvokeNoArg(() => part.unrenderCell(element));
		}

		this._scheduledOverlayRendering.value = undefined;
		this._scheduledOverlayUpdateState.value = undefined;
		this._scheduledOverlayUpdateExecutionState.value = undefined;

		for (const part of this.overlayParts) {
			safeInvokeNoArg(() => part.unrenderCell(element));
		}
	}

	updateInternalLayoutNow(viewCell: ICellViewModel) {
		for (const part of this.contentParts) {
			safeInvokeNoArg(() => part.updateInternalLayoutNow(viewCell));
		}

		for (const part of this.overlayParts) {
			safeInvokeNoArg(() => part.updateInternalLayoutNow(viewCell));
		}
	}

	prepareLayout() {
		for (const part of this.contentParts) {
			safeInvokeNoArg(() => part.prepareLayout());
		}
	}

	updateState(viewCell: ICellViewModel, e: CellViewModelStateChangeEvent) {
		for (const part of this.contentParts) {
			safeInvokeNoArg(() => part.updateState(viewCell, e));
		}

		this._scheduledOverlayUpdateState.value = DOM.modify(this.targetWindow, () => {
			for (const part of this.overlayParts) {
				safeInvokeNoArg(() => part.updateState(viewCell, e));
			}
		});
	}

	updateForExecutionState(viewCell: ICellViewModel, e: ICellExecutionStateChangedEvent) {
		for (const part of this.contentParts) {
			safeInvokeNoArg(() => part.updateForExecutionState(viewCell, e));
		}

		this._scheduledOverlayUpdateExecutionState.value = DOM.modify(this.targetWindow, () => {
			for (const part of this.overlayParts) {
				safeInvokeNoArg(() => part.updateForExecutionState(viewCell, e));
			}
		});
	}
}
