/**
 * Dardcor Code - Quick Pick Item Description & Detail Model
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface IQuickPickItemOptions {
	label: string;
	description?: string;
	detail?: string;
	icon?: string;
	group?: string;
	disabled?: boolean;
	data?: unknown;
}

export class QuickPickItem extends Disposable {
	private _options: IQuickPickItemOptions;
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(options: IQuickPickItemOptions) {
		super();
		this._options = { ...options };
	}

	get label(): string {
		return this._options.label;
	}

	get description(): string | undefined {
		return this._options.description;
	}

	get detail(): string | undefined {
		return this._options.detail;
	}

	get icon(): string | undefined {
		return this._options.icon;
	}

	get group(): string | undefined {
		return this._options.group;
	}

	get disabled(): boolean {
		return this._options.disabled ?? false;
	}

	get data(): unknown {
		return this._options.data;
	}

	getSearchText(): string {
		return [this._options.label, this._options.description, this._options.detail].filter(Boolean).join(' ').toLowerCase();
	}

	update(options: Partial<IQuickPickItemOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChange.fire();
	}
}
