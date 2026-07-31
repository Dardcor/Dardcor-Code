import { IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { LspClient } from './lsp-client';
import { ILspPosition, ILspRange } from './lsp-converters';

export interface InlayHint {
	position: ILspPosition;
	label: string;
	kind?: number;
	tooltip?: string;
}

interface IRawInlayHint {
	position: ILspPosition;
	label: string | Array<{ value: string; tooltip?: string }>;
	kind?: number;
	tooltip?: string | { kind: 'plaintext' | 'markdown'; value: string };
	paddingLeft?: boolean;
	paddingRight?: boolean;
	data?: unknown;
}

export class LspInlayHints {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async getInlayHints(uri: string, range: ILspRange): Promise<InlayHint[]> {
		const result = await this._requireClient().request<{ hints?: IRawInlayHint[] } | IRawInlayHint[] | null>('textDocument/inlayHint', {
			textDocument: { uri },
			range
		});
		const rawHints = this._toArray(result);
		return rawHints.map(hint => ({
			position: hint.position,
			label: this._toLabel(hint.label),
			kind: hint.kind,
			tooltip: this._toTooltip(hint.tooltip)
		}));
	}

	private _toArray(result: { hints?: IRawInlayHint[] } | IRawInlayHint[] | null): IRawInlayHint[] {
		if (!result) {
			return [];
		}
		if (Array.isArray(result)) {
			return result;
		}
		return result.hints ?? [];
	}

	private _toLabel(label: string | Array<{ value: string; tooltip?: string }>): string {
		if (typeof label === 'string') {
			return label;
		}
		return label.map(part => part.value).join('');
	}

	private _toTooltip(tooltip: string | { kind: 'plaintext' | 'markdown'; value: string } | undefined): string | undefined {
		if (tooltip === undefined) {
			return undefined;
		}
		if (typeof tooltip === 'string') {
			return tooltip;
		}
		return tooltip.value;
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}
}
