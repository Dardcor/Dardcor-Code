import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerSelection {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
	readonly direction: 'ltr' | 'rtl';
}

export interface IServerSelectionService {
	readonly onDidChangeSelection: Event<{ uri: string; selections: IServerSelection[] }>;
	setSelection(uri: string, selections: IServerSelection[]): void;
	getSelection(uri: string): IServerSelection[];
}

export class ServerSelectionCommon implements IServerSelectionService {
	private readonly _selections = new Map<string, IServerSelection[]>();

	private readonly _onDidChangeSelection = new Emitter<{ uri: string; selections: IServerSelection[] }>();
	readonly onDidChangeSelection = this._onDidChangeSelection.event;

	setSelection(uri: string, selections: IServerSelection[]): void {
		this._selections.set(uri, selections);
		this._onDidChangeSelection.fire({ uri, selections });
	}

	getSelection(uri: string): IServerSelection[] {
		return this._selections.get(uri) || [];
	}
}
