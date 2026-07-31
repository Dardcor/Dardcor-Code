/**
 * Dardcor Code - Quick Input Service Modal Host
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { createDecorator } from '../../services/instantiation/annotations';
import { ModalDialogHost } from '../dialogs/modal-dialog-host';
import { QuickPickWidget, IQuickPickOptions } from './quick-pick-widget';
import { InputBoxWidget, IInputBoxOptions } from './input-box-widget';
import { QuickPickItem } from './quick-pick-item';

export const IQuickInputService = createDecorator<IQuickInputService>('quickInputService');

export interface IPickOptions {
	title?: string;
	placeholder?: string;
}

export interface IQuickPickWithItems<T extends QuickPickItem> extends IQuickPickOptions {
	items: T[] | Promise<T[]>;
}

export interface IQuickInputService {
	readonly _serviceBrand: undefined;
	openQuickPick<T extends QuickPickItem>(options: IQuickPickWithItems<T>): Promise<T | undefined>;
	input(options: IInputBoxOptions): Promise<string | undefined>;
	pick<T extends QuickPickItem>(items: T[] | Promise<T[]>, options?: IPickOptions): Promise<T | undefined>;
}

export class QuickInputService extends Disposable implements IQuickInputService {
	declare readonly _serviceBrand: undefined;

	private readonly _host: ModalDialogHost;
	private _activeWidget: Disposable | null = null;

	constructor(parent: HTMLElement = document.body) {
		super();
		this._host = new ModalDialogHost(parent);
		this._register(this._host);
	}

	async openQuickPick<T extends QuickPickItem>(options: IQuickPickWithItems<T>): Promise<T | undefined> {
		this._closeActive();

		const widget = new QuickPickWidget(this._host);
		this._activeWidget = widget;
		void widget.open(options);
		return new Promise<T | undefined>(resolve => {
			widget.onDidAccept(item => {
				this._clearActive(widget);
				widget.close();
				resolve(item as T);
			});
			widget.onDidCancel(() => {
				this._clearActive(widget);
				widget.close();
				resolve(undefined);
			});
		});
	}

	async pick<T extends QuickPickItem>(items: T[] | Promise<T[]>, options?: IPickOptions): Promise<T | undefined> {
		return this.openQuickPick<T>({
			title: options?.title,
			placeholder: options?.placeholder,
			items,
		});
	}


	input(options: IInputBoxOptions): Promise<string | undefined> {
		this._closeActive();
		const widget = new InputBoxWidget(this._host);
		this._activeWidget = widget;
		widget.open(options);
		return new Promise<string | undefined>(resolve => {
			widget.onDidAccept(value => {
				this._clearActive(widget);
				resolve(value);
			});
			widget.onDidCancel(() => {
				this._clearActive(widget);
				resolve(undefined);
			});
		});
	}

	private _closeActive(): void {
		if (this._activeWidget) {
			this._activeWidget.dispose();
			this._activeWidget = null;
		}
		this._host.close();
	}

	private _clearActive(widget: Disposable): void {
		if (this._activeWidget === widget) {
			this._activeWidget = null;
		}
	}
}
