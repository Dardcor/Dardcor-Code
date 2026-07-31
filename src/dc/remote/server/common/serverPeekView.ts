import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';
import { IServerLocation } from './serverReferenceSearch';

export interface IServerPeekView {
	readonly id: string;
	readonly location: IServerLocation;
	readonly locations: IServerLocation[];
}

export interface IServerPeekViewService {
	readonly onDidOpenPeekView: Event<IServerPeekView>;
	readonly onDidClosePeekView: Event<IServerPeekView>;
	openPeekView(location: IServerLocation, locations: IServerLocation[]): Promise<IServerPeekView>;
	closePeekView(id: string): void;
	getPeekViews(): IServerPeekView[];
}

export class ServerPeekViewCommon implements IServerPeekViewService {
	private readonly _views = new Map<string, IServerPeekView>();
	private _nextId = 1;

	private readonly _onDidOpenPeekView = new Emitter<IServerPeekView>();
	readonly onDidOpenPeekView = this._onDidOpenPeekView.event;

	private readonly _onDidClosePeekView = new Emitter<IServerPeekView>();
	readonly onDidClosePeekView = this._onDidClosePeekView.event;

	async openPeekView(location: IServerLocation, locations: IServerLocation[]): Promise<IServerPeekView> {
		const view: IServerPeekView = {
			id: `peek-view-${this._nextId++}`,
			location,
			locations
		};
		this._views.set(view.id, view);
		this._onDidOpenPeekView.fire(view);
		return view;
	}

	closePeekView(id: string): void {
		const view = this._views.get(id);
		if (view) {
			this._views.delete(id);
			this._onDidClosePeekView.fire(view);
		}
	}

	getPeekViews(): IServerPeekView[] {
		return Array.from(this._views.values());
	}
}
