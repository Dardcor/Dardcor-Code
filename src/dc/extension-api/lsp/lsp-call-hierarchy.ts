import { IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { LspClient } from './lsp-client.js';
import { ILspPosition, ILspRange } from './lsp-converters.js';
import { Position } from '../api/ext-host-api-impl.js';

export interface CallHierarchyItem {
	name: string;
	kind: number;
	detail?: string;
	uri: string;
	range: ILspRange;
	selectionRange: ILspRange;
	tags?: number[];
	data?: unknown;
}

export interface CallHierarchyIncomingCall {
	from: CallHierarchyItem;
	fromRanges: ILspRange[];
}

export interface CallHierarchyOutgoingCall {
	to: CallHierarchyItem;
	fromRanges: ILspRange[];
}

export class LspCallHierarchy {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async prepare(uri: string, position: Position | ILspPosition): Promise<CallHierarchyItem[]> {
		const result = await this._requireClient().request<CallHierarchyItem[] | null>('textDocument/prepareCallHierarchy', {
			textDocument: { uri },
			position: this._toLspPosition(position)
		});
		return result ?? [];
	}

	public async incomingCalls(item: CallHierarchyItem): Promise<CallHierarchyIncomingCall[]> {
		const result = await this._requireClient().request<CallHierarchyIncomingCall[] | null>('callHierarchy/incomingCalls', { item });
		return result ?? [];
	}

	public async outgoingCalls(item: CallHierarchyItem): Promise<CallHierarchyOutgoingCall[]> {
		const result = await this._requireClient().request<CallHierarchyOutgoingCall[] | null>('callHierarchy/outgoingCalls', { item });
		return result ?? [];
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
