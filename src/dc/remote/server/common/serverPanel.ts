import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerPanelEntry {
	readonly id: string;
	readonly name: string;
	readonly order?: number;
}

export interface IServerPanelService {
	readonly onDidOpen: Event<string>;
	readonly onDidClose: Event<string>;
	readonly onDidChangeVisibility: Event<{ id: string; visible: boolean }>;
	openPanel(id: string, focus?: boolean): void;
	closePanel(id: string): void;
	getActivePanel(): string | undefined;
	getPanels(): IServerPanelEntry[];
	registerPanel(entry: IServerPanelEntry): IDisposable;
	isPanelVisible(id: string): boolean;
	togglePanel(id: string): void;
	getLastActivePanel(): string | undefined;
}

export class ServerPanelCommon implements IServerPanelService {
	private readonly _panels = new Map<string, IServerPanelEntry>();
	private _activePanelId: string | undefined;
	private _lastActivePanelId: string | undefined;

	private readonly _onDidOpen = new Emitter<string>();
	readonly onDidOpen: Event<string> = this._onDidOpen.event;

	private readonly _onDidClose = new Emitter<string>();
	readonly onDidClose: Event<string> = this._onDidClose.event;

	private readonly _onDidChangeVisibility = new Emitter<{ id: string; visible: boolean }>();
	readonly onDidChangeVisibility: Event<{ id: string; visible: boolean }> = this._onDidChangeVisibility.event;

	openPanel(id: string, focus?: boolean): void {
		if (this._panels.has(id)) {
			this._lastActivePanelId = this._activePanelId;
			this._activePanelId = id;
			this._onDidOpen.fire(id);
			this._onDidChangeVisibility.fire({ id, visible: true });
		}
	}

	closePanel(id: string): void {
		if (this._activePanelId === id) {
			this._activePanelId = undefined;
			this._onDidClose.fire(id);
			this._onDidChangeVisibility.fire({ id, visible: false });
		}
	}

	getActivePanel(): string | undefined {
		return this._activePanelId;
	}

	getPanels(): IServerPanelEntry[] {
		return Array.from(this._panels.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}

	registerPanel(entry: IServerPanelEntry): IDisposable {
		this._panels.set(entry.id, entry);
		return { dispose: () => { this._panels.delete(entry.id); } };
	}

	isPanelVisible(id: string): boolean {
		return this._activePanelId === id;
	}

	togglePanel(id: string): void {
		if (this._activePanelId === id) {
			this.closePanel(id);
		} else {
			this.openPanel(id);
		}
	}

	getLastActivePanel(): string | undefined {
		return this._lastActivePanelId;
	}
}
