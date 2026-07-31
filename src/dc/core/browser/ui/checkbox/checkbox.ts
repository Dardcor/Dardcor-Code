import { Widget } from '../widget.js';
import { Emitter, Event } from '../../../common/event.js';
import { IKeyboardEvent } from '../../keyboardEvent.js';

export interface IToggleStyles {
	inputActiveOptionBorder?: string;
	inputActiveOptionForeground?: string;
	inputActiveOptionBackground?: string;
}

export interface ICheckboxStyles extends IToggleStyles {
	checkboxBackground?: string;
	checkboxBorder?: string;
	checkboxForeground?: string;
}

export interface IToggleOpts {
	icon?: any;
	title: string;
	isChecked: boolean;
	styles?: IToggleStyles;
}

export class Toggle extends Widget {
	public readonly domNode: HTMLElement;
	private _checked: boolean;
	private _enabled = true;

	private readonly _onChange = this._register(new Emitter<boolean>());
	public readonly onChange: Event<boolean> = this._onChange.event;

	private readonly _onKeyDown = this._register(new Emitter<IKeyboardEvent>());
	public readonly onKeyDown: Event<IKeyboardEvent> = this._onKeyDown.event;

	constructor(opts: IToggleOpts) {
		super();
		this._checked = opts.isChecked;
		this.domNode = document.createElement('div');
		this.domNode.className = 'monaco-custom-toggle';
		this.domNode.title = opts.title;
	}

	public get checked(): boolean {
		return this._checked;
	}

	public set checked(newIsChecked: boolean) {
		if (this._checked !== newIsChecked) {
			this._checked = newIsChecked;
			this._onChange.fire(this._checked);
		}
	}

	public enable(): void {
		this._enabled = true;
	}

	public disable(): void {
		this._enabled = false;
	}

	public width(): number {
		return this.domNode.offsetWidth || 20;
	}

	public focus(): void {
		this.domNode.focus();
	}
}

export class Checkbox extends Widget {
	public readonly domNode: HTMLElement;
	public checked = false;
	public value = '';

	constructor(actionClassName: string, title: string, isChecked: boolean, styles?: ICheckboxStyles) {
		super();
		this.checked = isChecked;
		this.domNode = document.createElement('input');
		(this.domNode as HTMLInputElement).type = 'checkbox';
		(this.domNode as HTMLInputElement).checked = isChecked;
		this.domNode.title = title;
	}

	public focus(): void {
		this.domNode.focus();
	}
}
