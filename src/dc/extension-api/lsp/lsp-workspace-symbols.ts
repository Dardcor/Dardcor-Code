import { IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { LspClient } from './lsp-client.js';
import { ILspRange } from './lsp-converters.js';

export interface WorkspaceSymbol {
	name: string;
	kind: number;
	location: { uri: string; range: ILspRange };
	containerName?: string;
	tags?: number[];
	data?: unknown;
}

export class LspWorkspaceSymbols {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async getWorkspaceSymbols(query: string): Promise<WorkspaceSymbol[]> {
		const result = await this._requireClient().request<WorkspaceSymbol[] | null>('workspace/symbol', { query });
		return result ?? [];
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}
}
