/**
 * Dardcor Code - Reopen Closed Editor Stack Command Handler (Ctrl+Shift+T)
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { URI } from '../../../core/types/uri';
import { CommandRegistry } from '../../../services/commands/command-service';
import { EditorInput, FileEditorInput } from './editor-input';
import { EditorPart } from './editor-part';

export interface IReopenEntry {
	readonly uri: URI;
	readonly name: string;
	readonly contentSnapshot: string;
	readonly closedAt: number;
	readonly original: EditorInput;
}

export interface IEditorReopenClosedOptions {
	readonly maxStackSize?: number;
	readonly rememberContent?: boolean;
}

export class EditorReopenClosed extends Disposable {
	private readonly _stack: IReopenEntry[] = [];
	private readonly _maxStackSize: number;
	private readonly _rememberContent: boolean;
	private readonly _editorPart: EditorPart | null;

	private readonly _onDidReopen = this._register(new Emitter<IReopenEntry>());
	readonly onDidReopen: Event<IReopenEntry> = this._onDidReopen.event;

	private readonly _onDidPush = this._register(new Emitter<IReopenEntry>());
	readonly onDidPush: Event<IReopenEntry> = this._onDidPush.event;

	constructor(
		editorPart: EditorPart | null = null,
		options: IEditorReopenClosedOptions = {}
	) {
		super();
		this._editorPart = editorPart;
		this._maxStackSize = options.maxStackSize ?? 20;
		this._rememberContent = options.rememberContent ?? true;

		if (editorPart) {
			this._register(editorPart.onDidCloseEditor(e => this.push(e.input)));
		}

		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.reopenClosedEditor',
			handler: () => this.reopen(),
		}));
	}

	get stackSize(): number {
		return this._stack.length;
	}

	get isEmpty(): boolean {
		return this._stack.length === 0;
	}

	getNextEntry(): IReopenEntry | null {
		return this._stack[this._stack.length - 1] ?? null;
	}

	peek(): IReopenEntry | null {
		return this.getNextEntry();
	}

	push(input: EditorInput): void {
		const entry: IReopenEntry = {
			uri: input.uri,
			name: input.getName(),
			contentSnapshot: this._rememberContent ? (input.getTextModel()?.getValue() ?? '') : '',
			closedAt: Date.now(),
			original: input,
		};
		const existingIdx = this._stack.findIndex(e => e.uri.toString() === entry.uri.toString());
		if (existingIdx !== -1) {
			this._stack.splice(existingIdx, 1);
		}
		this._stack.push(entry);
		while (this._stack.length > this._maxStackSize) {
			this._stack.shift();
		}
		this._onDidPush.fire(entry);
	}

	reopen(): IReopenEntry | null {
		const entry = this._stack.pop();
		if (!entry) {
			return null;
		}
		this._onDidReopen.fire(entry);
		if (this._editorPart) {
			const input = new FileEditorInput(entry.uri, entry.contentSnapshot);
			this._editorPart.openEditor(input);
		}
		return entry;
	}

	reopenAll(): IReopenEntry[] {
		const entries: IReopenEntry[] = [];
		while (this._stack.length > 0) {
			const entry = this.reopen();
			if (entry) {
				entries.push(entry);
			}
		}
		return entries;
	}

	remove(uri: URI): void {
		const key = uri.toString();
		for (let i = this._stack.length - 1; i >= 0; i--) {
			if (this._stack[i].uri.toString() === key) {
				this._stack.splice(i, 1);
			}
		}
	}

	clear(): void {
		this._stack.length = 0;
	}

	getStack(): IReopenEntry[] {
		return [...this._stack];
	}

	dispose(): void {
		this.clear();
		super.dispose();
	}
}
