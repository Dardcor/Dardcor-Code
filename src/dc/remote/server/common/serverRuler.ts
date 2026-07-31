import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerRulerOptions {
	readonly column: number;
	readonly color: string;
}

export interface IServerRulerService {
	readonly onDidChangeRulers: Event<IServerRulerOptions[]>;
	getRulers(): IServerRulerOptions[];
	setRulers(rulers: IServerRulerOptions[]): void;
}

export class ServerRulerCommon implements IServerRulerService {
	private _rulers: IServerRulerOptions[] = [];

	private readonly _onDidChangeRulers = new Emitter<IServerRulerOptions[]>();
	readonly onDidChangeRulers = this._onDidChangeRulers.event;

	getRulers(): IServerRulerOptions[] {
		return this._rulers;
	}

	setRulers(rulers: IServerRulerOptions[]): void {
		this._rulers = [...rulers];
		this._onDidChangeRulers.fire(this._rulers);
	}
}
