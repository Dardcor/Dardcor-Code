/**
 * Dardcor Code - Inline File Tree Node Editing Text Input Element
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $ } from '../../core/dom/element';
import { Path } from '../../core/types/path';

export interface IFileRenameCommitEvent {
	readonly value: string;
	readonly wasCancelled: boolean;
}

export class FileRenameInput extends Disposable {
	private readonly _onDidCommit = this._register(new Emitter<IFileRenameCommitEvent>());
	readonly onDidCommit: Event<IFileRenameCommitEvent> = this._onDidCommit.event;

	private readonly _input: HTMLInputElement;
	private _active = false;

	constructor() {
		super();
		this._input = $<HTMLInputElement>('input', 'dc-file-rename-input');
		this._input.style.cssText = 'background:#3c3c3c;border:1px solid #007fd4;color:#ffffff;font-size:13px;padding:1px 4px;outline:none;width:100%;box-sizing:border-box;border-radius:2px;';
		this._input.spellcheck = false;
		this._input.addEventListener('keydown', (e) => this._onKeyDown(e));
		this._input.addEventListener('blur', () => {
			if (this._active) {
				this.commit();
			}
		});
	}

	get input(): HTMLInputElement {
		return this._input;
	}

	get isActive(): boolean {
		return this._active;
	}

	public open(anchor: HTMLElement, initialValue: string, selectBasename = false): void {
		if (this._active) {
			this.cancel();
		}
		this._active = true;
		this._input.value = initialValue;
		anchor.replaceWith(this._input);
		this._input.focus();
		if (selectBasename) {
			const ext = Path.extname(initialValue);
			const name = ext ? initialValue.substring(0, initialValue.length - ext.length) : initialValue;
			this._input.setSelectionRange(0, name.length);
		} else {
			this._input.select();
		}
	}

	public cancel(): void {
		if (!this._active) {
			return;
		}
		this._active = false;
		this._onDidCommit.fire({ value: this._input.value, wasCancelled: true });
		this._restore();
	}

	public commit(): void {
		if (!this._active) {
			return;
		}
		this._active = false;
		this._onDidCommit.fire({ value: this._input.value, wasCancelled: false });
		this._restore();
	}

	private _onKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			this.commit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			this.cancel();
		}
	}

	private _restore(): void {
		this._input.remove();
	}

	public dispose(): void {
		this._restore();
		super.dispose();
	}
}
