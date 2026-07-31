/**
 * Dardcor Code - Typed Settings Input Widgets (Boolean/Enum/Number/String/List)
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';

export type SettingWidgetType = 'boolean' | 'enum' | 'number' | 'string' | 'array' | 'color';

export interface ISettingWidgetOptions {
	readonly type: SettingWidgetType;
	readonly value: unknown;
	readonly enumOptions?: string[];
	readonly placeholder?: string;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
}

export class SettingsWidget extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<unknown>());
	readonly onDidChange: Event<unknown> = this._onDidChange.event;

	private readonly _container: HTMLElement;
	private readonly _options: ISettingWidgetOptions;
	private _value: unknown;

	constructor(parentDom: HTMLElement, options: ISettingWidgetOptions) {
		super();
		this._options = options;
		this._value = options.value;
		this._container = $<HTMLElement>('div', 'dc-settings-widget');
		this._container.style.cssText = 'display:flex;align-items:center;';
		this._build();
		parentDom.appendChild(this._container);
	}

	get value(): unknown {
		return this._value;
	}

	set value(v: unknown) {
		this._value = v;
		this._syncWidget();
	}

	public getType(): SettingWidgetType {
		return this._options.type;
	}

	private _build(): void {
		const { type } = this._options;
		if (type === 'boolean') {
			const input = $<HTMLInputElement>('input');
			input.type = 'checkbox';
			input.checked = Boolean(this._value);
			this._register(addDisposableListener(input, 'change', () => {
				this._value = input.checked;
				this._onDidChange.fire(this._value);
			}));
			this._container.appendChild(input);
		} else if (type === 'enum') {
			const select = $<HTMLSelectElement>('select');
			select.style.cssText = 'background:#3c3c3c;border:none;color:#cccccc;border-radius:2px;padding:3px 8px;font-size:13px;outline:none;cursor:pointer;';
			for (const option of this._options.enumOptions ?? []) {
				const opt = $<HTMLOptionElement>('option');
				opt.value = option;
				opt.textContent = option;
				opt.selected = String(this._value) === option;
				select.appendChild(opt);
			}
			this._register(addDisposableListener(select, 'change', () => {
				this._value = select.value;
				this._onDidChange.fire(this._value);
			}));
			this._container.appendChild(select);
		} else if (type === 'number') {
			const input = $<HTMLInputElement>('input');
			input.type = 'number';
			input.value = String(this._value ?? 0);
			input.min = String(this._options.min ?? '');
			input.max = String(this._options.max ?? '');
			input.step = String(this._options.step ?? '1');
			input.style.cssText = 'background:#3c3c3c;border:none;color:#cccccc;border-radius:2px;padding:3px 8px;font-size:13px;width:90px;outline:none;';
			this._register(addDisposableListener(input, 'change', () => {
				const parsed = Number(input.value);
				this._value = Number.isFinite(parsed) ? parsed : 0;
				this._onDidChange.fire(this._value);
			}));
			this._container.appendChild(input);
		} else if (type === 'color') {
			const input = $<HTMLInputElement>('input');
			input.type = 'color';
			input.value = String(this._value ?? '#000000');
			input.style.cssText = 'border:none;background:transparent;cursor:pointer;width:32px;height:24px;padding:0;';
			this._register(addDisposableListener(input, 'input', () => {
				this._value = input.value;
				this._onDidChange.fire(this._value);
			}));
			this._container.appendChild(input);
		} else {
			const input = $<HTMLInputElement>('input');
			input.type = 'text';
			input.value = type === 'array' ? String(this._value ?? '') : String(this._value ?? '');
			input.placeholder = this._options.placeholder ?? '';
			input.style.cssText = 'background:#3c3c3c;border:none;color:#cccccc;border-radius:2px;padding:3px 8px;font-size:13px;flex:1;min-width:140px;outline:none;';
			this._register(addDisposableListener(input, 'change', () => {
				this._value = type === 'array'
					? input.value.split(',').map(p => p.trim()).filter(p => !!p)
					: input.value;
				this._onDidChange.fire(this._value);
			}));
			this._container.appendChild(input);
		}
	}

	private _syncWidget(): void {
		const input = this._container.querySelector('input') ?? this._container.querySelector('select');
		if (!input) {
			return;
		}
		const { type } = this._options;
		if (type === 'boolean' && input instanceof HTMLInputElement) {
			input.checked = Boolean(this._value);
		} else if (type === 'number' && input instanceof HTMLInputElement) {
			input.value = String(this._value ?? 0);
		} else if (type === 'color' && input instanceof HTMLInputElement) {
			input.value = String(this._value ?? '#000000');
		} else if (type === 'enum' && input instanceof HTMLSelectElement) {
			input.value = String(this._value);
		} else if (input instanceof HTMLInputElement) {
			input.value = type === 'array'
				? (Array.isArray(this._value) ? this._value.join(', ') : String(this._value ?? ''))
				: String(this._value ?? '');
		}
	}
}

export function createSettingsWidget(parentDom: HTMLElement, options: ISettingWidgetOptions): SettingsWidget {
	return new SettingsWidget(parentDom, options);
}

export function settingsWidgetForType(value: unknown): SettingWidgetType {
	if (typeof value === 'boolean') {
		return 'boolean';
	}
	if (typeof value === 'number') {
		return 'number';
	}
	if (Array.isArray(value)) {
		return 'array';
	}
	if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
		return 'color';
	}
	return 'string';
}
