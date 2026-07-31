import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerZoneWidget {
	readonly id: string;
	readonly position: { line: number; column: number };
	readonly heightInLines: number;
	readonly isVisible: boolean;
}

export interface IServerZoneWidgetService {
	readonly onDidAddZoneWidget: Event<IServerZoneWidget>;
	readonly onDidRemoveZoneWidget: Event<IServerZoneWidget>;
	addZoneWidget(position: { line: number; column: number }, heightInLines: number): Promise<IServerZoneWidget>;
	removeZoneWidget(id: string): void;
	getZoneWidgets(): IServerZoneWidget[];
}

export class ServerZoneWidgetCommon implements IServerZoneWidgetService {
	private readonly _widgets = new Map<string, IServerZoneWidget>();
	private _nextId = 1;

	private readonly _onDidAddZoneWidget = new Emitter<IServerZoneWidget>();
	readonly onDidAddZoneWidget = this._onDidAddZoneWidget.event;

	private readonly _onDidRemoveZoneWidget = new Emitter<IServerZoneWidget>();
	readonly onDidRemoveZoneWidget = this._onDidRemoveZoneWidget.event;

	async addZoneWidget(position: { line: number; column: number }, heightInLines: number): Promise<IServerZoneWidget> {
		const widget: IServerZoneWidget = {
			id: `zone-widget-${this._nextId++}`,
			position,
			heightInLines,
			isVisible: true
		};
		this._widgets.set(widget.id, widget);
		this._onDidAddZoneWidget.fire(widget);
		return widget;
	}

	removeZoneWidget(id: string): void {
		const widget = this._widgets.get(id);
		if (widget) {
			this._widgets.delete(id);
			this._onDidRemoveZoneWidget.fire(widget);
		}
	}

	getZoneWidgets(): IServerZoneWidget[] {
		return Array.from(this._widgets.values());
	}
}
