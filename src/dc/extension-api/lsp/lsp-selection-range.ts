import { IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { LspClient } from './lsp-client';
import { ILspPosition, ILspRange } from './lsp-converters';

export interface SelectionRange {
	range: ILspRange;
	parent?: SelectionRange;
}

export class LspSelectionRange {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async getSelectionRanges(uri: string, positions: ILspPosition[]): Promise<SelectionRange[]> {
		const result = await this._requireClient().request<SelectionRange[] | null>('textDocument/selectionRange', {
			textDocument: { uri },
			positions
		});
		return result ?? [];
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}
}
