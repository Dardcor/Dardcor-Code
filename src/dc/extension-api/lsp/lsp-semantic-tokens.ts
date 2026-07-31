import { IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { LspClient } from './lsp-client.js';

export const lspSemanticTokenTypes: readonly string[] = [
	'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
	'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method',
	'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator',
	'decorator'
];

export const lspSemanticTokenModifiers: readonly string[] = [
	'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
	'async', 'modification', 'documentation', 'defaultLibrary'
];

export interface ISemanticTokensResult {
	resultId?: string;
	data: number[];
}

export interface ISemanticTokensDeltaResult {
	resultId?: string;
	edits?: Array<{ start: number; deleteCount: number; data?: number[] }>;
	data?: number[];
}

export class LspSemanticTokens {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async getSemanticTokens(uri: string): Promise<ISemanticTokensResult> {
		const result = await this._requireClient().request<ISemanticTokensResult | null>('textDocument/semanticTokens/full', {
			textDocument: { uri }
		});
		return result ?? { data: [] };
	}

	public async getSemanticTokensDelta(uri: string, previousResultId: string): Promise<ISemanticTokensDeltaResult | ISemanticTokensResult> {
		const result = await this._requireClient().request<ISemanticTokensDeltaResult | ISemanticTokensResult | null>('textDocument/semanticTokens/delta', {
			textDocument: { uri },
			previousResultId
		});
		return result ?? { data: [] };
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}
}
