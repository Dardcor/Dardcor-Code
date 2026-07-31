/**
 * Dardcor Code - Document Undo/Redo Transaction Stack (Task 205)
 * Mirrors: vs/editor/common/model/editStack.ts
 */

export interface IEditOperation {
	undo(): void;
	redo(): void;
}

export class EditStack {
	private _past: IEditOperation[][] = [];
	private _future: IEditOperation[][] = [];

	push(operations: IEditOperation[]): void {
		if (operations.length > 0) {
			this._past.push(operations);
			this._future = [];
		}
	}

	canUndo(): boolean {
		return this._past.length > 0;
	}

	canRedo(): boolean {
		return this._future.length > 0;
	}

	undo(): void {
		const ops = this._past.pop();
		if (ops) {
			for (let i = ops.length - 1; i >= 0; i--) {
				ops[i].undo();
			}
			this._future.push(ops);
		}
	}

	redo(): void {
		const ops = this._future.pop();
		if (ops) {
			for (let i = 0; i < ops.length; i++) {
				ops[i].redo();
			}
			this._past.push(ops);
		}
	}

	clear(): void {
		this._past = [];
		this._future = [];
	}
}
