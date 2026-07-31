import { IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { LspClient } from './lsp-client';
import { ILspPosition, ILspRange, lspRangeToApiRange, lspWorkspaceEditToApiEdit, ILspWorkspaceEdit } from './lsp-converters';
import { Position, Range, WorkspaceEdit } from '../api/ext-host-api-impl';

export interface IPrepareRenameResult {
	range: ILspRange;
	placeholder?: string;
}

export class LspRename {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async rename(uri: string, position: Position | ILspPosition, newName: string): Promise<WorkspaceEdit> {
		const result = await this._requireClient().request<ILspWorkspaceEdit | null>('textDocument/rename', {
			textDocument: { uri },
			position: this._toLspPosition(position),
			newName
		});
		if (!result) {
			throw new Error('Server tidak mengembalikan hasil rename');
		}
		return lspWorkspaceEditToApiEdit(result);
	}

	public async prepareRename(uri: string, position: Position | ILspPosition): Promise<Range | undefined> {
		const result = await this._requireClient().request<ILspRange | IPrepareRenameResult | null>('textDocument/prepareRename', {
			textDocument: { uri },
			position: this._toLspPosition(position)
		});
		if (!result) {
			return undefined;
		}
		const range = 'range' in result ? result.range : result;
		return lspRangeToApiRange(range);
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
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
