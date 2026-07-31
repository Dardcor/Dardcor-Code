import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTheme {
	private readonly _onDidChangeTheme = new Emitter<any>();
	readonly onDidChangeTheme = this._onDidChangeTheme.event;

	get activeColorTheme(): any {
		return { kind: 2 }; // Dark theme stub
	}
}
