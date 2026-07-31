import { Widget } from '../widget';
import { Emitter, Event } from '../../../common/event';

export interface IButtonStyles {
	buttonBackground?: string;
	buttonForeground?: string;
	buttonBorder?: string;
}

export interface IButton {
	element: HTMLElement;
	label: string;
	enabled: boolean;
	focus(): void;
	onDidClick: Event<void>;
}

export enum ButtonBarAlignment {
	LEFT = 0,
	RIGHT = 1
}

export interface IButtonWithDropdownOptions {
	title?: string;
	actions?: any[];
	dropdownLayer?: number;
}

export class Button extends Widget implements IButton {
	public readonly element: HTMLElement;
	private _label = '';
	private _enabled = true;

	private readonly _onDidClick = this._register(new Emitter<void>());
	public readonly onDidClick: Event<void> = this._onDidClick.event;

	constructor(container: HTMLElement, options?: any) {
		super();
		this.element = document.createElement('button');
		this.element.className = 'monaco-button';
		this.onclick(this.element, () => {
			if (this._enabled) {
				this._onDidClick.fire();
			}
		});
		if (container) {
			container.appendChild(this.element);
		}
	}

	public get label(): string {
		return this._label;
	}

	public set label(value: string) {
		this._label = value;
		this.element.textContent = value;
	}

	public get enabled(): boolean {
		return this._enabled;
	}

	public set enabled(value: boolean) {
		this._enabled = value;
		(this.element as HTMLButtonElement).disabled = !value;
	}

	public focus(): void {
		this.element.focus();
	}

	public hasFocus(): boolean {
		return document.activeElement === this.element;
	}
}

export class ButtonBar extends Widget {
	public readonly element: HTMLElement;
	private _buttons: Button[] = [];

	constructor(container: HTMLElement, options?: { alignment?: ButtonBarAlignment }) {
		super();
		this.element = document.createElement('div');
		this.element.className = 'monaco-button-bar';
		if (container) {
			container.appendChild(this.element);
		}
	}

	public addButton(options?: any): Button {
		const btn = this._register(new Button(this.element, options));
		this._buttons.push(btn);
		return btn;
	}

	public addButtonWithDropdown(options?: IButtonWithDropdownOptions): ButtonWithDropdown {
		const btn = this._register(new ButtonWithDropdown(this.element, options));
		this._buttons.push(btn);
		return btn;
	}

	public addButtonWithDescription(options?: any): ButtonWithDescription {
		const btn = this._register(new ButtonWithDescription(this.element, options));
		this._buttons.push(btn);
		return btn;
	}

	public get buttons(): Button[] {
		return this._buttons;
	}
}

export class ButtonWithDescription extends Button {
	public description: string = '';
	constructor(container: HTMLElement, options?: any) {
		super(container, options);
	}
}

export class ButtonWithDropdown extends Button {
	public primaryButton: Button = this;
	public dropdownButton: Button = this;
	constructor(container: HTMLElement, options?: IButtonWithDropdownOptions) {
		super(container, options);
	}
}
