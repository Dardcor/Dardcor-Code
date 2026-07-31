import { IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { LspClient } from './lsp-client.js';
import { ILspRange, ILspTextEdit, lspRangeToApiRange } from './lsp-converters.js';
import { Range, TextEdit } from '../api/ext-host-api-impl.js';

export interface IFormattingOptions {
	tabSize: number;
	insertSpaces: boolean;
}

export class LspFormatting {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async formatDocument(uri: string, options: IFormattingOptions): Promise<TextEdit[]> {
		const result = await this._requireClient().request<ILspTextEdit[] | null>('textDocument/formatting', {
			textDocument: { uri },
			options: this._toLspFormattingOptions(options)
		});
		return this._toTextEdits(result);
	}

	public async formatRange(uri: string, range: Range | ILspRange, options: IFormattingOptions): Promise<TextEdit[]> {
		const result = await this._requireClient().request<ILspTextEdit[] | null>('textDocument/rangeFormatting', {
			textDocument: { uri },
			range: this._toLspRange(range),
			options: this._toLspFormattingOptions(options)
		});
		return this._toTextEdits(result);
	}

	private _toLspFormattingOptions(options: IFormattingOptions): Record<string, unknown> {
		return { tabSize: options.tabSize, insertSpaces: options.insertSpaces };
	}

	private _toTextEdits(result: ILspTextEdit[] | null): TextEdit[] {
		if (!result) {
			return [];
		}
		return result.map(edit => new TextEdit(lspRangeToApiRange(edit.range), edit.newText));
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}

	private _toLspRange(range: Range | ILspRange): ILspRange {
		const candidate = range as ILspRange;
		if (candidate.start && typeof candidate.start.line === 'number') {
			return candidate;
		}
		const apiRange = range as Range;
		return {
			start: { line: apiRange.start.lineNumber - 1, character: apiRange.start.column - 1 },
			end: { line: apiRange.end.lineNumber - 1, character: apiRange.end.column - 1 }
		};
	}
}
