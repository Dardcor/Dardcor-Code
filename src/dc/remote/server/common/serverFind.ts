import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerFindMatch {
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly matches: string[];
}

export interface IServerFindOptions {
	readonly isRegex?: boolean;
	readonly matchCase?: boolean;
	readonly wholeWord?: boolean;
}

export interface IServerFindService {
	readonly onDidChangeFindState: Event<{ uri: string; isActive: boolean }>;
	find(uri: string, searchString: string, options?: IServerFindOptions): Promise<IServerFindMatch[]>;
	replace(uri: string, searchString: string, replaceString: string, options?: IServerFindOptions): Promise<void>;
	replaceAll(uri: string, searchString: string, replaceString: string, options?: IServerFindOptions): Promise<void>;
	openFindWidget(uri: string): void;
	closeFindWidget(uri: string): void;
	isFindWidgetOpen(uri: string): boolean;
}

export class ServerFindCommon implements IServerFindService {
	private readonly _activeWidgets = new Set<string>();

	private readonly _onDidChangeFindState = new Emitter<{ uri: string; isActive: boolean }>();
	readonly onDidChangeFindState = this._onDidChangeFindState.event;

	async find(_uri: string, _searchString: string, _options?: IServerFindOptions): Promise<IServerFindMatch[]> {
		return [];
	}

	async replace(_uri: string, _searchString: string, _replaceString: string, _options?: IServerFindOptions): Promise<void> {}

	async replaceAll(_uri: string, _searchString: string, _replaceString: string, _options?: IServerFindOptions): Promise<void> {}

	openFindWidget(uri: string): void {
		if (!this._activeWidgets.has(uri)) {
			this._activeWidgets.add(uri);
			this._onDidChangeFindState.fire({ uri, isActive: true });
		}
	}

	closeFindWidget(uri: string): void {
		if (this._activeWidgets.has(uri)) {
			this._activeWidgets.delete(uri);
			this._onDidChangeFindState.fire({ uri, isActive: false });
		}
	}

	isFindWidgetOpen(uri: string): boolean {
		return this._activeWidgets.has(uri);
	}
}
