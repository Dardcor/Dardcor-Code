import { Disposable } from './lifecycle.js';
import { Emitter, Event } from './event.js';

export interface IAction {
	readonly id: string;
	label: string;
	tooltip: string;
	class: string | undefined;
	enabled: boolean;
	checked?: boolean;
	run(event?: any): Promise<void>;
}

export class Action extends Disposable implements IAction {
	public readonly id: string;
	public label: string;
	public tooltip: string;
	public class: string | undefined;
	private _enabled = true;
	private _checked = false;

	private readonly _onDidChange = this._register(new Emitter<any>());
	public readonly onDidChange: Event<any> = this._onDidChange.event;

	constructor(id: string, label: string = '', cssClass: string = '', enabled: boolean = true, actionCallback?: (event?: any) => Promise<void>) {
		super();
		this.id = id;
		this.label = label;
		this.tooltip = label;
		this.class = cssClass;
		this._enabled = enabled;
		if (actionCallback) {
			this._actionCallback = actionCallback;
		}
	}

	private _actionCallback?: (event?: any) => Promise<void>;

	public get enabled(): boolean {
		return this._enabled;
	}

	public set enabled(value: boolean) {
		if (this._enabled !== value) {
			this._enabled = value;
			this._onDidChange.fire({ enabled: value });
		}
	}

	public get checked(): boolean {
		return this._checked;
	}

	public set checked(value: boolean) {
		if (this._checked !== value) {
			this._checked = value;
			this._onDidChange.fire({ checked: value });
		}
	}

	public async run(event?: any): Promise<void> {
		if (this._actionCallback) {
			await this._actionCallback(event);
		}
	}
}

export class ActionRunner extends Disposable {
	private readonly _onBeforeRun = this._register(new Emitter<any>());
	public readonly onBeforeRun: Event<any> = this._onBeforeRun.event;

	private readonly _onDidRun = this._register(new Emitter<any>());
	public readonly onDidRun: Event<any> = this._onDidRun.event;

	public async run(action: IAction, context?: any): Promise<void> {
		if (!action.enabled) {
			return;
		}
		this._onBeforeRun.fire({ action, context });
		try {
			await action.run(context);
			this._onDidRun.fire({ action, context });
		} catch (error) {
			this._onDidRun.fire({ action, context, error });
			throw error;
		}
	}
}

export function toAction(options: { id: string; label: string; run: (event?: any) => Promise<void> | void }): IAction {
	return new Action(options.id, options.label, '', true, async (e) => options.run(e));
}
