import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerCursorPosition {
	readonly lineNumber: number;
	readonly column: number;
}

export interface IServerCursorState {
	readonly position: IServerCursorPosition;
	readonly selectionStart: IServerCursorPosition;
}

export interface IServerCursorService {
	readonly onDidChangeCursorPosition: Event<{ uri: string; state: IServerCursorState[] }>;
	getCursorState(uri: string): Promise<IServerCursorState[]>;
	setCursorState(uri: string, state: IServerCursorState[]): void;
}

export class ServerCursorCommon implements IServerCursorService {
	private readonly _states = new Map<string, IServerCursorState[]>();

	private readonly _onDidChangeCursorPosition = new Emitter<{ uri: string; state: IServerCursorState[] }>();
	readonly onDidChangeCursorPosition = this._onDidChangeCursorPosition.event;

	async getCursorState(uri: string): Promise<IServerCursorState[]> {
		return this._states.get(uri) || [];
	}

	setCursorState(uri: string, state: IServerCursorState[]): void {
		this._states.set(uri, state);
		this._onDidChangeCursorPosition.fire({ uri, state });
	}
}
