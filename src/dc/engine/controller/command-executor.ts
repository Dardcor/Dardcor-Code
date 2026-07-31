/**
 * Dardcor Code - Editor Edit Transaction Runner (Task 237)
 * Mirrors: vs/editor/common/model/editStack.ts + vs/editor/common/editorCommon.ts (IEditOperation)
 */

import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { ITextModel } from '../model/text-model';
import { EditStack, IEditOperation } from '../model/edit-stack';
import { IRange } from '../model/text-model';

export interface IEditCommand {
	readonly id: string;
	execute(...args: any[]): void;
}

export interface ICommandExecutionEvent {
	readonly commandId: string;
	readonly args: readonly any[];
}

export interface IEditTransaction {
	begin(): void;
	commit(): void;
	rollback(): void;
}

export class CommandExecutor extends Disposable {
	private readonly _editStack: EditStack;
	private _transactions = 0;

	private readonly _onWillExecuteCommand = this._register(new Emitter<ICommandExecutionEvent>());
	readonly onWillExecuteCommand: Event<ICommandExecutionEvent> = this._onWillExecuteCommand.event;

	private readonly _onDidExecuteCommand = this._register(new Emitter<ICommandExecutionEvent>());
	readonly onDidExecuteCommand: Event<ICommandExecutionEvent> = this._onDidExecuteCommand.event;

	constructor(private readonly _model: ITextModel, editStack?: EditStack) {
		super();
		this._editStack = editStack ?? new EditStack();
	}

	public executeEdits(source: string, operations: readonly IEditOperation[]): boolean {
		if (operations.length === 0) {
			return false;
		}
		this._transactions++;
		try {
			for (const op of operations) {
				op.redo();
			}
		} catch (err) {
			this._transactions--;
			for (let i = operations.length - 1; i >= 0; i--) {
				operations[i].undo();
			}
			throw err;
		}
		this._transactions--;
		this._editStack.push([...operations]);
		return true;
	}

	public executeCommand(command: IEditCommand, ...args: any[]): void {
		this._onWillExecuteCommand.fire({ commandId: command.id, args });
		command.execute(...args);
		this._onDidExecuteCommand.fire({ commandId: command.id, args });
	}

	public pushUndoStop(): void {
		this._editStack.push([]);
	}

	public undo(): boolean {
		if (!this._editStack.canUndo()) {
			return false;
		}
		this._editStack.undo();
		return true;
	}

	public redo(): boolean {
		if (!this._editStack.canRedo()) {
			return false;
		}
		this._editStack.redo();
		return true;
	}

	public canUndo(): boolean {
		return this._editStack.canUndo();
	}

	public canRedo(): boolean {
		return this._editStack.canRedo();
	}

	public clearHistory(): void {
		this._editStack.clear();
	}

	public getModel(): ITextModel {
		return this._model;
	}

	public createTransaction(): IEditTransaction {
		return new EditTransaction(this);
	}

	public isInTransaction(): boolean {
		return this._transactions > 0;
	}

	public replaceRange(range: IRange, text: string): void {
		const value = this._model.getValue();
		const lines = value.split(/\r?\n/);
		const startOffset = this._offsetAt(lines, range.startLineNumber, range.startColumn);
		const endOffset = this._offsetAt(lines, range.endLineNumber, range.endColumn);
		this._model.setValue(value.substring(0, startOffset) + text + value.substring(endOffset));
	}

	private _offsetAt(lines: string[], lineNumber: number, column: number): number {
		let offset = 0;
		for (let i = 1; i < lineNumber; i++) {
			offset += (lines[i - 1] || '').length + 1;
		}
		return offset + (column - 1);
	}
}

class EditTransaction implements IEditTransaction {
	private _committed = false;

	constructor(private readonly _executor: CommandExecutor) {
		this._executor['_transactions']++;
	}

	public begin(): void {
		// transaction already active
	}

	public commit(): void {
		if (this._committed) {
			return;
		}
		this._committed = true;
		this._executor['_transactions']--;
		this._executor.pushUndoStop();
	}

	public rollback(): void {
		if (this._committed) {
			return;
		}
		this._committed = true;
		this._executor['_transactions']--;
	}
}
