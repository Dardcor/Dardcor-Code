/**
 * Dardcor Code - Undo Element (Task 167)
 * Mirrors: vs/platform/undoRedo/common/undoRedo.ts
 */

import { URI } from '../../core/types/uri';
import { IUndoRedoElement } from './undo-redo-service';

export class WorkspaceEditUndoElement implements IUndoRedoElement {
	readonly uri: URI;

	constructor(
		readonly label: string,
		uri: URI,
		private readonly _undoAction: () => Promise<void> | void,
		private readonly _redoAction: () => Promise<void> | void
	) {
		this.uri = uri;
	}

	async undo(): Promise<void> {
		await this._undoAction();
	}

	async redo(): Promise<void> {
		await this._redoAction();
	}
}
