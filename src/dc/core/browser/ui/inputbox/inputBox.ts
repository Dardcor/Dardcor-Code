import { Widget } from '../widget.js';
import { IContextViewProvider } from '../contextview/contextview.js';
import { IHistory } from '../../../common/history.js';

export interface IInputBoxStyles {
	inputBackground?: string;
	inputForeground?: string;
	inputBorder?: string;
}

export interface IMessage {
	content: string;
	type?: number;
}

export type IInputValidator = (value: string) => IMessage | null;

export interface IInputOptions {
	placeholder?: string;
	ariaLabel?: string;
	validation?: IInputValidator;
	inputBoxStyles?: IInputBoxStyles;
	history?: IHistory<string>;
	showHistoryHint?: () => boolean;
	flexibleHeight?: boolean;
	flexibleWidth?: boolean;
	flexibleMaxHeight?: number;
	actions?: any[];
}

export class InputBox extends Widget {
	public readonly element: HTMLElement;
	public readonly inputElement: HTMLInputElement;
	public checked = false;

	constructor(parent: HTMLElement, contextViewProvider?: IContextViewProvider, options?: IInputOptions) {
		super();
		this.element = document.createElement('div');
		this.element.className = 'monaco-inputbox';
		this.inputElement = document.createElement('input');
		this.inputElement.className = 'input';
		if (options?.placeholder) {
			this.inputElement.placeholder = options.placeholder;
		}
		this.element.appendChild(this.inputElement);
		if (parent) {
			parent.appendChild(this.element);
		}
	}

	public get value(): string {
		return this.inputElement.value;
	}

	public set value(newValue: string) {
		this.inputElement.value = newValue;
	}

	public focus(): void {
		this.inputElement.focus();
	}

	public select(): void {
		this.inputElement.select();
	}

	public hasFocus(): boolean {
		return document.activeElement === this.inputElement;
	}

	public enable(): void {
		this.inputElement.disabled = false;
	}

	public disable(): void {
		this.inputElement.disabled = true;
	}
}

export class HistoryInputBox extends InputBox {
	constructor(parent: HTMLElement, contextViewProvider?: IContextViewProvider, options?: IInputOptions) {
		super(parent, contextViewProvider, options);
	}
}
