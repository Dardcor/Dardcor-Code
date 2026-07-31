import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerOverlayWidgetPosition {
	readonly preference: number | null;
}

export interface IServerOverlayWidget {
	readonly id: string;
	readonly getPosition: () => IServerOverlayWidgetPosition | null;
	readonly isVisible: boolean;
}

export interface IServerOverlayWidgetsService {
	readonly onDidAddWidget: Event<{ uri: string; widget: IServerOverlayWidget }>;
	readonly onDidRemoveWidget: Event<{ uri: string; widgetId: string }>;
	addWidget(uri: string, widget: IServerOverlayWidget): void;
	removeWidget(uri: string, widgetId: string): void;
	getWidgets(uri: string): Promise<IServerOverlayWidget[]>;
}

export class ServerOverlayWidgetsCommon implements IServerOverlayWidgetsService {
	private readonly _widgets = new Map<string, IServerOverlayWidget[]>();

	private readonly _onDidAddWidget = new Emitter<{ uri: string; widget: IServerOverlayWidget }>();
	readonly onDidAddWidget = this._onDidAddWidget.event;

	private readonly _onDidRemoveWidget = new Emitter<{ uri: string; widgetId: string }>();
	readonly onDidRemoveWidget = this._onDidRemoveWidget.event;

	addWidget(uri: string, widget: IServerOverlayWidget): void {
		let widgets = this._widgets.get(uri);
		if (!widgets) {
			widgets = [];
			this._widgets.set(uri, widgets);
		}
		widgets.push(widget);
		this._onDidAddWidget.fire({ uri, widget });
	}

	removeWidget(uri: string, widgetId: string): void {
		const widgets = this._widgets.get(uri);
		if (widgets) {
			const index = widgets.findIndex(w => w.id === widgetId);
			if (index !== -1) {
				widgets.splice(index, 1);
				this._onDidRemoveWidget.fire({ uri, widgetId });
			}
		}
	}

	async getWidgets(uri: string): Promise<IServerOverlayWidget[]> {
		return this._widgets.get(uri) || [];
	}
}
