/**
 * Dardcor Code - Global Undo/Redo Edit Stack Service (Task 131)
 */

import { createDecorator } from '../instantiation/annotations';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { URI } from '../../core/types/uri';

export interface IUndoRedoElement {
	readonly uri: URI;
	readonly label: string;
	readonly source?: string;
	undo(): void | Promise<void>;
	redo(): void | Promise<void>;
}

export interface IPushElementOptions {
	readonly merge?: boolean;
	readonly source?: string;
}

export interface IUndoRedoService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeUndoRedoStacks: Event<void>;
	pushElement(element: IUndoRedoElement, options?: IPushElementOptions): void;
	undo(resource: URI): Promise<void>;
	redo(resource: URI): Promise<void>;
	hasUndo(resource: URI): boolean;
	hasRedo(resource: URI): boolean;
	getUndoStackSize(resource: URI): number;
	getRedoStackSize(resource: URI): number;
	clearResources(resources: readonly URI[]): void;
}

export const IUndoRedoService = createDecorator<IUndoRedoService>('undoRedoService');

const MAX_STACK_SIZE = 200;

class UndoRedoStack {
	private readonly _undoStack: IUndoRedoElement[] = [];
	private readonly _redoStack: IUndoRedoElement[] = [];

	public push(element: IUndoRedoElement, merge: boolean): void {
		const last = this._undoStack[this._undoStack.length - 1];
		if (merge && last && last.uri.toString() === element.uri.toString() && last.label === element.label) {
			this._undoStack[this._undoStack.length - 1] = element;
		} else {
			this._undoStack.push(element);
			if (this._undoStack.length > MAX_STACK_SIZE) {
				this._undoStack.shift();
			}
		}
		this._redoStack.length = 0;
	}

	public async undo(): Promise<boolean> {
		const element = this._undoStack.pop();
		if (!element) {
			return false;
		}
		this._redoStack.push(element);
		await element.undo();
		return true;
	}

	public async redo(): Promise<boolean> {
		const element = this._redoStack.pop();
		if (!element) {
			return false;
		}
		this._undoStack.push(element);
		await element.redo();
		return true;
	}

	public hasUndo(): boolean {
		return this._undoStack.length > 0;
	}

	public hasRedo(): boolean {
		return this._redoStack.length > 0;
	}

	public getUndoStackSize(): number {
		return this._undoStack.length;
	}

	public getRedoStackSize(): number {
		return this._redoStack.length;
	}

	public clear(): void {
		this._undoStack.length = 0;
		this._redoStack.length = 0;
	}
}

export class UndoRedoService extends Disposable implements IUndoRedoService {
	declare readonly _serviceBrand: undefined;

	private readonly _stacks = new Map<string, UndoRedoStack>();

	private readonly _onDidChangeUndoRedoStacks = this._register(new Emitter<void>());
	readonly onDidChangeUndoRedoStacks = this._onDidChangeUndoRedoStacks.event;

	public pushElement(element: IUndoRedoElement, options?: IPushElementOptions): void {
		const key = this._keyFor(element.uri);
		let stack = this._stacks.get(key);
		if (!stack) {
			stack = new UndoRedoStack();
			this._stacks.set(key, stack);
		}
		stack.push(element, options?.merge === true);
		this._onDidChangeUndoRedoStacks.fire();
	}

	public async undo(resource: URI): Promise<void> {
		const stack = this._stacks.get(this._keyFor(resource));
		if (!stack) {
			return;
		}
		await stack.undo();
		this._onDidChangeUndoRedoStacks.fire();
	}

	public async redo(resource: URI): Promise<void> {
		const stack = this._stacks.get(this._keyFor(resource));
		if (!stack) {
			return;
		}
		await stack.redo();
		this._onDidChangeUndoRedoStacks.fire();
	}

	public hasUndo(resource: URI): boolean {
		return this._stacks.get(this._keyFor(resource))?.hasUndo() ?? false;
	}

	public hasRedo(resource: URI): boolean {
		return this._stacks.get(this._keyFor(resource))?.hasRedo() ?? false;
	}

	public getUndoStackSize(resource: URI): number {
		return this._stacks.get(this._keyFor(resource))?.getUndoStackSize() ?? 0;
	}

	public getRedoStackSize(resource: URI): number {
		return this._stacks.get(this._keyFor(resource))?.getRedoStackSize() ?? 0;
	}

	public clearResources(resources: readonly URI[]): void {
		let changed = false;
		for (const resource of resources) {
			changed = this._stacks.delete(this._keyFor(resource)) || changed;
		}
		if (changed) {
			this._onDidChangeUndoRedoStacks.fire();
		}
	}

	private _keyFor(resource: URI): string {
		return resource.toString();
	}
}
