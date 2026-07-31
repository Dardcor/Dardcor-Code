import { IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { URI } from '../../core/types/uri.js';
import { LspClient } from './lsp-client.js';
import { ILspPosition, ILspRange, lspRangeToApiRange } from './lsp-converters.js';
import { Position, Location } from '../api/ext-host-api-impl.js';

export class LspReferences {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async findReferences(uri: string, position: Position | ILspPosition, includeDeclaration = true): Promise<Location[]> {
		const result = await this._requireClient().request<any>('textDocument/references', {
			textDocument: { uri },
			position: this._toLspPosition(position),
			context: { includeDeclaration }
		});
		return this._toLocations(result);
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}

	private _toLocations(result: any): Location[] {
		if (!result) {
			return [];
		}
		const items = Array.isArray(result) ? result : [result];
		const locations: Location[] = [];
		for (const item of items) {
			if (item.uri && item.range) {
				locations.push(new Location(URI.parse(item.uri), lspRangeToApiRange(item.range)));
			}
		}
		return locations;
	}

	private _toLspPosition(position: Position | ILspPosition): ILspPosition {
		const candidate = position as ILspPosition;
		if (typeof candidate.line === 'number') {
			return candidate;
		}
		const apiPosition = position as Position;
		return { line: apiPosition.lineNumber - 1, character: apiPosition.column - 1 };
	}
}
