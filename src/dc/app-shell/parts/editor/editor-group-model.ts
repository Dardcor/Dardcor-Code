/**
 * Dardcor Code - List Model Of Active Open Tabs Inside Group
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { EditorInput } from './editor-input.js';

export interface IEditorGroupModelEvent {
	readonly input: EditorInput;
	readonly index: number;
}

export interface IEditorGroupModelMoveEvent {
	readonly input: EditorInput;
	readonly fromIndex: number;
	readonly toIndex: number;
}

export interface IEditorGroupModelOptions {
	readonly allowEmpty?: boolean;
}

export class EditorGroupModel extends Disposable {
	private readonly _inputs: EditorInput[] = [];
	private readonly _pinned = new Set<string>();
	private _activeIndex = -1;
	private readonly _options: IEditorGroupModelOptions;

	private readonly _onDidOpen = this._register(new Emitter<IEditorGroupModelEvent>());
	private readonly _onDidClose = this._register(new Emitter<IEditorGroupModelEvent>());
	private readonly _onDidChangeActive = this._register(new Emitter<IEditorGroupModelEvent | null>());
	private readonly _onDidMove = this._register(new Emitter<IEditorGroupModelMoveEvent>());
	private readonly _onDidChangePinned = this._register(new Emitter<IEditorGroupModelEvent>());
	private readonly _onDidChange = this._register(new Emitter<void>());

	readonly onDidOpen: Event<IEditorGroupModelEvent> = this._onDidOpen.event;
	readonly onDidClose: Event<IEditorGroupModelEvent> = this._onDidClose.event;
	readonly onDidChangeActive: Event<IEditorGroupModelEvent | null> = this._onDidChangeActive.event;
	readonly onDidMove: Event<IEditorGroupModelMoveEvent> = this._onDidMove.event;
	readonly onDidChangePinned: Event<IEditorGroupModelEvent> = this._onDidChangePinned.event;
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(options: IEditorGroupModelOptions = {}) {
		super();
		this._options = options;
	}

	get count(): number {
		return this._inputs.length;
	}

	get isEmpty(): boolean {
		return this._inputs.length === 0;
	}

	get activeInput(): EditorInput | null {
		return this._activeIndex >= 0 ? this._inputs[this._activeIndex] ?? null : null;
	}

	get activeIndex(): number {
		return this._activeIndex;
	}

	getEditors(): EditorInput[] {
		return [...this._inputs];
	}

	getEditor(index: number): EditorInput | undefined {
		return this._inputs[index];
	}

	indexOf(input: EditorInput): number {
		return this._inputs.findIndex(i => i.matches(input));
	}

	contains(input: EditorInput): boolean {
		return this.indexOf(input) !== -1;
	}

	isPinned(input: EditorInput): boolean {
		return this._pinned.has(input.toKey());
	}

	getPinnedCount(): number {
		return this._inputs.reduce((count, input) => count + (this.isPinned(input) ? 1 : 0), 0);
	}

	open(input: EditorInput, index?: number): void {
		const existing = this.indexOf(input);
		if (existing !== -1) {
			this.setActive(existing);
			return;
		}

		const pinnedCount = this.getPinnedCount();
		const insertAt = index !== undefined
			? Math.max(pinnedCount, Math.min(index, this._inputs.length))
			: this._inputs.length;
		this._inputs.splice(insertAt, 0, input);
		this._register(input);
		this._onDidOpen.fire({ input, index: insertAt });
		this._onDidChange.fire();
		this.setActive(insertAt);
	}

	close(input: EditorInput): boolean {
		const index = this.indexOf(input);
		if (index === -1) {
			return false;
		}
		this._inputs.splice(index, 1);
		this._pinned.delete(input.toKey());

		if (this._activeIndex === index) {
			const fallback = this._inputs[Math.min(index, this._inputs.length - 1)];
			this._activeIndex = fallback ? this._inputs.indexOf(fallback) : -1;
			this._onDidChangeActive.fire(
				this._activeIndex >= 0
					? { input: this._inputs[this._activeIndex], index: this._activeIndex }
					: null
			);
		} else if (this._activeIndex > index) {
			this._activeIndex--;
		}

		this._onDidClose.fire({ input, index });
		this._onDidChange.fire();
		if (this._options.allowEmpty !== false && this._inputs.length === 0) {
			this._activeIndex = -1;
		}
		return true;
	}

	closeRange(fromIndex: number, toIndex: number): EditorInput[] {
		const closed: EditorInput[] = [];
		for (let i = toIndex; i >= fromIndex; i--) {
			const input = this._inputs[i];
			if (input && this.close(input)) {
				closed.push(input);
			}
		}
		return closed;
	}

	closeAll(): EditorInput[] {
		const closed = [...this._inputs];
		for (const input of closed) {
			this.close(input);
		}
		return closed;
	}

	setActive(indexOrInput: number | EditorInput): void {
		const index = typeof indexOrInput === 'number'
			? indexOrInput
			: this.indexOf(indexOrInput);
		if (index < 0 || index >= this._inputs.length || index === this._activeIndex) {
			return;
		}
		this._activeIndex = index;
		this._onDidChangeActive.fire({ input: this._inputs[index], index });
		this._onDidChange.fire();
	}

	move(fromIndex: number, toIndex: number): void {
		if (fromIndex < 0 || fromIndex >= this._inputs.length) {
			return;
		}
		if (toIndex < 0 || toIndex >= this._inputs.length) {
			return;
		}
		if (fromIndex === toIndex) {
			return;
		}
		const pinnedCount = this.getPinnedCount();
		const input = this._inputs[fromIndex];
		const isPinned = this._pinned.has(input.toKey());
		if (!isPinned) {
			toIndex = Math.max(toIndex, pinnedCount);
		}
		this._inputs.splice(fromIndex, 1);
		this._inputs.splice(toIndex, 0, input);

		if (this._activeIndex === fromIndex) {
			this._activeIndex = toIndex;
		} else if (fromIndex < this._activeIndex && toIndex >= this._activeIndex) {
			this._activeIndex--;
		} else if (fromIndex > this._activeIndex && toIndex <= this._activeIndex) {
			this._activeIndex++;
		}

		this._onDidMove.fire({ input, fromIndex, toIndex });
		this._onDidChange.fire();
	}

	moveToPinned(input: EditorInput, pinned: boolean): void {
		const index = this.indexOf(input);
		if (index === -1) {
			return;
		}
		const wasPinned = this._pinned.has(input.toKey());
		if (wasPinned === pinned) {
			return;
		}
		if (pinned) {
			this._pinned.add(input.toKey());
			this.move(index, 0);
		} else {
			this._pinned.delete(input.toKey());
			this.move(index, this.getPinnedCount());
		}
		this._onDidChangePinned.fire({ input, index: this.indexOf(input) });
	}

	reorderToFront(input: EditorInput): void {
		const index = this.indexOf(input);
		if (index === -1) {
			return;
		}
		this.move(index, 0);
	}

	clear(): void {
		for (const input of [...this._inputs]) {
			this.close(input);
		}
		this._pinned.clear();
		this._activeIndex = -1;
		this._onDidChange.fire();
	}

	dispose(): void {
		this.clear();
		super.dispose();
	}
}
