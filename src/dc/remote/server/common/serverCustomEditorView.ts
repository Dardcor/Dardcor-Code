import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerCustomEditorViewState {
	readonly editorId: string;
	readonly resourceUri: string;
	readonly viewType: string;
	readonly active: boolean;
	readonly visible: boolean;
}

export interface IServerCustomEditorViewService {
	readonly onDidChangeActiveView: Event<IServerCustomEditorViewState | undefined>;
	readonly onDidChangeVisibility: Event<{ editorId: string; visible: boolean }>;
	getActiveView(): IServerCustomEditorViewState | undefined;
	getViews(): IServerCustomEditorViewState[];
	showView(editorId: string): void;
	hideView(editorId: string): void;
	registerView(state: IServerCustomEditorViewState): IDisposable;
}

export class ServerCustomEditorViewCommon implements IServerCustomEditorViewService {
	private readonly _views = new Map<string, IServerCustomEditorViewState>();
	private _activeViewId: string | undefined;

	private readonly _onDidChangeActiveView = new Emitter<IServerCustomEditorViewState | undefined>();
	readonly onDidChangeActiveView: Event<IServerCustomEditorViewState | undefined> = this._onDidChangeActiveView.event;

	private readonly _onDidChangeVisibility = new Emitter<{ editorId: string; visible: boolean }>();
	readonly onDidChangeVisibility: Event<{ editorId: string; visible: boolean }> = this._onDidChangeVisibility.event;

	getActiveView(): IServerCustomEditorViewState | undefined {
		return this._activeViewId ? this._views.get(this._activeViewId) : undefined;
	}

	getViews(): IServerCustomEditorViewState[] {
		return Array.from(this._views.values());
	}

	showView(editorId: string): void {
		const view = this._views.get(editorId);
		if (view) {
			(view as any).visible = true;
			(view as any).active = true;
			this._activeViewId = editorId;
			this._onDidChangeVisibility.fire({ editorId, visible: true });
			this._onDidChangeActiveView.fire(view);
		}
	}

	hideView(editorId: string): void {
		const view = this._views.get(editorId);
		if (view) {
			(view as any).visible = false;
			(view as any).active = false;
			if (this._activeViewId === editorId) { this._activeViewId = undefined; }
			this._onDidChangeVisibility.fire({ editorId, visible: false });
			this._onDidChangeActiveView.fire(this.getActiveView());
		}
	}

	registerView(state: IServerCustomEditorViewState): IDisposable {
		this._views.set(state.editorId, state);
		return { dispose: () => { this._views.delete(state.editorId); } };
	}
}
