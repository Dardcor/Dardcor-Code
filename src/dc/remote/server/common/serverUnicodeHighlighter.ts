import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerUnicodeHighlight {
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly reason: string;
}

export interface IServerUnicodeHighlighterService {
	readonly onDidChangeHighlights: Event<{ uri: string; highlights: IServerUnicodeHighlight[] }>;
	getHighlights(uri: string): Promise<IServerUnicodeHighlight[]>;
	setHighlights(uri: string, highlights: IServerUnicodeHighlight[]): void;
}

export class ServerUnicodeHighlighterCommon implements IServerUnicodeHighlighterService {
	private readonly _highlights = new Map<string, IServerUnicodeHighlight[]>();

	private readonly _onDidChangeHighlights = new Emitter<{ uri: string; highlights: IServerUnicodeHighlight[] }>();
	readonly onDidChangeHighlights = this._onDidChangeHighlights.event;

	async getHighlights(uri: string): Promise<IServerUnicodeHighlight[]> {
		return this._highlights.get(uri) || [];
	}

	setHighlights(uri: string, highlights: IServerUnicodeHighlight[]): void {
		this._highlights.set(uri, highlights);
		this._onDidChangeHighlights.fire({ uri, highlights });
	}
}
