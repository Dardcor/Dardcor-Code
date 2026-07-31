import { IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { LspClient } from './lsp-client';

export interface FoldingRange {
	startLine: number;
	endLine: number;
	kind?: string;
	collapsedText?: string;
}

export class LspFoldingRange {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async getFoldingRanges(uri: string): Promise<FoldingRange[]> {
		const result = await this._requireClient().request<FoldingRange[] | null>('textDocument/foldingRange', {
			textDocument: { uri }
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
