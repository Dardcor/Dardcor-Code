import { IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { LspClient } from './lsp-client.js';
import { ILspRange } from './lsp-converters.js';

export interface CodeLens {
	range: ILspRange;
	command?: { title: string; command: string; arguments?: unknown[] };
	data?: unknown;
}

export class LspCodeLens {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async getCodeLenses(uri: string): Promise<CodeLens[]> {
		const result = await this._requireClient().request<CodeLens[] | null>('textDocument/codeLens', {
			textDocument: { uri }
		});
		return result ?? [];
	}

	public async resolveCodeLens(lens: CodeLens): Promise<CodeLens> {
		const result = await this._requireClient().request<CodeLens | null>('codeLens/resolve', lens);
		return result ?? lens;
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}
}
