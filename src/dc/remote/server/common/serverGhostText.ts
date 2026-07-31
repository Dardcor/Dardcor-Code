import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerGhostText {
	readonly text: string;
	readonly position: { line: number; column: number };
}

export interface IServerGhostTextWidget {
	readonly id: string;
	readonly isVisible: boolean;
	readonly text: string | undefined;
}

export interface IServerGhostTextService {
	readonly onDidChangeGhostText: Event<IServerGhostTextWidget>;
	showGhostText(id: string, text: string, position: { line: number; column: number }): void;
	hideGhostText(id: string): void;
	getGhostTextWidget(id: string): IServerGhostTextWidget | undefined;
}

export class ServerGhostTextCommon implements IServerGhostTextService {
	private readonly _widgets = new Map<string, IServerGhostTextWidget>();

	private readonly _onDidChangeGhostText = new Emitter<IServerGhostTextWidget>();
	readonly onDidChangeGhostText = this._onDidChangeGhostText.event;

	showGhostText(id: string, text: string, _position: { line: number; column: number }): void {
		const widget = { id, isVisible: true, text };
		this._widgets.set(id, widget);
		this._onDidChangeGhostText.fire(widget);
	}

	hideGhostText(id: string): void {
		const widget = this._widgets.get(id);
		if (widget && widget.isVisible) {
			const hiddenWidget = { ...widget, isVisible: false, text: undefined };
			this._widgets.set(id, hiddenWidget);
			this._onDidChangeGhostText.fire(hiddenWidget);
		}
	}

	getGhostTextWidget(id: string): IServerGhostTextWidget | undefined {
		return this._widgets.get(id);
	}
}
