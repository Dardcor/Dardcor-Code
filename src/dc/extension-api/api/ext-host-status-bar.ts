import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { generateUuid } from '../../core/types/uuid.js';
import { StatusBarAlignment } from './ext-host-enums.js';

export interface IStatusBarItemData {
	readonly id: string;
	readonly text: string;
	readonly tooltip: string | undefined;
	readonly command: string | { title?: string; command: string; arguments?: any[] } | undefined;
	readonly color: string | undefined;
	readonly backgroundColor: string | undefined;
	readonly alignment: StatusBarAlignment;
	readonly priority: number;
	readonly visible: boolean;
}

export interface IStatusBarSink {
	update(item: IStatusBarItemData): void;
	dispose(id: string): void;
}

let statusBarSink: IStatusBarSink | undefined;

export function setStatusBarSink(sink: IStatusBarSink | undefined): void {
	statusBarSink = sink;
}

export function getStatusBarSink(): IStatusBarSink | undefined {
	return statusBarSink;
}

export interface StatusBarItem extends IDisposable {
	readonly id: string;
	text: string;
	tooltip: string | undefined;
	command: string | { title?: string; command: string; arguments?: any[] } | undefined;
	color: string | undefined;
	backgroundColor: string | undefined;
	readonly alignment: StatusBarAlignment;
	readonly priority: number;
	show(): void;
	hide(): void;
	dispose(): void;
}

class StatusBarItemImpl implements StatusBarItem {
	private _text = '';
	private _tooltip: string | undefined;
	private _command: string | { title?: string; command: string; arguments?: any[] } | undefined;
	private _color: string | undefined;
	private _backgroundColor: string | undefined;
	private _visible = false;
	private _disposed = false;

	constructor(
		public readonly id: string,
		public readonly alignment: StatusBarAlignment,
		public readonly priority: number,
		private readonly _onDispose: () => void
	) {}

	public get text(): string {
		return this._text;
	}

	public set text(value: string) {
		this._text = value;
		this._sync();
	}

	public get tooltip(): string | undefined {
		return this._tooltip;
	}

	public set tooltip(value: string | undefined) {
		this._tooltip = value;
		this._sync();
	}

	public get command(): string | { title?: string; command: string; arguments?: any[] } | undefined {
		return this._command;
	}

	public set command(value: string | { title?: string; command: string; arguments?: any[] } | undefined) {
		this._command = value;
		this._sync();
	}

	public get color(): string | undefined {
		return this._color;
	}

	public set color(value: string | undefined) {
		this._color = value;
		this._sync();
	}

	public get backgroundColor(): string | undefined {
		return this._backgroundColor;
	}

	public set backgroundColor(value: string | undefined) {
		this._backgroundColor = value;
		this._sync();
	}

	public show(): void {
		if (!this._visible && !this._disposed) {
			this._visible = true;
			this._sync();
		}
	}

	public hide(): void {
		if (this._visible && !this._disposed) {
			this._visible = false;
			this._sync();
		}
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		statusBarSink?.dispose(this.id);
		this._onDispose();
	}

	public toData(): IStatusBarItemData {
		return {
			id: this.id,
			text: this._text,
			tooltip: this._tooltip,
			command: this._command,
			color: this._color,
			backgroundColor: this._backgroundColor,
			alignment: this.alignment,
			priority: this.priority,
			visible: this._visible
		};
	}

	private _sync(): void {
		if (this._disposed) {
			return;
		}
		statusBarSink?.update(this.toData());
	}
}

export class ExtHostStatusBar extends Disposable {
	private readonly _items = new Map<string, StatusBarItemImpl>();

	private readonly _onDidChangeStatusBar = this._register(new Emitter<IStatusBarItemData[]>());
	readonly onDidChangeStatusBar: Event<IStatusBarItemData[]> = this._onDidChangeStatusBar.event;

	public createStatusBarItem(alignment: StatusBarAlignment = StatusBarAlignment.Left, priority = 100): StatusBarItem {
		const item = new StatusBarItemImpl(generateUuid(), alignment, priority, () => {
			this._items.delete(item.id);
			this._notifyChanged();
		});
		this._items.set(item.id, item);
		this._notifyChanged();
		return item;
	}

	public getItem(id: string): IStatusBarItemData | undefined {
		return this._items.get(id)?.toData();
	}

	public getItems(): IStatusBarItemData[] {
		return [...this._items.values()].map(item => item.toData());
	}

	public override dispose(): void {
		for (const item of this._items.values()) {
			item.dispose();
		}
		this._items.clear();
		super.dispose();
	}

	private _notifyChanged(): void {
		this._onDidChangeStatusBar.fire(this.getItems());
	}
}
