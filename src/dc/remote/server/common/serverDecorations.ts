import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerDecorationOptions {
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly options: {
		isWholeLine?: boolean;
		className?: string;
		hoverMessage?: string;
	};
}

export interface IServerDecorationsService {
	readonly onDidChangeDecorations: Event<{ uri: string; decorationIds: string[] }>;
	addDecorations(uri: string, decorations: IServerDecorationOptions[]): string[];
	removeDecorations(uri: string, decorationIds: string[]): void;
	getDecorations(uri: string): IServerDecorationOptions[];
}

export class ServerDecorationsCommon implements IServerDecorationsService {
	private readonly _decorations = new Map<string, Map<string, IServerDecorationOptions>>();
	private _nextId = 1;

	private readonly _onDidChangeDecorations = new Emitter<{ uri: string; decorationIds: string[] }>();
	readonly onDidChangeDecorations = this._onDidChangeDecorations.event;

	addDecorations(uri: string, decorations: IServerDecorationOptions[]): string[] {
		let uriDecorations = this._decorations.get(uri);
		if (!uriDecorations) {
			uriDecorations = new Map<string, IServerDecorationOptions>();
			this._decorations.set(uri, uriDecorations);
		}

		const ids: string[] = [];
		for (const dec of decorations) {
			const id = `decoration-${this._nextId++}`;
			uriDecorations.set(id, dec);
			ids.push(id);
		}

		this._onDidChangeDecorations.fire({ uri, decorationIds: ids });
		return ids;
	}

	removeDecorations(uri: string, decorationIds: string[]): void {
		const uriDecorations = this._decorations.get(uri);
		if (uriDecorations) {
			const removed: string[] = [];
			for (const id of decorationIds) {
				if (uriDecorations.delete(id)) {
					removed.push(id);
				}
			}
			if (removed.length > 0) {
				this._onDidChangeDecorations.fire({ uri, decorationIds: removed });
			}
		}
	}

	getDecorations(uri: string): IServerDecorationOptions[] {
		const uriDecorations = this._decorations.get(uri);
		return uriDecorations ? Array.from(uriDecorations.values()) : [];
	}
}
