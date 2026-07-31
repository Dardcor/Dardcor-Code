import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerWelcomeView {
	readonly id: string;
	readonly containerId: string;
	readonly title: string;
	readonly content: string;
	readonly when?: string;
	readonly order: number;
}

export interface IServerWelcomeViewsService {
	readonly onDidChangeWelcomeViews: Event<void>;
	registerWelcomeView(view: IServerWelcomeView): IDisposable;
	getWelcomeViews(containerId: string): IServerWelcomeView[];
	getAllWelcomeViews(): IServerWelcomeView[];
}

export class ServerWelcomeViewsCommon implements IServerWelcomeViewsService {
	private readonly _views = new Map<string, IServerWelcomeView>();

	private readonly _onDidChangeWelcomeViews = new Emitter<void>();
	readonly onDidChangeWelcomeViews = this._onDidChangeWelcomeViews.event;

	registerWelcomeView(view: IServerWelcomeView): IDisposable {
		this._views.set(view.id, view);
		this._onDidChangeWelcomeViews.fire();
		return {
			dispose: () => {
				this._views.delete(view.id);
				this._onDidChangeWelcomeViews.fire();
			}
		};
	}

	getWelcomeViews(containerId: string): IServerWelcomeView[] {
		return Array.from(this._views.values())
			.filter(v => v.containerId === containerId)
			.sort((a, b) => a.order - b.order);
	}

	getAllWelcomeViews(): IServerWelcomeView[] {
		return Array.from(this._views.values()).sort((a, b) => a.order - b.order);
	}
}
