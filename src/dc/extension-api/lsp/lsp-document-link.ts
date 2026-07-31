import { IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { LspClient } from './lsp-client';
import { ILspRange } from './lsp-converters';

export interface DocumentLink {
	range: ILspRange;
	target?: string;
	tooltip?: string;
	data?: unknown;
}

export class LspDocumentLink {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async getDocumentLinks(uri: string): Promise<DocumentLink[]> {
		const result = await this._requireClient().request<DocumentLink[] | null>('textDocument/documentLink', {
			textDocument: { uri }
		});
		return result ?? [];
	}

	public async resolveDocumentLink(link: DocumentLink): Promise<DocumentLink> {
		const result = await this._requireClient().request<DocumentLink | null>('documentLink/resolve', link);
		return result ?? link;
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}
}
