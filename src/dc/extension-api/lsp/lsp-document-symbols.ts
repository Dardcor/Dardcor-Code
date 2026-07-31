import { IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { LspClient } from './lsp-client.js';
import { ILspRange, ILspLocation } from './lsp-converters.js';

export interface DocumentSymbol {
	name: string;
	detail?: string;
	kind: number;
	range: ILspRange;
	selectionRange: ILspRange;
	children?: DocumentSymbol[];
}

interface ISymbolInformation {
	name: string;
	kind: number;
	location: ILspLocation;
	containerName?: string;
	tags?: number[];
	deprecated?: boolean;
}

export class LspDocumentSymbols {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async getDocumentSymbols(uri: string): Promise<DocumentSymbol[]> {
		const result = await this._requireClient().request<DocumentSymbol[] | ISymbolInformation[] | null>('textDocument/documentSymbol', {
			textDocument: { uri }
		});
		if (!result) {
			return [];
		}
		if (result.length > 0 && (result[0] as ISymbolInformation).location) {
			return (result as ISymbolInformation[]).map(symbol => ({
				name: symbol.name,
				detail: symbol.containerName,
				kind: symbol.kind,
				range: symbol.location.range,
				selectionRange: symbol.location.range
			}));
		}
		return result as DocumentSymbol[];
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}
}
