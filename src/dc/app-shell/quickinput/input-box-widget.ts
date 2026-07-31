/**
 * Dardcor Code - Quick String Input Box Modal Dialog
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $ } from '../../core/dom/element.js';
import { ModalDialogHost } from '../dialogs/modal-dialog-host.js';

export interface IInputBoxOptions {
	title?: string;
	prompt?: string;
	value?: string;
	placeholder?: string;
	password?: boolean;
	validateInput?: (value: string) => string | null;
}

export class InputBoxWidget extends Disposable {
	private _root: HTMLElement | null = null;
	private _input: HTMLInputElement | null = null;
	private _messageEl: HTMLElement | null = null;
	private _options: IInputBoxOptions = {};
	private _validationError: string | null = null;

	private readonly _onDidAccept = this._register(new Emitter<string>());
	private readonly _onDidCancel = this._register(new Emitter<void>());
	private readonly _onDidChangeValue = this._register(new Emitter<string>());

	readonly onDidAccept: Event<string> = this._onDidAccept.event;
	readonly onDidCancel: Event<void> = this._onDidCancel.event;
	readonly onDidChangeValue: Event<string> = this._onDidChangeValue.event;

	constructor(private readonly _host: ModalDialogHost) {
		super();
	}

	get isOpen(): boolean {
		return this._root !== null;
	}

	getValue(): string {
		return this._input?.value ?? '';
	}

	open(options: IInputBoxOptions): void {
		this.close();
		this._options = options;
		this._validationError = null;

		this._root = $<HTMLElement>('div', 'dc-input-box');
		this._root.style.cssText = 'width:420px;max-width:90vw;background:#252526;display:flex;flex-direction:column;font-family:Segoe UI, sans-serif;font-size:13px;color:#cccccc;';

		if (options.prompt) {
			const promptEl = $<HTMLElement>('div', 'dc-input-box-prompt');
			promptEl.textContent = options.prompt;
			promptEl.style.cssText = 'padding:10px 14px;color:#cccccc;line-height:1.4;';
			this._root.appendChild(promptEl);
		}

		const inputRow = $<HTMLElement>('div', 'dc-input-box-row');
		inputRow.style.cssText = 'padding:0 14px 10px;';
		this._input = $<HTMLInputElement>('input', 'dc-input-box-input');
		this._input.style.cssText = 'width:100%;box-sizing:border-box;background:#3c3c3c;border:1px solid #3f3f46;color:#ffffff;padding:6px 8px;font-size:13px;outline:none;font-family:Segoe UI, sans-serif;';
		if (options.password) {
			this._input.type = 'password';
		}
		if (options.placeholder) {
			this._input.placeholder = options.placeholder;
		}
		this._input.value = options.value ?? '';
		inputRow.appendChild(this._input);
		this._root.appendChild(inputRow);

		this._messageEl = $<HTMLElement>('div', 'dc-input-box-message');
		this._messageEl.style.cssText = 'padding:0 14px 10px;font-size:12px;min-height:14px;';
		this._root.appendChild(this._messageEl);

		this._input.addEventListener('input', () => {
			this._validate(false);
			this._onDidChangeValue.fire(this._input!.value);
		});
		this._input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				if (!this._validationError) {
					const value = this._input!.value;
					this.close();
					this._onDidAccept.fire(value);
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this._onDidCancel.fire();
			}
		});

		this._host.open(this._root, { title: options.title ?? 'Input', clickOutsideToClose: true });
		requestAnimationFrame(() => {
			this._input?.focus();
			this._input?.select();
		});
	}

	close(): void {
		if (!this._root) {
			return;
		}
		this._root.remove();
		this._root = null;
		this._input = null;
		this._messageEl = null;
		this._host.close();
	}

	private _validate(showError: boolean): void {
		const validator = this._options.validateInput;
		if (!validator || !this._messageEl) {
			return;
		}
		this._validationError = validator(this._input?.value ?? '');
		if (this._validationError) {
			this._messageEl.textContent = this._validationError;
			this._messageEl.style.color = '#f48771';
		} else {
			this._messageEl.textContent = '';
		}
	}
}
