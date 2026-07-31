/**
 * Dardcor Code - Input Validation Warning & Error Message Box
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $ } from '../../core/dom/element';
import { IInputBoxOptions } from './input-box-widget';

export const enum InputValidationSeverity {
	INFO = 0,
	WARNING = 1,
	ERROR = 2,
}

export interface IInputValidationMessage {
	readonly severity: InputValidationSeverity;
	readonly message: string;
}

const SEVERITY_ICON: Record<InputValidationSeverity, string> = {
	[InputValidationSeverity.INFO]: '\u2139',
	[InputValidationSeverity.WARNING]: '\u26a0',
	[InputValidationSeverity.ERROR]: '\u2715',
};

const SEVERITY_COLOR: Record<InputValidationSeverity, string> = {
	[InputValidationSeverity.INFO]: '#75beff',
	[InputValidationSeverity.WARNING]: '#cca700',
	[InputValidationSeverity.ERROR]: '#f48771',
};

export class InputBoxValidationMessage implements IInputValidationMessage {
	constructor(
		public readonly severity: InputValidationSeverity,
		public readonly message: string
	) {}

	get isError(): boolean {
		return this.severity === InputValidationSeverity.ERROR;
	}

	get isWarning(): boolean {
		return this.severity === InputValidationSeverity.WARNING;
	}
}

export type InputValidator = (value: string) => IInputValidationMessage | null;

export class InputBoxValidation extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _messageEl: HTMLElement;
	private readonly _iconEl: HTMLElement;
	private _current: IInputValidationMessage | null = null;

	private readonly _onDidChangeValidation = this._register(new Emitter<IInputValidationMessage | null>());
	readonly onDidChangeValidation: Event<IInputValidationMessage | null> = this._onDidChangeValidation.event;

	constructor(
		parent: HTMLElement,
		private readonly _input: HTMLInputElement,
		private _validator: InputValidator | null = null
	) {

		super();
		this._container = $<HTMLElement>('div', 'dc-input-validation');
		this._container.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:0 14px 10px;font-size:12px;min-height:16px;line-height:1.4;';
		this._iconEl = $<HTMLElement>('span', 'dc-input-validation-icon');
		this._iconEl.style.cssText = 'flex-shrink:0;width:14px;text-align:center;';
		this._messageEl = $<HTMLElement>('span', 'dc-input-validation-message');
		this._messageEl.style.cssText = 'flex:1;word-break:break-word;';
		this._container.appendChild(this._iconEl);
		this._container.appendChild(this._messageEl);
		parent.appendChild(this._container);

		this._input.addEventListener('input', () => this.validate());
		this._input.addEventListener('focus', () => this.validate());
	}

	get element(): HTMLElement {
		return this._container;
	}

	get current(): IInputValidationMessage | null {
		return this._current;
	}

	get isValid(): boolean {
		return this._current === null;
	}

	setValidator(validator: InputValidator | null): void {
		this._validator = validator;
		this.validate();
	}

	validate(): IInputValidationMessage | null {
		this._current = null;
		if (this._validator) {
			this._current = this._validator(this._input.value);
		}
		this._render();
		this._onDidChangeValidation.fire(this._current);
		return this._current;
	}

	clear(): void {
		this._current = null;
		this._render();
		this._onDidChangeValidation.fire(null);
	}

	showMessage(message: IInputValidationMessage): void {
		this._current = message;
		this._render();
		this._onDidChangeValidation.fire(this._current);
	}

	private _render(): void {
		if (!this._current) {
			this._container.style.display = 'none';
			return;
		}
		this._container.style.display = 'flex';
		this._iconEl.textContent = SEVERITY_ICON[this._current.severity];
		this._iconEl.style.color = SEVERITY_COLOR[this._current.severity];
		this._messageEl.textContent = this._current.message;
		this._messageEl.style.color = SEVERITY_COLOR[this._current.severity];
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}

export namespace InputValidation {
	export function error(message: string): IInputValidationMessage {
		return { severity: InputValidationSeverity.ERROR, message };
	}

	export function warning(message: string): IInputValidationMessage {
		return { severity: InputValidationSeverity.WARNING, message };
	}

	export function info(message: string): IInputValidationMessage {
		return { severity: InputValidationSeverity.INFO, message };
	}

	export function isError(message: IInputValidationMessage | null): message is IInputValidationMessage {
		return message !== null && message.severity === InputValidationSeverity.ERROR;
	}

	export function required(fieldName: string): InputValidator {
		return value => (value.trim().length === 0 ? error(`${fieldName} is required`) : null);
	}

	export function minLength(length: number, message?: string): InputValidator {
		return value => (value.length < length ? error(message ?? `Must be at least ${length} characters`) : null);
	}

	export function regex(pattern: RegExp, message: string): InputValidator {
		return value => (pattern.test(value) ? null : error(message));
	}
}

export function toInputBoxOptions(validator: InputValidator): Pick<IInputBoxOptions, 'validateInput'> {
	return {
		validateInput: value => {
			const result = validator(value);
			return result ? result.message : null;
		},
	};
}
