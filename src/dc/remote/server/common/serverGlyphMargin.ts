import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerGlyphMarginWidget {
	readonly id: string;
	readonly position: { line: number; column: number };
	readonly className: string;
}

export interface IServerGlyphMarginService {
	readonly onDidAddWidget: Event<{ uri: string; widget: IServerGlyphMarginWidget }>;
	readonly onDidRemoveWidget: Event<{ uri: string; widgetId: string }>;
	addWidget(uri: string, widget: IServerGlyphMarginWidget): void;
	removeWidget(uri: string, widgetId: string): void;
	getWidgets(uri: string): Promise<IServerGlyphMarginWidget[]>;
}

export class ServerGlyphMarginCommon implements IServerGlyphMarginService {
	private readonly _widgets = new Map<string, IServerGlyphMarginWidget[]>();

	private readonly _onDidAddWidget = new Emitter<{ uri: string; widget: IServerGlyphMarginWidget }>();
	readonly onDidAddWidget = this._onDidAddWidget.event;

	private readonly _onDidRemoveWidget = new Emitter<{ uri: string; widgetId: string }>();
	readonly onDidRemoveWidget = this._onDidRemoveWidget.event;

	addWidget(uri: string, widget: IServerGlyphMarginWidget): void {
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

	async getWidgets(uri: string): Promise<IServerGlyphMarginWidget[]> {
		return this._widgets.get(uri) || [];
	}
}
